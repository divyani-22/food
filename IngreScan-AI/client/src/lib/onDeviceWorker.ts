/// <reference lib="webworker" />
/**
 * Dedicated worker hosting the on-device engine, so decoding, resizing and inference never block the UI thread.
 * Protocol: see WorkerRequest / WorkerResponse in onDeviceProduce.ts.
 */
import { OnDeviceEngine, type EngineInfo, type LoadProgress, type RunOutput } from "./onDeviceEngine";

type Req =
  | { type: "init"; id: number; baseUrl: string }
  | { type: "run"; id: number; blob: Blob };

type Res =
  | { type: "progress"; progress: LoadProgress }
  | { type: "ready"; id: number; info: EngineInfo }
  | { type: "result"; id: number; output: RunOutput }
  | { type: "error"; id: number; message: string };

const ctx = self as unknown as {
  postMessage(msg: Res, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<Req>) => void) | null;
};

let engine: OnDeviceEngine | null = null;

ctx.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === "init") {
      engine = new OnDeviceEngine(msg.baseUrl, (progress) => ctx.postMessage({ type: "progress", progress }));
      const info = await engine.load();
      ctx.postMessage({ type: "ready", id: msg.id, info });
    } else if (msg.type === "run") {
      if (!engine) throw new Error("Worker is not initialised.");
      const output = await engine.run(msg.blob);
      ctx.postMessage({ type: "result", id: msg.id, output }, [output.fruitLogits.buffer, output.freshLogits.buffer]);
    }
  } catch (err) {
    ctx.postMessage({ type: "error", id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
};
