/**
 * On-device inference engine: model download + cache, onnxruntime-web session, preprocessing and run.
 * It runs inside the dedicated worker (onDeviceWorker.ts) and, as a fallback when workers or
 * OffscreenCanvas are unavailable, directly on the main thread (onDeviceProduce.ts).
 * It touches no React and no UI.
 */
import { resizeCenterCrop, toNormalizedTensor, type ModelMeta } from "./onDeviceMath";

export interface LoadProgress {
  loaded: number;
  total: number;
  phase: "meta" | "download" | "session";
}

export interface EngineInfo {
  provider: "webgpu" | "wasm";
  ortVersion: string;
  modelBytes: number;
  fromCache: boolean;
  loadMs: number;
  meta: ModelMeta;
}

export interface RunOutput {
  fruitLogits: Float32Array;
  freshLogits: Float32Array;
  timings: { decodeMs: number; preprocessMs: number; inferMs: number; totalMs: number };
}

const CACHE_NAME = "freshguard-ondevice-v1";
const MODEL_PATH = "models/freshguard.onnx";
const META_PATH = "models/freshguard.meta.json";

// Minimal structural types so this file does not depend on onnxruntime-web typings at compile time.
interface OrtTensor {
  data: Float32Array;
}
interface OrtSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>>;
  release?: () => Promise<void>;
}
interface OrtModule {
  env: { versions: { web: string }; wasm: Record<string, unknown>; webgpu: { device?: unknown } };
  InferenceSession: {
    create(model: Uint8Array, options: Record<string, unknown>): Promise<OrtSession>;
  };
  Tensor: new (type: "float32", data: Float32Array, dims: number[]) => unknown;
}

export class OnDeviceEngine {
  private session: OrtSession | null = null;
  private ort: OrtModule | null = null;
  private info: EngineInfo | null = null;
  private loading: Promise<EngineInfo> | null = null;
  /** Tail of the run queue: one onnxruntime session must not be entered by two run() calls at once. */
  private runQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly baseUrl: string,
    private readonly onProgress?: (p: LoadProgress) => void,
  ) {}

  getInfo(): EngineInfo | null {
    return this.info;
  }

  load(): Promise<EngineInfo> {
    if (this.info) return Promise.resolve(this.info);
    if (!this.loading) {
      this.loading = this.doLoad().catch((err) => {
        this.loading = null; // allow a retry after a failure
        throw err;
      });
    }
    return this.loading;
  }

  private url(path: string): string {
    return new URL(this.baseUrl + path, self.location.href).href;
  }

  private async doLoad(): Promise<EngineInfo> {
    const t0 = performance.now();
    this.onProgress?.({ loaded: 0, total: 0, phase: "meta" });
    const meta = await this.fetchMeta();

    const useGpu = await hasWebGpuAdapter();
    // The WebGPU-capable runtime (jsep) is a ~28 MB wasm; the plain wasm runtime is ~14 MB. Only pay for
    // the larger one on devices that can actually use the GPU.
    const ort = (useGpu ? await import("onnxruntime-web") : await import("onnxruntime-web/wasm")) as unknown as OrtModule;
    this.ort = ort;
    const ortVersion = ort.env.versions.web;
    const wasmName = useGpu ? "ort-wasm-simd-threaded.jsep.wasm" : "ort-wasm-simd-threaded.wasm";

    const progress = { model: [0, meta.model_bytes], wasm: [0, 0] };
    const emit = () =>
      this.onProgress?.({
        loaded: progress.model[0] + progress.wasm[0],
        total: progress.model[1] + progress.wasm[1],
        phase: "download",
      });
    const [model, wasm] = await Promise.all([
      cachedFetch(
        `${this.url(MODEL_PATH)}?sha=${meta.model_sha256.slice(0, 16)}`,
        (l, t) => {
          progress.model = [l, t || meta.model_bytes];
          emit();
        },
        meta.model_bytes,
      ),
      cachedFetch(`${this.url("ort/" + wasmName)}?v=${ortVersion}`, (l, t) => {
        progress.wasm = [l, t];
        emit();
      }),
    ]);
    this.onProgress?.({ loaded: progress.model[1] + progress.wasm[1], total: progress.model[1] + progress.wasm[1], phase: "session" });

    // Single-threaded wasm: no SharedArrayBuffer, so no COOP/COEP headers are required.
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmBinary = wasm.bytes;

    let provider: "webgpu" | "wasm" = "wasm";
    let session: OrtSession | null = null;
    if (useGpu) {
      try {
        session = await ort.InferenceSession.create(model.bytes, {
          executionProviders: ["webgpu", "wasm"],
          graphOptimizationLevel: "all",
        });
        provider = ort.env.webgpu.device ? "webgpu" : "wasm";
      } catch (err) {
        console.warn("[on-device] WebGPU session failed, retrying with wasm:", err);
      }
    }
    if (!session) {
      session = await ort.InferenceSession.create(model.bytes, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      });
      provider = "wasm";
    }
    this.session = session;
    this.info = {
      provider,
      ortVersion,
      modelBytes: meta.model_bytes,
      fromCache: model.fromCache && wasm.fromCache,
      loadMs: Math.round(performance.now() - t0),
      meta,
    };
    return this.info;
  }

  private async fetchMeta(): Promise<ModelMeta> {
    const url = this.url(META_PATH);
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error(`meta HTTP ${res.status}`);
      const text = await res.text();
      const meta = JSON.parse(text) as ModelMeta;
      await cachePut(url, new Response(text, { headers: { "content-type": "application/json" } }));
      return meta;
    } catch (err) {
      const cached = await cacheGet(url);
      if (cached) return (await cached.json()) as ModelMeta;
      throw err;
    }
  }

  /** Decode (EXIF-aware), preprocess exactly like PIL/torchvision and run the network. */
  run(blob: Blob): Promise<RunOutput> {
    const job = this.runQueue.then(() => this.runOnce(blob));
    this.runQueue = job.catch(() => undefined);
    return job;
  }

  private async runOnce(blob: Blob): Promise<RunOutput> {
    const info = await this.load();
    if (!this.session || !this.ort) throw new Error("On-device model is not loaded.");
    const { meta } = info;
    const t0 = performance.now();

    const bitmap = await decodeBitmap(blob);
    const t1 = performance.now();
    let tensorData: Float32Array;
    try {
      tensorData = preprocessBitmap(bitmap, meta);
    } finally {
      bitmap.close?.();
    }
    const t2 = performance.now();

    const input = new this.ort.Tensor("float32", tensorData, meta.input.shape);
    const out = await this.session.run({ [meta.input.name]: input });
    const t3 = performance.now();
    return {
      fruitLogits: new Float32Array(out[meta.outputs.fruit].data),
      freshLogits: new Float32Array(out[meta.outputs.fresh].data),
      timings: {
        decodeMs: Math.round(t1 - t0),
        preprocessMs: Math.round(t2 - t1),
        inferMs: Math.round(t3 - t2),
        totalMs: Math.round(t3 - t0),
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Decode / preprocess
// ---------------------------------------------------------------------------

/**
 * createImageBitmap with EXIF orientation applied (like ImageOps.exif_transpose) and without colour
 * management or alpha premultiplication, so the pixel values match what Pillow reads.
 */
export async function decodeBitmap(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, {
      imageOrientation: "from-image",
      colorSpaceConversion: "none",
      premultiplyAlpha: "none",
    });
  } catch (err) {
    // Older engines reject the options bag; a plain call still honours EXIF in current browsers.
    try {
      return await createImageBitmap(blob);
    } catch {
      throw new Error("This image could not be decoded.");
    }
  }
}

type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function makeContext(w: number, h: number): Canvas2D {
  let ctx: Canvas2D | null = null;
  if (typeof OffscreenCanvas !== "undefined") {
    ctx = new OffscreenCanvas(w, h).getContext("2d", { willReadFrequently: true });
  } else if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    ctx = c.getContext("2d", { willReadFrequently: true });
  }
  if (!ctx) throw new Error("A 2D canvas is not available in this browser.");
  return ctx;
}

export function preprocessBitmap(bitmap: ImageBitmap, meta: ModelMeta): Float32Array {
  const { width: w, height: h } = bitmap;
  const bandRows = 128;
  const ctx = makeContext(w, bandRows);
  const crop = meta.preprocess.center_crop;
  const { rgb } = resizeCenterCrop(
    w,
    h,
    (y0, n) => {
      // Band read: draw a 1:1 slice of the source, so a 12 MP photo never needs a 48 MB canvas.
      ctx.clearRect(0, 0, w, bandRows);
      ctx.drawImage(bitmap, 0, y0, w, n, 0, 0, w, n);
      return ctx.getImageData(0, 0, w, n).data;
    },
    meta.preprocess.resize_shorter_side,
    crop,
    bandRows,
  );
  return toNormalizedTensor(rgb, crop, crop, meta.preprocess.mean, meta.preprocess.std);
}

async function hasWebGpuAdapter(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown | null> } }).gpu;
    if (!gpu) return false;
    return (await gpu.requestAdapter()) != null;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Cache API helpers (the page also works, without offline support, where caches is unavailable)
// ---------------------------------------------------------------------------

async function openCache(): Promise<Cache | null> {
  try {
    return typeof caches === "undefined" ? null : await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

async function cacheGet(url: string): Promise<Response | undefined> {
  const c = await openCache();
  return c ? await c.match(url) : undefined;
}

async function cachePut(url: string, res: Response): Promise<void> {
  const c = await openCache();
  if (!c) return;
  try {
    // Drop older versions of the same asset (same path, different ?sha=/?v=).
    const base = url.split("?")[0];
    for (const req of await c.keys()) {
      if (req.url !== url && req.url.split("?")[0] === base) await c.delete(req);
    }
    await c.put(url, res);
  } catch (err) {
    console.warn("[on-device] could not cache", url, err); // quota exceeded, private mode, ...
  }
}

async function cacheDelete(url: string): Promise<void> {
  try {
    const c = await openCache();
    if (c) await c.delete(url);
  } catch {
    /* ignore */
  }
}

async function cachedFetch(
  url: string,
  onProgress: (loaded: number, total: number) => void,
  expectedBytes?: number,
): Promise<{ bytes: Uint8Array; fromCache: boolean }> {
  const hit = await cacheGet(url);
  if (hit) {
    const buf = new Uint8Array(await hit.arrayBuffer());
    if (expectedBytes === undefined || buf.byteLength === expectedBytes) {
      onProgress(buf.byteLength, buf.byteLength);
      return { bytes: buf, fromCache: true };
    }
    // A truncated or foreign entry would make every later start fail the same way: drop it and download again.
    await cacheDelete(url);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url.split("?")[0]}`);
  const total = Number(res.headers.get("content-length")) || 0;
  onProgress(0, total);
  let bytes: Uint8Array<ArrayBuffer>;
  if (res.body) {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress(loaded, total || loaded);
    }
    bytes = new Uint8Array(loaded);
    let off = 0;
    for (const c of chunks) {
      bytes.set(c, off);
      off += c.byteLength;
    }
    if (total && loaded !== total && !res.headers.get("content-encoding")) throw new Error(`Incomplete download for ${url.split("?")[0]} (${loaded}/${total} bytes)`);
  } else {
    // No streaming body (very old engines): read it in one go, without per-chunk progress.
    bytes = new Uint8Array(await res.arrayBuffer());
    onProgress(bytes.byteLength, bytes.byteLength);
  }
  if (expectedBytes !== undefined && bytes.byteLength !== expectedBytes) {
    throw new Error(`Downloaded file has the wrong size for ${url.split("?")[0]} (${bytes.byteLength}/${expectedBytes} bytes)`);
  }
  await cachePut(url, new Response(bytes, { headers: { "content-type": res.headers.get("content-type") ?? "application/octet-stream" } }));
  return { bytes, fromCache: false };
}
