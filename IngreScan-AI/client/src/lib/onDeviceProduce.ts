/**
 * On-device (in-browser) produce freshness inspection with ONNX Runtime Web.
 *
 * Public API used by the Produce page:
 *   isOnDeviceSupported()            feature detection
 *   ensureOnDeviceModel()            lazy-loads onnxruntime-web + model (cached in the Cache API), reports progress
 *   classifyOnDevice(blob)           preprocess + inference -> same result shape as the Flask PredictionResult
 *   subscribeOnDevice(listener)      status for the UI badge
 *
 * onnxruntime-web is imported dynamically inside the engine, so it is not part of the main bundle.
 * Work runs in a dedicated worker; if a worker cannot be started it runs on the main thread.
 */
import type { EngineInfo, LoadProgress, RunOutput } from "./onDeviceEngine";
import { buildPredictionResult, type OnDevicePrediction } from "./onDeviceMath";

export type { OnDevicePrediction } from "./onDeviceMath";

export type OnDeviceState =
  | { kind: "idle" }
  | { kind: "loading"; percent: number; phase: LoadProgress["phase"] }
  | { kind: "ready"; provider: "webgpu" | "wasm"; fromCache: boolean; loadMs: number; threadMode: "worker" | "main" }
  | { kind: "error"; message: string };

export interface OnDeviceClassification {
  result: OnDevicePrediction;
  provider: "webgpu" | "wasm";
  timings: RunOutput["timings"] & { roundTripMs: number };
}

type WorkerRes =
  | { type: "progress"; progress: LoadProgress }
  | { type: "ready"; id: number; info: EngineInfo }
  | { type: "result"; id: number; output: RunOutput }
  | { type: "error"; id: number; message: string };

interface Backend {
  mode: "worker" | "main";
  load(): Promise<EngineInfo>;
  run(blob: Blob): Promise<RunOutput>;
  dispose(): void;
}

let state: OnDeviceState = { kind: "idle" };
const listeners = new Set<(s: OnDeviceState) => void>();
let backend: Backend | null = null;
let loadPromise: Promise<EngineInfo> | null = null;
let info: EngineInfo | null = null;

function setState(s: OnDeviceState) {
  state = s;
  listeners.forEach((l) => l(s));
}

export function getOnDeviceState(): OnDeviceState {
  return state;
}

export function subscribeOnDevice(listener: (s: OnDeviceState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** WebAssembly + createImageBitmap + fetch + a 2D canvas are the hard requirements. */
export function isOnDeviceSupported(): boolean {
  try {
    return (
      typeof WebAssembly === "object" &&
      typeof createImageBitmap === "function" &&
      typeof fetch === "function" &&
      (typeof OffscreenCanvas !== "undefined" || typeof document !== "undefined")
    );
  } catch {
    return false;
  }
}

function baseUrl(): string {
  return (import.meta.env.BASE_URL as string | undefined) ?? "/";
}

function onProgress(p: LoadProgress) {
  const percent = p.total > 0 ? Math.min(100, Math.floor((p.loaded / p.total) * 100)) : 0;
  setState({ kind: "loading", percent: p.phase === "session" ? 100 : percent, phase: p.phase });
}

function createWorkerBackend(): Backend {
  const worker = new Worker(new URL("./onDeviceWorker.ts", import.meta.url), { type: "module" });
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  let workerFailed: Error | null = null;

  worker.onmessage = (e: MessageEvent<WorkerRes>) => {
    const m = e.data;
    if (m.type === "progress") return onProgress(m.progress);
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.type === "error") p.reject(new Error(m.message));
    else if (m.type === "ready") p.resolve(m.info);
    else p.resolve(m.output);
  };
  worker.onerror = (e) => {
    workerFailed = new WorkerStartError(e.message || "The on-device worker failed to start.");
    pending.forEach((p) => p.reject(workerFailed!));
    pending.clear();
  };

  const call = <T>(msg: Record<string, unknown>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      if (workerFailed) return reject(workerFailed);
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...msg, id });
    });

  return {
    mode: "worker",
    load: () => call<EngineInfo>({ type: "init", baseUrl: baseUrl() }),
    run: (blob) => call<RunOutput>({ type: "run", blob }),
    dispose: () => worker.terminate(),
  };
}

class WorkerStartError extends Error {}

async function createMainBackend(): Promise<Backend> {
  const { OnDeviceEngine } = await import("./onDeviceEngine");
  const engine = new OnDeviceEngine(baseUrl(), onProgress);
  return { mode: "main", load: () => engine.load(), run: (b) => engine.run(b), dispose: () => {} };
}

/** Load (or reuse) the model. Safe to call repeatedly; concurrent calls share one load. */
export function ensureOnDeviceModel(): Promise<EngineInfo> {
  if (info) return Promise.resolve(info);
  if (loadPromise) return loadPromise;
  if (!isOnDeviceSupported()) {
    const message = "This browser cannot run the on-device model.";
    setState({ kind: "error", message });
    return Promise.reject(new Error(message));
  }
  setState({ kind: "loading", percent: 0, phase: "meta" });
  loadPromise = (async () => {
    let b: Backend | null = null;
    try {
      if (typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined") {
        try {
          b = createWorkerBackend();
          info = await b.load();
        } catch (err) {
          if (!(err instanceof WorkerStartError) && !(err instanceof TypeError && /Worker/.test(String(err)))) throw err;
          console.warn("[on-device] worker unavailable, using the main thread:", err);
          b?.dispose();
          b = null;
        }
      }
      if (!b) {
        b = await createMainBackend();
        info = await b.load();
      }
      backend = b;
      setState({ kind: "ready", provider: info!.provider, fromCache: info!.fromCache, loadMs: info!.loadMs, threadMode: b.mode });
      return info!;
    } catch (err) {
      b?.dispose();
      backend = null;
      info = null;
      loadPromise = null; // a later call may retry
      setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  })();
  return loadPromise;
}

/** Run the full on-device pipeline on an image file/blob. */
export async function classifyOnDevice(blob: Blob): Promise<OnDeviceClassification> {
  const t0 = performance.now();
  let loaded = await ensureOnDeviceModel();
  if (!backend) throw new Error("On-device model is not available.");
  let out: RunOutput;
  try {
    out = await backend.run(blob);
  } catch (err) {
    // The worker died after the model was ready (crash, OOM kill): every later call would reject the same way.
    // Forget it and reload once, which falls back to the main thread when the worker cannot start again.
    if (!(err instanceof WorkerStartError)) throw err;
    resetOnDevice();
    await ensureOnDeviceModel();
    if (!backend) throw new Error("On-device model is not available.");
    out = await (backend as Backend).run(blob);
    loaded = info ?? loaded;
  }
  const result = buildPredictionResult(loaded.meta, out.fruitLogits, out.freshLogits);
  return {
    result,
    provider: loaded.provider,
    timings: { ...out.timings, roundTripMs: Math.round(performance.now() - t0) },
  };
}

/** Test/diagnostic hook: forget the loaded model (does not clear the Cache API). */
export function resetOnDevice(): void {
  backend?.dispose();
  backend = null;
  info = null;
  loadPromise = null;
  setState({ kind: "idle" });
}
