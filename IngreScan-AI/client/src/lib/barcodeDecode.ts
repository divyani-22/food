/**
 * Browser-side barcode decoding for camera frames and photos.
 *
 *  - Uses the native BarcodeDetector API when the browser has it (Chrome/Edge on Android, ChromeOS, macOS,
 *    recent Chrome on Windows) and @zxing/browser everywhere else. For still photos both engines are tried.
 *  - Formats are limited to EAN-13, EAN-8, UPC-A and UPC-E.
 *  - Photos that fail to decode are retried with cheap preprocessing variants before giving up.
 *
 * Pure validation lives in ./barcode (unit-tested in node); this module needs a DOM.
 */
import { pickBestCandidate, type BestCandidate, type DecodedCandidate } from "./barcode";

export const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"] as const;

type NativeDetector = { detect(source: unknown): Promise<Array<{ rawValue: string; format: string }>> };

let nativePromise: Promise<NativeDetector | null> | null = null;

/** Resolves to a native BarcodeDetector limited to our formats, or null when unsupported. */
export function getNativeDetector(): Promise<NativeDetector | null> {
  if (nativePromise) return nativePromise;
  nativePromise = (async () => {
    try {
      const BD = (globalThis as any).BarcodeDetector;
      if (!BD) return null;
      const supported: string[] = typeof BD.getSupportedFormats === "function" ? await BD.getSupportedFormats() : [...NATIVE_FORMATS];
      const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
      if (formats.length === 0) return null;
      return new BD({ formats }) as NativeDetector;
    } catch {
      return null;
    }
  })();
  return nativePromise;
}

export function nativeDetectorAvailable(): boolean {
  return typeof (globalThis as any).BarcodeDetector !== "undefined";
}

// ------------------------------------------------------------------ zxing (lazy)

type ZxingBits = {
  reader: { decodeFromCanvas(c: HTMLCanvasElement): { getText(): string; getBarcodeFormat(): number } };
  BarcodeFormat: Record<number, string>;
  ChecksumException: new (...args: any[]) => Error;
};
let zxingPromise: Promise<ZxingBits> | null = null;

function loadZxing(): Promise<ZxingBits> {
  if (!zxingPromise) {
    zxingPromise = (async () => {
      const [{ BrowserMultiFormatReader }, lib] = await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
      const hints = new Map<any, any>();
      hints.set(lib.DecodeHintType.POSSIBLE_FORMATS, [
        lib.BarcodeFormat.EAN_13,
        lib.BarcodeFormat.EAN_8,
        lib.BarcodeFormat.UPC_A,
        lib.BarcodeFormat.UPC_E,
      ]);
      hints.set(lib.DecodeHintType.TRY_HARDER, true);
      const reader = new BrowserMultiFormatReader(hints);
      return { reader: reader as any, BarcodeFormat: lib.BarcodeFormat as any, ChecksumException: lib.ChecksumException as any };
    })().catch((err) => {
      zxingPromise = null; // allow a retry after a failed chunk load
      throw err;
    });
  }
  return zxingPromise;
}

type ZxingOutcome = { candidates: DecodedCandidate[]; checksumFailed: boolean };

/**
 * zxing validates EAN/UPC check digits itself and throws ChecksumException when a barcode is found but its
 * check digit is wrong. We cannot read the digits in that case, but we can tell the user a code was seen.
 */
async function decodeCanvasZxing(canvas: HTMLCanvasElement): Promise<ZxingOutcome> {
  const z = await loadZxing();
  try {
    const r = z.reader.decodeFromCanvas(canvas);
    return { candidates: [{ rawValue: r.getText(), format: z.BarcodeFormat[r.getBarcodeFormat()] ?? null }], checksumFailed: false };
  } catch (err) {
    return { candidates: [], checksumFailed: err instanceof z.ChecksumException || (err as any)?.name === "ChecksumException" };
  }
}

async function decodeNative(source: unknown): Promise<DecodedCandidate[]> {
  const d = await getNativeDetector();
  if (!d) return [];
  try {
    const found = await d.detect(source);
    return found.map((f) => ({ rawValue: f.rawValue, format: f.format }));
  } catch {
    return [];
  }
}

/** Decode one canvas with every available engine. */
export async function decodeCanvas(canvas: HTMLCanvasElement): Promise<ZxingOutcome> {
  const out: DecodedCandidate[] = [];
  out.push(...(await decodeNative(canvas)));
  if (pickBestCandidate(out)?.check.ok) return { candidates: out, checksumFailed: false };
  const z = await decodeCanvasZxing(canvas);
  return { candidates: [...out, ...z.candidates], checksumFailed: z.checksumFailed };
}

// ------------------------------------------------------------------ preprocessing

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function scaled(src: HTMLCanvasElement, factor: number): HTMLCanvasElement {
  const c = makeCanvas(src.width * factor, src.height * factor);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

function rotated(src: HTMLCanvasElement, deg: 90 | 180 | 270): HTMLCanvasElement {
  const swap = deg !== 180;
  const c = makeCanvas(swap ? src.height : src.width, swap ? src.width : src.height);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

function cropped(src: HTMLCanvasElement, x: number, y: number, w: number, h: number): HTMLCanvasElement {
  const c = makeCanvas(src.width * w, src.height * h);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src, src.width * x, src.height * y, src.width * w, src.height * h, 0, 0, c.width, c.height);
  return c;
}

/** Grayscale + auto-levels (stretch the 2nd..98th luminance percentile to 0..255). */
function grayscaleContrast(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = makeCanvas(src.width, src.height);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const px = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    const y = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
    px[i] = px[i + 1] = px[i + 2] = y;
    hist[y]++;
  }
  const total = px.length / 4;
  let acc = 0;
  let lo = 0;
  let hi = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= total * 0.02) { lo = v; break; }
  }
  acc = 0;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc >= total * 0.02) { hi = v; break; }
  }
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((px[i] - lo) * 255) / range));
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ------------------------------------------------------------------ still images

export const MAX_DECODE_DIM = 1600;

async function loadImageToCanvas(file: Blob): Promise<HTMLCanvasElement> {
  let bitmap: ImageBitmap | HTMLImageElement | null = null;
  let revoke: (() => void) | null = null;
  try {
    if (typeof createImageBitmap === "function") {
      try {
        bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
      } catch {
        bitmap = null;
      }
    }
    if (!bitmap) {
      const url = URL.createObjectURL(file);
      revoke = () => URL.revokeObjectURL(url);
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("This file could not be read as an image."));
        img.src = url;
      });
      bitmap = img;
    }
    const w = (bitmap as any).naturalWidth || bitmap.width;
    const h = (bitmap as any).naturalHeight || bitmap.height;
    if (!w || !h) throw new Error("This file could not be read as an image.");
    const f = Math.min(1, MAX_DECODE_DIM / Math.max(w, h));
    const c = makeCanvas(w * f, h * f);
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0, c.width, c.height);
    return c;
  } finally {
    if (bitmap && "close" in bitmap) (bitmap as ImageBitmap).close();
    revoke?.();
  }
}

export type PhotoDecodeResult =
  | { status: "found"; best: BestCandidate; variant: string; attempts: number }
  /** A code was read but its check digit is wrong (likely misread); no variant produced a valid one. */
  | { status: "invalid"; best: BestCandidate; variant: string; attempts: number }
  /** A barcode was detected in at least one variant but its check digit never verified, so the digits are unknown. */
  | { status: "checksum_failed"; attempts: number }
  | { status: "none"; attempts: number }
  | { status: "error"; message: string };

type Variant = { name: string; make: () => HTMLCanvasElement };

function buildVariants(base: HTMLCanvasElement): Variant[] {
  const v: Variant[] = [];
  let gray: HTMLCanvasElement | null = null;
  const g = () => (gray ??= grayscaleContrast(base));
  v.push({ name: "original", make: () => base });
  v.push({ name: "grayscale-contrast", make: g });
  v.push({ name: "downscale-50", make: () => scaled(base, 0.5) });
  v.push({ name: "downscale-50-contrast", make: () => scaled(g(), 0.5) });
  v.push({ name: "upscale-150", make: () => scaled(g(), 1.5) });
  for (const deg of [90, 180, 270] as const) {
    v.push({ name: `rotate-${deg}`, make: () => rotated(base, deg) });
    v.push({ name: `rotate-${deg}-contrast`, make: () => rotated(g(), deg) });
  }
  // Barcode in a corner of a busy product photo: look at overlapping halves at higher effective resolution.
  v.push({ name: "crop-bottom", make: () => scaled(cropped(g(), 0, 0.4, 1, 0.6), 1.5) });
  v.push({ name: "crop-top", make: () => scaled(cropped(g(), 0, 0, 1, 0.6), 1.5) });
  v.push({ name: "crop-left", make: () => scaled(cropped(g(), 0, 0, 0.6, 1), 1.5) });
  v.push({ name: "crop-right", make: () => scaled(cropped(g(), 0.4, 0, 0.6, 1), 1.5) });
  return v;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Try to read a barcode from a photo. Stops at the first variant that yields a code with a valid check digit.
 * If only invalid reads occur, returns the first of them so the caller can warn the user.
 */
export async function decodeBarcodeFromFile(
  file: Blob,
  opts: { signal?: AbortSignal; onProgress?: (variant: string, index: number, total: number) => void } = {},
): Promise<PhotoDecodeResult> {
  let base: HTMLCanvasElement;
  try {
    base = await loadImageToCanvas(file);
  } catch (err: any) {
    return { status: "error", message: err?.message || "This file could not be read as an image." };
  }
  const variants = buildVariants(base);
  let firstInvalid: { best: BestCandidate; variant: string } | null = null;
  let sawChecksumFailure = false;
  let attempts = 0;
  for (let i = 0; i < variants.length; i++) {
    if (opts.signal?.aborted) return { status: "none", attempts };
    const variant = variants[i];
    opts.onProgress?.(variant.name, i, variants.length);
    attempts++;
    let candidates: DecodedCandidate[] = [];
    try {
      const out = await decodeCanvas(variant.make());
      candidates = out.candidates;
      if (out.checksumFailed) sawChecksumFailure = true;
    } catch (err: any) {
      // The decoder library itself failed to load (e.g. offline chunk); the first variant would fail too.
      if (i === 0) return { status: "error", message: "The barcode reader could not be loaded. Check your connection or type the number instead." };
    }
    const best = pickBestCandidate(candidates);
    if (best?.check.ok) return { status: "found", best, variant: variant.name, attempts };
    if (best && !firstInvalid) firstInvalid = { best, variant: variant.name };
    await tick();
  }
  if (firstInvalid) return { status: "invalid", ...firstInvalid, attempts };
  if (sawChecksumFailure) return { status: "checksum_failed", attempts };
  return { status: "none", attempts };
}

// ------------------------------------------------------------------ live camera

export type CameraErrorKind = "insecure" | "unsupported" | "denied" | "no_camera" | "busy" | "other";

export class CameraError extends Error {
  constructor(readonly kind: CameraErrorKind, message: string) {
    super(message);
    this.name = "CameraError";
  }
}

/** Open the rear camera when possible. Throws CameraError with a user-presentable message. */
export async function openCameraStream(): Promise<MediaStream> {
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    throw new CameraError(
      "insecure",
      `The camera only works on HTTPS pages or on localhost, and this page is served from ${window.location.origin}. Use "Scan from photo" or type the number instead.`,
    );
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError("unsupported", "This browser cannot access the camera. Use \"Scan from photo\" or type the number instead.");
  }
  const attempts: MediaStreamConstraints[] = [
    { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
    { video: true, audio: false },
  ];
  let lastErr: any = null;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err: any) {
      lastErr = err;
      if (err?.name === "NotAllowedError" || err?.name === "SecurityError" || err?.name === "NotFoundError" || err?.name === "NotReadableError") break;
    }
  }
  switch (lastErr?.name) {
    case "NotAllowedError":
    case "SecurityError":
      throw new CameraError("denied", "Camera permission was denied. Allow camera access in your browser's site settings and try again, or use a photo instead.");
    case "NotFoundError":
    case "DevicesNotFoundError":
      throw new CameraError("no_camera", "No camera was found on this device. Use \"Scan from photo\" or type the number instead.");
    case "NotReadableError":
    case "TrackStartError":
      throw new CameraError("busy", "The camera is in use by another app or tab. Close it and try again.");
    default:
      throw new CameraError("other", lastErr?.message ? `Could not start the camera: ${lastErr.message}` : "Could not start the camera.");
  }
}

export function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((t) => {
    try {
      t.stop();
    } catch {
      /* ignore */
    }
  });
}

export type LiveScanHandle = { stop(): void; engine: "native" | "zxing" };

/**
 * Decode frames from a playing <video> until stop() is called. Calls onCandidates with every non-empty
 * decode result (the caller picks the best, debounces and decides when to stop).
 */
export async function startLiveDecoding(
  video: HTMLVideoElement,
  onCandidates: (c: DecodedCandidate[]) => void,
  opts: { intervalMs?: number; onChecksumFailure?: () => void } = {},
): Promise<LiveScanHandle> {
  const native = await getNativeDetector();
  const interval = opts.intervalMs ?? (native ? 120 : 200);
  let zx: ZxingBits | null = null;
  if (!native) zx = await loadZxing();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let busy = false;
  const canvas = document.createElement("canvas");

  const loop = async () => {
    if (stopped) return;
    if (!busy && video.readyState >= 2 && video.videoWidth > 0) {
      busy = true;
      try {
        let found: DecodedCandidate[] = [];
        let checksumFailed = false;
        if (native) {
          found = await decodeNative(video);
        } else if (zx) {
          const f = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.round(video.videoWidth * f);
          canvas.height = Math.round(video.videoHeight * f);
          canvas.getContext("2d", { willReadFrequently: true })!.drawImage(video, 0, 0, canvas.width, canvas.height);
          const out = await decodeCanvasZxing(canvas);
          found = out.candidates;
          checksumFailed = out.checksumFailed;
        }
        if (!stopped && found.length) onCandidates(found);
        else if (!stopped && checksumFailed) opts.onChecksumFailure?.();
      } finally {
        busy = false;
      }
    }
    if (!stopped) timer = setTimeout(loop, interval);
  };
  timer = setTimeout(loop, interval);

  return {
    engine: native ? "native" : "zxing",
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
