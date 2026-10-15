import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MODEL = new Uint8Array(64).fill(7);
const WASM = new Uint8Array(32).fill(3);
const META = {
  model_bytes: MODEL.byteLength,
  model_sha256: "a".repeat(64),
  fruit_names: ["apple", "banana"],
  fresh_labels: ["fresh", "rotten"],
  fresh_index: 0,
  input: { name: "input", shape: [1, 3, 224, 224] },
  outputs: { fruit: "fruit_logits", fresh: "fresh_logits" },
  preprocess: { resize_shorter_side: 256, center_crop: 224, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] },
};

const created: Uint8Array[] = [];
let active = 0;
let maxActive = 0;

vi.mock("onnxruntime-web/wasm", () => ({
  env: { versions: { web: "1.0.0" }, wasm: {}, webgpu: {} },
  InferenceSession: {
    create: async (bytes: Uint8Array) => {
      created.push(bytes);
      return {
        run: async () => {
          active++;
          maxActive = Math.max(maxActive, active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
          return { fruit_logits: { data: new Float32Array([1, 0]) }, fresh_logits: { data: new Float32Array([0, 1]) } };
        },
      };
    },
  },
  Tensor: class {
    constructor(public type: string, public data: Float32Array, public dims: number[]) {}
  },
}));

function installBrowserStubs(store: Map<string, Response>, fetchLog: string[]) {
  const g = globalThis as any;
  g.self = { location: { href: "http://localhost/" } };
  g.caches = {
    open: async () => ({
      match: async (u: string) => store.get(u)?.clone(),
      put: async (u: string, r: Response) => void store.set(u, r),
      keys: async () => Array.from(store.keys()).map((url) => ({ url })),
      delete: async (u: string | { url: string }) => store.delete(typeof u === "string" ? u : u.url),
    }),
  };
  g.fetch = async (u: string) => {
    fetchLog.push(String(u));
    if (String(u).includes("freshguard.meta.json")) return new Response(JSON.stringify(META));
    if (String(u).includes("freshguard.onnx")) return new Response(MODEL, { headers: { "content-length": String(MODEL.byteLength) } });
    return new Response(WASM, { headers: { "content-length": String(WASM.byteLength) } });
  };
  g.createImageBitmap = async () => ({ width: 300, height: 300, close() {} });
  g.OffscreenCanvas = class {
    constructor(public w: number, public h: number) {}
    getContext() {
      const w = this.w;
      return {
        clearRect() {},
        drawImage() {},
        getImageData: (_x: number, _y: number, _w: number, n: number) => ({ data: new Uint8ClampedArray(w * n * 4) }),
      };
    }
  };
}

describe("OnDeviceEngine robustness", () => {
  const g = globalThis as any;
  let store: Map<string, Response>;
  let fetchLog: string[];
  beforeEach(() => {
    store = new Map();
    fetchLog = [];
    created.length = 0;
    active = 0;
    maxActive = 0;
    installBrowserStubs(store, fetchLog);
  });
  afterEach(() => {
    for (const k of ["self", "caches", "fetch", "createImageBitmap", "OffscreenCanvas"]) delete g[k];
  });

  it("re-downloads a truncated cached model instead of failing on it forever", async () => {
    const { OnDeviceEngine } = await import("../client/src/lib/onDeviceEngine");
    const modelUrl = `http://localhost/models/freshguard.onnx?sha=${"a".repeat(16)}`;
    store.set(modelUrl, new Response(new Uint8Array(10)));
    const engine = new OnDeviceEngine("");
    const info = await engine.load();
    expect(created).toHaveLength(1);
    expect(created[0].byteLength).toBe(MODEL.byteLength);
    expect(info.fromCache).toBe(false);
    expect(fetchLog.some((u) => u.includes("freshguard.onnx"))).toBe(true);
    expect((await store.get(modelUrl)!.clone().arrayBuffer()).byteLength).toBe(MODEL.byteLength);
  });

  it("uses an intact cached model without downloading it", async () => {
    const { OnDeviceEngine } = await import("../client/src/lib/onDeviceEngine");
    const modelUrl = `http://localhost/models/freshguard.onnx?sha=${"a".repeat(16)}`;
    store.set(modelUrl, new Response(MODEL));
    await new OnDeviceEngine("").load();
    expect(fetchLog.some((u) => u.includes("freshguard.onnx"))).toBe(false);
  });

  it("rejects a download whose size does not match the metadata", async () => {
    const { OnDeviceEngine } = await import("../client/src/lib/onDeviceEngine");
    g.fetch = async (u: string) => {
      if (String(u).includes("meta.json")) return new Response(JSON.stringify({ ...META, model_bytes: MODEL.byteLength + 1 }));
      return new Response(String(u).includes(".onnx") ? MODEL : WASM);
    };
    await expect(new OnDeviceEngine("").load()).rejects.toThrow(/wrong size/);
  });

  it("never runs the session concurrently", async () => {
    const { OnDeviceEngine } = await import("../client/src/lib/onDeviceEngine");
    const engine = new OnDeviceEngine("");
    await engine.load();
    const outs = await Promise.all([1, 2, 3, 4].map(() => engine.run(new Blob(["x"]))));
    expect(outs).toHaveLength(4);
    expect(maxActive).toBe(1);
  });

  it("a failed run does not block the queue", async () => {
    const { OnDeviceEngine } = await import("../client/src/lib/onDeviceEngine");
    const engine = new OnDeviceEngine("");
    await engine.load();
    g.createImageBitmap = async () => {
      throw new Error("bad image");
    };
    await expect(engine.run(new Blob(["x"]))).rejects.toThrow(/could not be decoded/);
    g.createImageBitmap = async () => ({ width: 300, height: 300, close() {} });
    await expect(engine.run(new Blob(["x"]))).resolves.toBeTruthy();
  });
});
