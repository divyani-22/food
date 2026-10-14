import {
  classifyOnDevice,
  ensureOnDeviceModel,
  isOnDeviceSupported,
} from "@/lib/onDeviceProduce";

export type Freshness = "fresh" | "normal" | "rotten";
export type Engine = "device" | "server";

export interface Classified {
  fruit: string;
  freshness: Freshness;
  pFresh: number;
  confidence: number;
  engine: Engine;
}

export type PhotoStatus = "queued" | "running" | "done" | "failed";

export interface QcPhoto {
  id: string;
  file: File;
  url: string;
  status: PhotoStatus;
  result?: Classified;
  error?: string;
}

export const MAX_PHOTOS = 200;
export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

/** Same storage key as the Fresh Produce page so the On-device/Server preference is shared. */
export const ENGINE_PREF_KEY = "ingrescan.produce.engine";

export function deviceSupported(): boolean {
  return isOnDeviceSupported();
}

export function readEnginePreference(): Engine {
  try {
    return window.localStorage.getItem(ENGINE_PREF_KEY) === "server" ? "server" : "device";
  } catch {
    return "device";
  }
}

export function writeEnginePreference(engine: Engine) {
  try {
    window.localStorage.setItem(ENGINE_PREF_KEY, engine);
  } catch {
    // not remembered; harmless
  }
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Cancelled", "AbortError"));
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("Cancelled", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("Could not read the photo"));
    r.readAsDataURL(blob);
  });
}

/** Downscale large photos (max 1280px, JPEG) before upload: smaller request, same model input size. */
async function toUploadDataUrl(file: File): Promise<string> {
  const MAX = 1280;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    if (scale >= 1 && file.size < 1_500_000) {
      bmp.close();
      return await readAsDataUrl(file);
    }
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bmp.close();
      return await readAsDataUrl(file);
    }
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    return canvas.toDataURL("image/jpeg", 0.9);
  } catch {
    return await readAsDataUrl(file);
  }
}

interface ServerPrediction {
  fruit: string;
  confidence: number;
  p_fresh: number;
  freshness_status: Freshness;
}

function validPrediction(p: Partial<ServerPrediction> | null | undefined): Classified | null {
  if (!p) return null;
  const f = p.freshness_status;
  if (f !== "fresh" && f !== "normal" && f !== "rotten") return null;
  if (typeof p.fruit !== "string" || !p.fruit) return null;
  if (typeof p.p_fresh !== "number" || !Number.isFinite(p.p_fresh)) return null;
  if (typeof p.confidence !== "number" || !Number.isFinite(p.confidence)) return null;
  return {
    fruit: p.fruit,
    freshness: f,
    pFresh: Math.min(100, Math.max(0, p.p_fresh)),
    confidence: Math.min(100, Math.max(0, p.confidence)),
    engine: "server",
  };
}

/** The server limits /api/freshguard to 60 requests per minute: honour Retry-After instead of failing the photo. */
export async function classifyOnServer(file: File, signal: AbortSignal): Promise<Classified> {
  const image = await toUploadDataUrl(file);
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch("/api/freshguard/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image }),
      signal,
    });
    if (res.status === 429 && attempt < 3) {
      const wait = Number(res.headers.get("Retry-After"));
      await sleep((Number.isFinite(wait) && wait > 0 ? Math.min(wait, 65) : 5) * 1000, signal);
      continue;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error || `Server classification failed (${res.status})`);
    }
    const parsed = validPrediction(await res.json().catch(() => null));
    if (!parsed) throw new Error("The classifier returned an unusable result");
    return parsed;
  }
  throw new Error("The classification service is rate limited; try again in a minute");
}

export interface RunOptions {
  photos: QcPhoto[];
  preferDevice: boolean;
  signal: AbortSignal;
  onUpdate: (id: string, patch: Partial<QcPhoto>) => void;
  onNotice: (message: string) => void;
}

/**
 * Classifies queued photos one by one (never in parallel, UI thread stays free between photos).
 * On-device first when preferred; if the model cannot load the rest goes to the server. A photo that
 * fails both paths is marked failed with the reason and never receives a result.
 */
export async function classifyQueue(opts: RunOptions): Promise<{ usedDevice: number; usedServer: number }> {
  const { photos, signal, onUpdate, onNotice } = opts;
  let deviceOk = opts.preferDevice && deviceSupported();
  let usedDevice = 0;
  let usedServer = 0;

  if (deviceOk) {
    try {
      await ensureOnDeviceModel();
    } catch (err) {
      deviceOk = false;
      onNotice(`On-device model unavailable (${err instanceof Error ? err.message : "unknown error"}). Using the server instead.`);
    }
  }

  for (const photo of photos) {
    if (signal.aborted) break;
    onUpdate(photo.id, { status: "running", error: undefined });
    await tick();
    try {
      let result: Classified | null = null;
      if (deviceOk) {
        try {
          const run = await classifyOnDevice(photo.file);
          const p = validPrediction(run.result as unknown as Partial<ServerPrediction>);
          if (p) result = { ...p, engine: "device" };
        } catch {
          result = null; // fall through to the server for this photo
        }
        if (result) usedDevice++;
      }
      if (!result) {
        result = await classifyOnServer(photo.file, signal);
        usedServer++;
      }
      onUpdate(photo.id, { status: "done", result });
    } catch (err) {
      if (signal.aborted) {
        onUpdate(photo.id, { status: "queued" });
        break;
      }
      onUpdate(photo.id, { status: "failed", error: err instanceof Error ? err.message : "Classification failed" });
    }
    await tick();
  }
  return { usedDevice, usedServer };
}
