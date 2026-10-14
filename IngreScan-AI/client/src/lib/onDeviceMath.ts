/**
 * Pure helpers for on-device FreshGuard inference. No DOM, no onnxruntime: everything here is deterministic
 * and unit-tested (server/onDevice.test.ts).
 *
 * The image pipeline reproduces the Python one in app.py exactly:
 *   ImageOps.exif_transpose -> convert("RGB") -> Resize(256) -> CenterCrop(224) -> ToTensor -> Normalize
 * including Pillow's antialiased bilinear ("triangle") resampling with its 8-bit fixed-point arithmetic and
 * the uint8 rounding between the horizontal and the vertical pass. Canvas drawImage() smoothing is NOT used
 * for resizing because it does not antialias large downscales the way PIL does.
 */
import knowledgeJson from "./fruitInfo.json";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FreshnessStatus = "fresh" | "normal" | "rotten";

export interface FruitKnowledge {
  kr: string;
  shelf_life_days: Record<FreshnessStatus, number>;
  storage: string;
  cooking_fresh: string;
  cooking_normal: string;
  cooking_rotten: string;
}

export interface Knowledge {
  fruits: Record<string, FruitKnowledge>;
  freshness: {
    fresh_threshold: number;
    rotten_threshold: number;
    statuses: Record<FreshnessStatus, { status_kr: string; badge_color: string; message: string }>;
  };
  defaults: { shelf_life_days: number; storage: string; cooking: string };
}

export interface ModelMeta {
  model_bytes: number;
  model_sha256: string;
  fruit_names: string[];
  fresh_labels: string[];
  fresh_index: number;
  input: { name: string; shape: number[] };
  outputs: { fruit: string; fresh: string };
  preprocess: { resize_shorter_side: number; center_crop: number; mean: number[]; std: number[] };
}

/** Same shape as the Flask service's PredictionResult (image_url is empty: nothing was uploaded). */
export interface OnDevicePrediction {
  fruit: string;
  fruit_kr: string;
  confidence: number;
  p_fresh: number;
  freshness_status: FreshnessStatus;
  freshness_kr: string;
  badge_color: string;
  status_message: string;
  shelf_life_days: number;
  storage_tips: string;
  cooking_tips: string;
  image_url: string;
  top_candidates: Array<{ code: string; name_kr: string; probability: number }>;
}

export const KNOWLEDGE = knowledgeJson as unknown as Knowledge;

// ---------------------------------------------------------------------------
// Post-processing
// ---------------------------------------------------------------------------

/** Numerically stable softmax (float64 accumulation). */
export function softmax(logits: ArrayLike<number>): number[] {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) if (logits[i] > max) max = logits[i];
  const exps = new Array<number>(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    exps[i] = Math.exp(logits[i] - max);
    sum += exps[i];
  }
  return exps.map((e) => e / sum);
}

/** Python's round(x, 1) for the values used here (ties go to the even neighbour, like Python). */
export function round1(x: number): number {
  const t = x * 10;
  const f = Math.floor(t);
  if (t - f === 0.5) return (f % 2 === 0 ? f : f + 1) / 10;
  return Math.round(t) / 10;
}

/** Same rules as fruit_info.evaluate_freshness (thresholds and wording come from fruitInfo.json). */
export function evaluateFreshness(pFresh: number, k: Knowledge = KNOWLEDGE) {
  const { fresh_threshold, rotten_threshold, statuses } = k.freshness;
  const status: FreshnessStatus = pFresh >= fresh_threshold ? "fresh" : pFresh <= rotten_threshold ? "rotten" : "normal";
  const meta = statuses[status];
  return { status, status_kr: meta.status_kr, badge_color: meta.badge_color, message: meta.message };
}

/** Mirrors app.run_inference's post-processing and rounding. */
export function buildPredictionResult(
  meta: Pick<ModelMeta, "fruit_names" | "fresh_index">,
  fruitLogits: ArrayLike<number>,
  freshLogits: ArrayLike<number>,
  k: Knowledge = KNOWLEDGE,
): OnDevicePrediction {
  const fruitProbs = softmax(fruitLogits);
  const freshProbs = softmax(freshLogits);
  let best = 0;
  for (let i = 1; i < fruitProbs.length; i++) if (fruitProbs[i] > fruitProbs[best]) best = i;
  const fruitCode = meta.fruit_names[best];
  const pFresh = freshProbs[meta.fresh_index];

  const candidates = fruitProbs.map((p, idx) => {
    const code = meta.fruit_names[idx];
    return { code, name_kr: k.fruits[code]?.kr ?? code, probability: round1(p * 100) };
  });
  // Array.prototype.sort is stable, like Python's sort: ties keep class-index order.
  candidates.sort((a, b) => b.probability - a.probability);

  const status = evaluateFreshness(pFresh, k);
  const info = k.fruits[fruitCode];
  const cookingKey = `cooking_${status.status}` as "cooking_fresh" | "cooking_normal" | "cooking_rotten";
  return {
    fruit: fruitCode,
    fruit_kr: info?.kr ?? fruitCode,
    confidence: round1(fruitProbs[best] * 100),
    p_fresh: round1(pFresh * 100),
    freshness_status: status.status,
    freshness_kr: status.status_kr,
    badge_color: status.badge_color,
    status_message: status.message,
    shelf_life_days: info?.shelf_life_days?.[status.status] ?? k.defaults.shelf_life_days,
    storage_tips: info?.storage ?? k.defaults.storage,
    cooking_tips: info?.[cookingKey] ?? k.defaults.cooking,
    image_url: "",
    top_candidates: candidates.slice(0, 4),
  };
}

// ---------------------------------------------------------------------------
// Preprocessing (PIL / torchvision equivalent)
// ---------------------------------------------------------------------------

/** torchvision Resize(size) on the shorter side: the longer side is int(size * long / short). */
export function resizeDims(w: number, h: number, size: number): [number, number] {
  if (w <= h) {
    if (w === size) return [w, h];
    return [size, Math.trunc((size * h) / w)];
  }
  if (h === size) return [w, h];
  return [Math.trunc((size * w) / h), size];
}

/** Python's round() (half to even) for non-negative numbers. */
export function pyRound(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d === 0.5) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}

/** torchvision CenterCrop offsets: int(round((len - crop) / 2.0)). */
export function centerCropOffset(len: number, crop: number): number {
  return pyRound((len - crop) / 2);
}

const PRECISION_BITS = 32 - 8 - 2; // Pillow's 8bpc fixed-point precision

export interface Coeffs {
  /** [xmin, count] per output index */
  bounds: Int32Array;
  /** fixed-point weights, ksize per output index */
  kk: Int32Array;
  ksize: number;
}

/** Pillow's precompute_coeffs() for the BILINEAR (triangle) filter, converted to 8bpc fixed point. */
export function precomputeCoeffs(inSize: number, outSize: number, outStart = 0, outCount = outSize): Coeffs {
  const scale = inSize / outSize;
  const filterscale = Math.max(scale, 1);
  const support = 1 * filterscale;
  const ksize = Math.ceil(support) * 2 + 1;
  const bounds = new Int32Array(outCount * 2);
  const kk = new Int32Array(outCount * ksize);
  const w = new Float64Array(ksize);
  const ss = 1 / filterscale;
  for (let i = 0; i < outCount; i++) {
    const xx = outStart + i;
    const center = (xx + 0.5) * scale;
    let xmin = Math.trunc(center - support + 0.5);
    if (xmin < 0) xmin = 0;
    let xmax = Math.trunc(center + support + 0.5);
    if (xmax > inSize) xmax = inSize;
    xmax -= xmin;
    w.fill(0);
    let sum = 0;
    for (let x = 0; x < xmax; x++) {
      const v = Math.abs((x + xmin - center + 0.5) * ss);
      const f = v < 1 ? 1 - v : 0;
      w[x] = f;
      sum += f;
    }
    for (let x = 0; x < xmax; x++) {
      const nw = sum !== 0 ? w[x] / sum : w[x];
      kk[i * ksize + x] = Math.trunc(nw * (1 << PRECISION_BITS) + (nw < 0 ? -0.5 : 0.5));
    }
    bounds[i * 2] = xmin;
    bounds[i * 2 + 1] = xmax;
  }
  return { bounds, kk, ksize };
}

export interface ResizedCrop {
  /** RGB, row-major, cropSize x cropSize x 3, uint8 */
  rgb: Uint8Array;
}

/**
 * Resize(shorter side = resize) + CenterCrop(crop) of an RGBA image delivered in row bands.
 * `readRows(y0, n)` must return RGBA data for source rows [y0, y0 + n) (n * srcW * 4 bytes).
 * Only the rows/columns that survive the crop are computed (results are identical to resizing the
 * whole image first, because every output pixel depends only on its own filter window).
 */
export function resizeCenterCrop(
  srcW: number,
  srcH: number,
  readRows: (y0: number, n: number) => Uint8ClampedArray | Uint8Array,
  resize = 256,
  crop = 224,
  bandRows = 128,
): ResizedCrop {
  const [rw, rh] = resizeDims(srcW, srcH, resize);
  const left = centerCropOffset(rw, crop);
  const top = centerCropOffset(rh, crop);
  const cw = Math.min(crop, rw);
  const ch = Math.min(crop, rh);

  const needH = rw !== srcW;
  const needV = rh !== srcH;
  const hc = needH ? precomputeCoeffs(srcW, rw, left, cw) : null;
  const vc = needV ? precomputeCoeffs(srcH, rh, top, ch) : null;

  // Source rows required by the vertical pass.
  let rowMin = top;
  let rowMax = top + ch; // exclusive
  if (vc) {
    rowMin = Infinity;
    rowMax = -Infinity;
    for (let i = 0; i < ch; i++) {
      const a = vc.bounds[i * 2];
      rowMin = Math.min(rowMin, a);
      rowMax = Math.max(rowMax, a + vc.bounds[i * 2 + 1]);
    }
  }

  // Horizontal pass -> uint8 intermediate (cw x (rowMax-rowMin) x 3), rounded exactly like Pillow.
  const nRows = rowMax - rowMin;
  const mid = new Uint8Array(cw * nRows * 3);
  const half = 1 << (PRECISION_BITS - 1);
  for (let y0 = rowMin; y0 < rowMax; y0 += bandRows) {
    const n = Math.min(bandRows, rowMax - y0);
    const px = readRows(y0, n);
    for (let r = 0; r < n; r++) {
      const rowBase = r * srcW * 4;
      const outBase = ((y0 - rowMin + r) * cw) * 3;
      for (let x = 0; x < cw; x++) {
        let s0 = half, s1 = half, s2 = half;
        if (hc) {
          const xmin = hc.bounds[x * 2];
          const cnt = hc.bounds[x * 2 + 1];
          const kb = x * hc.ksize;
          for (let k = 0; k < cnt; k++) {
            const w = hc.kk[kb + k];
            const p = rowBase + (xmin + k) * 4;
            s0 += px[p] * w;
            s1 += px[p + 1] * w;
            s2 += px[p + 2] * w;
          }
        } else {
          const p = rowBase + (left + x) * 4;
          s0 += px[p] << PRECISION_BITS;
          s1 += px[p + 1] << PRECISION_BITS;
          s2 += px[p + 2] << PRECISION_BITS;
        }
        const o = outBase + x * 3;
        mid[o] = clip8(s0 >> PRECISION_BITS);
        mid[o + 1] = clip8(s1 >> PRECISION_BITS);
        mid[o + 2] = clip8(s2 >> PRECISION_BITS);
      }
    }
  }

  // Vertical pass.
  const rgb = new Uint8Array(cw * ch * 3);
  for (let y = 0; y < ch; y++) {
    if (vc) {
      const ymin = vc.bounds[y * 2];
      const cnt = vc.bounds[y * 2 + 1];
      const kb = y * vc.ksize;
      for (let x = 0; x < cw * 3; x++) {
        let s = half;
        for (let k = 0; k < cnt; k++) s += mid[(ymin + k - rowMin) * cw * 3 + x] * vc.kk[kb + k];
        rgb[y * cw * 3 + x] = clip8(s >> PRECISION_BITS);
      }
    } else {
      rgb.set(mid.subarray((top + y - rowMin) * cw * 3, (top + y - rowMin + 1) * cw * 3), y * cw * 3);
    }
  }
  return { rgb };
}

function clip8(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** ToTensor + Normalize: HWC uint8 RGB -> NCHW float32 ((x / 255 - mean) / std). */
export function toNormalizedTensor(
  rgb: Uint8Array,
  w: number,
  h: number,
  mean: readonly number[],
  std: readonly number[],
): Float32Array {
  const out = new Float32Array(3 * w * h);
  const plane = w * h;
  for (let c = 0; c < 3; c++) {
    const m = Math.fround(mean[c]);
    const s = Math.fround(std[c]);
    for (let i = 0; i < plane; i++) {
      out[c * plane + i] = (Math.fround(rgb[i * 3 + c] / 255) - m) / s;
    }
  }
  return out;
}
