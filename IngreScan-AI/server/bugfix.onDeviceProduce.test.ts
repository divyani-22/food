import { afterEach, describe, expect, it, vi } from "vitest";

const META = {
  model_bytes: 8,
  model_sha256: "b".repeat(64),
  fruit_names: ["apple", "banana"],
  fresh_labels: ["fresh", "rotten"],
  fresh_index: 0,
  input: { name: "input", shape: [1, 3, 224, 224] },
  outputs: { fruit: "fruit_logits", fresh: "fresh_logits" },
  preprocess: { resize_shorter_side: 256, center_crop: 224, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] },
};

vi.mock("onnxruntime-web/wasm", () => ({
  env: { versions: { web: "1.0.0" }, wasm: {}, webgpu: {} },
  InferenceSession: {
    create: async () => ({
      run: async () => ({ fruit_logits: { data: new Float32Array([5, 0]) }, fresh_logits: { data: new Float32Array([5, 0]) } }),
    }),
  },
  Tensor: class {
    constructor(public type: string, public data: Float32Array, public dims: number[]) {}
  },
}));

describe("classifyOnDevice after the worker dies", () => {
  const g = globalThis as any;
  afterEach(() => {
    for (const k of ["self", "caches", "fetch", "createImageBitmap", "OffscreenCanvas", "Worker"]) delete g[k];
    vi.resetModules();
  });

  it("falls back to the main thread instead of failing every later call", async () => {
    g.self = { location: { href: "http://localhost/" } };
    g.fetch = async (u: string) =>
      String(u).includes("meta.json") ? new Response(JSON.stringify(META)) : new Response(new Uint8Array(8), { headers: { "content-length": "8" } });
    g.createImageBitmap = async () => ({ width: 300, height: 300, close() {} });
    g.OffscreenCanvas = class {
      constructor(public w: number) {}
      getContext() {
        const w = this.w;
        return { clearRect() {}, drawImage() {}, getImageData: (_a: number, _b: number, _c: number, n: number) => ({ data: new Uint8ClampedArray(w * n * 4) }) };
      }
    };
    const workers: any[] = [];
    let spawned = 0;
    g.Worker = class {
      onmessage: ((e: any) => void) | null = null;
      onerror: ((e: any) => void) | null = null;
      terminated = false;
      constructor() {
        const n = ++spawned;
        workers.push(this);
        // The first worker starts fine; any later one fails to start.
        if (n > 1) setTimeout(() => this.onerror?.({ message: "worker start failed" }), 0);
      }
      postMessage(msg: any) {
        if (spawned > 1) return;
        if (msg.type === "init") {
          setTimeout(() => this.onmessage?.({ data: { type: "ready", id: msg.id, info: { provider: "wasm", ortVersion: "1", modelBytes: 8, fromCache: false, loadMs: 1, meta: META } } }), 0);
        } else if (msg.type === "run") {
          setTimeout(
            () => this.onmessage?.({ data: { type: "result", id: msg.id, output: { fruitLogits: new Float32Array([5, 0]), freshLogits: new Float32Array([5, 0]), timings: { decodeMs: 0, preprocessMs: 0, inferMs: 0, totalMs: 0 } } } }),
            0,
          );
        }
      }
      terminate() {
        this.terminated = true;
      }
    };
    const mod = await import("../client/src/lib/onDeviceProduce");
    const first = await mod.classifyOnDevice(new Blob(["x"]));
    expect(first.result.fruit).toBe("apple");
    expect(mod.getOnDeviceState()).toMatchObject({ kind: "ready", threadMode: "worker" });

    workers[0].onerror?.({ message: "worker crashed" });
    const second = await mod.classifyOnDevice(new Blob(["x"]));
    expect(second.result.fruit).toBe("apple");
    expect(mod.getOnDeviceState()).toMatchObject({ kind: "ready", threadMode: "main" });
    expect(workers[0].terminated).toBe(true);
  });
});
