/**
 * B2B incoming-produce batch QC.
 *
 * PURE module: no I/O, no framework imports, deterministic. It grades single
 * photos from the freshness classifier, summarises a lot, scores vendors and
 * builds RFC 4180 CSV exports with spreadsheet formula-injection protection.
 *
 * IMPORTANT: this supports a human receiving decision, it does not replace
 * physical inspection. A photo grade is only as good as the classifier output
 * and the photo itself. Every verdict echoes the rule and the numbers it used
 * so the decision can be audited.
 */

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

export type QcGrade = "A" | "B" | "REJECT" | "REVIEW";
export type QcFreshnessStatus = "fresh" | "normal" | "rotten";
export type QcVerdict = "ACCEPT" | "ACCEPT_WITH_DISCOUNT" | "REJECT_LOT" | "INSPECT";

export type QcReasonCode =
  | "invalid_input"
  | "low_confidence"
  | "rotten_status"
  | "low_p_fresh"
  | "status_conflict"
  | "meets_a"
  | "status_normal"
  | "p_fresh_below_a"
  | "confidence_below_a";

export interface QcPhotoInput {
  freshness_status: string;
  /** 0-100 */
  p_fresh: number;
  /** 0-100 classification confidence */
  confidence: number;
  fruit?: string;
  photoId?: string;
}

export interface QcThresholds {
  /** Grade A needs p_fresh at or above this (default 80). */
  aMinPFresh: number;
  /** Grade A needs classification confidence at or above this (default 60). */
  aMinConfidence: number;
  /** p_fresh strictly below this is REJECT (default 30). */
  rejectBelowPFresh: number;
  /** Confidence strictly below this is REVIEW (default 50). */
  reviewBelowConfidence: number;
}

export interface QcAcceptance {
  /** Lot accepted when A+B share is at least this percent (default 90). */
  minAbPct: number;
  /** ... and REJECT share is at most this percent (default 5). */
  maxRejectPct: number;
  /** ... and REVIEW share is at most this percent (default 10). */
  maxReviewPct: number;
  /** Lot rejected when REJECT share is strictly above this percent (default 20). */
  rejectLotAbovePct: number;
  /** Samples smaller than this are flagged as not representative (default 20). */
  minSample: number;
}

export const DEFAULT_QC_THRESHOLDS: Readonly<QcThresholds> = Object.freeze({
  aMinPFresh: 80,
  aMinConfidence: 60,
  rejectBelowPFresh: 30,
  reviewBelowConfidence: 50,
});

export const DEFAULT_QC_ACCEPTANCE: Readonly<QcAcceptance> = Object.freeze({
  minAbPct: 90,
  maxRejectPct: 5,
  maxReviewPct: 10,
  rejectLotAbovePct: 20,
  minSample: 20,
});

export interface QcPhotoGrade {
  grade: QcGrade;
  reasons: string[];
  reasonCodes: QcReasonCode[];
  fruit: string;
  freshness_status: QcFreshnessStatus | null;
  p_fresh: number | null;
  confidence: number | null;
  photoId?: string;
}

export interface QcCounts {
  A: number;
  B: number;
  REVIEW: number;
  REJECT: number;
}

export interface QcPercentages extends QcCounts {
  /** A plus B. */
  AB: number;
}

export interface QcFruitBreakdown {
  fruit: string;
  count: number;
  counts: QcCounts;
  percentages: QcPercentages;
  meanPFresh: number | null;
}

export interface QcCheck {
  name: string;
  actual: number;
  op: ">=" | "<=" | ">";
  limit: number;
  passed: boolean;
}

export interface QcBatchSummary {
  vendor: string | null;
  lotId: string | null;
  receivedAt: string | null;
  totalPhotos: number;
  counts: QcCounts;
  percentages: QcPercentages;
  /** Photos that could not be graded because the input was malformed (counted as REVIEW). */
  invalidInputs: number;
  pFresh: { mean: number; median: number; min: number; max: number } | null;
  perFruit: QcFruitBreakdown[];
  verdict: QcVerdict;
  verdictReason: string;
  rule: { description: string; acceptance: QcAcceptance; thresholds: QcThresholds };
  checks: QcCheck[];
  /** Wilson 95% interval for the REJECT share in percent, or null for an empty batch. */
  rejectRateCi95: [number, number] | null;
  statisticalNote: string;
  lowSample: boolean;
  declaredSampleSize: number | null;
  warnings: string[];
  photos: QcPhotoGrade[];
}

export interface SummarizeBatchOptions {
  vendor?: string;
  lotId?: string;
  /** Physical sample size declared by the receiver (informational). */
  sampleSize?: number;
  /** ISO date or date-time the lot was received (used for vendor trends). */
  receivedAt?: string;
  thresholds?: Partial<QcThresholds>;
  acceptance?: Partial<QcAcceptance>;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

const MAX_PHOTOS = 100_000;
const MAX_TEXT = 80;

/** Round to one decimal place, safe for NaN / Infinity (returns 0). */
export function round1(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const r = Math.round((x + Number.EPSILON * Math.sign(x)) * 10) / 10;
  return r === 0 ? 0 : r;
}

function pct(n: number, total: number): number {
  if (!(total > 0) || !Number.isFinite(n)) return 0;
  return round1((n / total) * 100);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function cleanText(v: unknown, fallback: string | null): string | null {
  if (typeof v !== "string" && typeof v !== "number") return fallback;
  const s = String(v)
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT);
  return s.length > 0 ? s : fallback;
}

function finiteInRange(v: unknown, lo: number, hi: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return v;
}

function mergeThresholds(t: Partial<QcThresholds> | undefined): QcThresholds {
  const out: QcThresholds = { ...DEFAULT_QC_THRESHOLDS };
  if (isRecord(t)) {
    (Object.keys(out) as Array<keyof QcThresholds>).forEach((k) => {
      const v = finiteInRange((t as Record<string, unknown>)[k], 0, 100);
      if (v !== null) out[k] = v;
    });
  }
  if (out.rejectBelowPFresh > out.aMinPFresh) out.rejectBelowPFresh = out.aMinPFresh;
  return out;
}

function mergeAcceptance(a: Partial<QcAcceptance> | undefined): QcAcceptance {
  const out: QcAcceptance = { ...DEFAULT_QC_ACCEPTANCE };
  if (isRecord(a)) {
    (["minAbPct", "maxRejectPct", "maxReviewPct", "rejectLotAbovePct"] as const).forEach((k) => {
      const v = finiteInRange((a as Record<string, unknown>)[k], 0, 100);
      if (v !== null) out[k] = v;
    });
    const ms = finiteInRange((a as Record<string, unknown>).minSample, 0, 1_000_000);
    if (ms !== null) out.minSample = Math.floor(ms);
  }
  return out;
}

function normalizeFruit(v: unknown): string {
  const s = typeof v === "string" ? v : "";
  const t = s
    .toLowerCase()
    .replace(/[^a-z0-9 _-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
  return t.length > 0 ? t : "unknown";
}

/* ------------------------------------------------------------------ */
/* Single photo                                                         */
/* ------------------------------------------------------------------ */

function invalidGrade(why: string, fruit: string, photoId?: string): QcPhotoGrade {
  return {
    grade: "REVIEW",
    reasons: [`Input could not be graded (${why}); manual inspection required.`],
    reasonCodes: ["invalid_input"],
    fruit,
    freshness_status: null,
    p_fresh: null,
    confidence: null,
    ...(photoId ? { photoId } : {}),
  };
}

/**
 * Grade one photo result.
 *
 * Order of evaluation (first match wins):
 *   1. malformed input                                  -> REVIEW
 *   2. confidence <  reviewBelowConfidence (50)         -> REVIEW  (cannot be trusted either way)
 *   3. status "rotten"                                  -> REJECT
 *   4. p_fresh <  rejectBelowPFresh (30)                -> REJECT
 *   5. status "fresh", p_fresh >= 80, confidence >= 60  -> A
 *   6. everything else                                  -> B
 */
export function gradePhoto(input: unknown, thresholds?: Partial<QcThresholds>): QcPhotoGrade {
  const th = mergeThresholds(thresholds);
  if (!isRecord(input)) return invalidGrade("not an object", "unknown");
  const fruit = normalizeFruit(input.fruit);
  const photoId = cleanText(input.photoId, null) ?? undefined;

  const statusRaw = typeof input.freshness_status === "string" ? input.freshness_status.trim().toLowerCase() : "";
  if (statusRaw !== "fresh" && statusRaw !== "normal" && statusRaw !== "rotten") {
    return invalidGrade("unknown freshness_status", fruit, photoId);
  }
  const status: QcFreshnessStatus = statusRaw;
  const p = finiteInRange(input.p_fresh, 0, 100);
  const c = finiteInRange(input.confidence, 0, 100);
  if (p === null) return invalidGrade("p_fresh missing or outside 0-100", fruit, photoId);
  if (c === null) return invalidGrade("confidence missing or outside 0-100", fruit, photoId);

  const base = { fruit, freshness_status: status, p_fresh: p, confidence: c, ...(photoId ? { photoId } : {}) };
  const reasons: string[] = [];
  const codes: QcReasonCode[] = [];

  if (c < th.reviewBelowConfidence) {
    reasons.push(`Classification confidence ${c} is below ${th.reviewBelowConfidence}: result not trustworthy, inspect manually.`);
    codes.push("low_confidence");
    return { grade: "REVIEW", reasons, reasonCodes: codes, ...base };
  }
  if (status === "rotten") {
    reasons.push("Classified as rotten.");
    codes.push("rotten_status");
    if (p >= th.aMinPFresh) {
      reasons.push(`Conflicting signals: p_fresh ${p} is high but status is rotten; rejected to stay on the safe side.`);
      codes.push("status_conflict");
    }
    return { grade: "REJECT", reasons, reasonCodes: codes, ...base };
  }
  if (p < th.rejectBelowPFresh) {
    reasons.push(`p_fresh ${p} is below ${th.rejectBelowPFresh}.`);
    codes.push("low_p_fresh");
    if (status === "fresh") {
      reasons.push("Conflicting signals: status is fresh but p_fresh is very low; rejected to stay on the safe side.");
      codes.push("status_conflict");
    }
    return { grade: "REJECT", reasons, reasonCodes: codes, ...base };
  }
  if (status === "fresh" && p >= th.aMinPFresh && c >= th.aMinConfidence) {
    reasons.push(`Fresh, p_fresh ${p} >= ${th.aMinPFresh}, confidence ${c} >= ${th.aMinConfidence}.`);
    codes.push("meets_a");
    return { grade: "A", reasons, reasonCodes: codes, ...base };
  }
  if (status === "normal") {
    reasons.push("Classified as normal (acceptable but not fresh).");
    codes.push("status_normal");
  }
  if (p < th.aMinPFresh) {
    reasons.push(`p_fresh ${p} is below the grade A minimum of ${th.aMinPFresh}.`);
    codes.push("p_fresh_below_a");
  }
  if (c < th.aMinConfidence) {
    reasons.push(`Confidence ${c} is below the grade A minimum of ${th.aMinConfidence}.`);
    codes.push("confidence_below_a");
  }
  if (codes.length === 0) {
    // status normal with high p_fresh and confidence is already covered; this guards future edits.
    reasons.push("Does not meet grade A criteria.");
    codes.push("status_normal");
  }
  return { grade: "B", reasons, reasonCodes: codes, ...base };
}

/* ------------------------------------------------------------------ */
/* Batch                                                                */
/* ------------------------------------------------------------------ */

function emptyCounts(): QcCounts {
  return { A: 0, B: 0, REVIEW: 0, REJECT: 0 };
}

function toPercentages(c: QcCounts, total: number): QcPercentages {
  return {
    A: pct(c.A, total),
    B: pct(c.B, total),
    REVIEW: pct(c.REVIEW, total),
    REJECT: pct(c.REJECT, total),
    AB: pct(c.A + c.B, total),
  };
}

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function wilson95(k: number, n: number): [number, number] | null {
  if (!(n > 0)) return null;
  const z = 1.96;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  const lo = Math.max(0, centre - margin) * 100;
  const hi = Math.min(1, centre + margin) * 100;
  return [round1(lo), round1(hi)];
}

function describeRule(a: QcAcceptance): string {
  return (
    `ACCEPT when A+B share >= ${a.minAbPct}% and REJECT share <= ${a.maxRejectPct}% and REVIEW share <= ${a.maxReviewPct}%. ` +
    `REJECT_LOT when REJECT share > ${a.rejectLotAbovePct}%. ` +
    `Otherwise INSPECT if REVIEW share > ${a.maxReviewPct}% (the classifier is unsure about too many photos), else ACCEPT_WITH_DISCOUNT. ` +
    `Shares are percentages of all photos submitted, including REVIEW photos. An empty batch is INSPECT.`
  );
}

export function summarizeBatch(results: unknown, options: SummarizeBatchOptions = {}): QcBatchSummary {
  const opts: SummarizeBatchOptions = isRecord(options) ? (options as SummarizeBatchOptions) : {};
  const th = mergeThresholds(opts.thresholds);
  const acc = mergeAcceptance(opts.acceptance);
  const warnings: string[] = [];

  let list: unknown[] = Array.isArray(results) ? results : [];
  if (!Array.isArray(results) && results !== undefined && results !== null) warnings.push("results was not an array; treated as empty.");
  if (list.length > MAX_PHOTOS) {
    warnings.push(`Only the first ${MAX_PHOTOS} photos were graded.`);
    list = list.slice(0, MAX_PHOTOS);
  }

  const photos: QcPhotoGrade[] = list.map((r) => gradePhoto(r, th));
  const total = photos.length;
  const counts = emptyCounts();
  let invalid = 0;
  const pValues: number[] = [];
  const fruitMap = new Map<string, { counts: QcCounts; p: number[]; count: number }>();

  for (const g of photos) {
    counts[g.grade]++;
    if (g.reasonCodes.indexOf("invalid_input") >= 0) invalid++;
    if (g.p_fresh !== null) pValues.push(g.p_fresh);
    let f = fruitMap.get(g.fruit);
    if (!f) {
      f = { counts: emptyCounts(), p: [], count: 0 };
      fruitMap.set(g.fruit, f);
    }
    f.count++;
    f.counts[g.grade]++;
    if (g.p_fresh !== null) f.p.push(g.p_fresh);
  }

  const percentages = toPercentages(counts, total);
  const sorted = pValues.slice().sort((a, b) => a - b);
  const pFresh =
    sorted.length > 0
      ? {
          mean: round1(sorted.reduce((s, v) => s + v, 0) / sorted.length),
          median: round1(median(sorted)),
          min: round1(sorted[0]),
          max: round1(sorted[sorted.length - 1]),
        }
      : null;

  const perFruit: QcFruitBreakdown[] = [];
  fruitMap.forEach((f, fruit) => {
    perFruit.push({
      fruit,
      count: f.count,
      counts: f.counts,
      percentages: toPercentages(f.counts, f.count),
      meanPFresh: f.p.length > 0 ? round1(f.p.reduce((s, v) => s + v, 0) / f.p.length) : null,
    });
  });
  perFruit.sort((a, b) => b.count - a.count || (a.fruit < b.fruit ? -1 : a.fruit > b.fruit ? 1 : 0));

  // Verdict. Decisions use exact shares, not the rounded display values.
  const exact = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  const abExact = exact(counts.A + counts.B);
  const rejectExact = exact(counts.REJECT);
  const reviewExact = exact(counts.REVIEW);
  const EPS = 1e-9;
  const checks: QcCheck[] = [
    { name: "ab_share_pct", actual: round1(abExact), op: ">=", limit: acc.minAbPct, passed: abExact + EPS >= acc.minAbPct },
    { name: "reject_share_pct", actual: round1(rejectExact), op: "<=", limit: acc.maxRejectPct, passed: rejectExact <= acc.maxRejectPct + EPS },
    { name: "review_share_pct", actual: round1(reviewExact), op: "<=", limit: acc.maxReviewPct, passed: reviewExact <= acc.maxReviewPct + EPS },
    { name: "reject_lot_share_pct", actual: round1(rejectExact), op: ">", limit: acc.rejectLotAbovePct, passed: rejectExact > acc.rejectLotAbovePct + EPS },
  ];

  let verdict: QcVerdict;
  let verdictReason: string;
  if (total === 0) {
    verdict = "INSPECT";
    verdictReason = "No photos were graded; nothing to base a decision on. Inspect the lot manually.";
  } else if (checks[3].passed) {
    verdict = "REJECT_LOT";
    verdictReason = `REJECT share ${checks[3].actual}% is above the ${acc.rejectLotAbovePct}% lot-rejection limit.`;
  } else if (checks[0].passed && checks[1].passed && checks[2].passed) {
    verdict = "ACCEPT";
    verdictReason = `A+B ${checks[0].actual}% >= ${acc.minAbPct}%, REJECT ${checks[1].actual}% <= ${acc.maxRejectPct}%, REVIEW ${checks[2].actual}% <= ${acc.maxReviewPct}%.`;
  } else if (!checks[2].passed) {
    verdict = "INSPECT";
    verdictReason = `REVIEW share ${checks[2].actual}% is above ${acc.maxReviewPct}%: too many photos are uncertain to decide automatically. Inspect manually.`;
  } else {
    verdict = "ACCEPT_WITH_DISCOUNT";
    const failed = checks
      .slice(0, 2)
      .filter((c) => !c.passed)
      .map((c) => `${c.name} ${c.actual}% (limit ${c.op} ${c.limit}%)`);
    verdictReason = `Lot is not clean enough for plain acceptance (${failed.join("; ")}) but below the ${acc.rejectLotAbovePct}% rejection limit: negotiate a discount or remove the rejected units.`;
  }

  const lowSample = total < acc.minSample;
  const statisticalNote = lowSample
    ? `Only ${total} photo${total === 1 ? "" : "s"} graded: a sample below ${acc.minSample} photos is not statistically representative of the whole lot. Treat this verdict as provisional and confirm with a physical inspection.`
    : `Based on ${total} photos. The verdict describes the photographed items only; photos should be taken from randomly chosen units across the lot.`;

  const declared = finiteInRange(opts.sampleSize, 0, 1e9);
  if (declared !== null && declared !== total) {
    warnings.push(`Declared sample size (${declared}) differs from the number of photos graded (${total}).`);
  }
  if (invalid > 0) warnings.push(`${invalid} photo result(s) were malformed and counted as REVIEW.`);

  let receivedAt: string | null = null;
  if (typeof opts.receivedAt === "string") {
    const t = Date.parse(opts.receivedAt);
    if (Number.isFinite(t)) receivedAt = new Date(t).toISOString();
    else warnings.push("receivedAt was not a valid date and was ignored.");
  }

  return {
    vendor: cleanText(opts.vendor, null),
    lotId: cleanText(opts.lotId, null),
    receivedAt,
    totalPhotos: total,
    counts,
    percentages,
    invalidInputs: invalid,
    pFresh,
    perFruit,
    verdict,
    verdictReason,
    rule: { description: describeRule(acc), acceptance: acc, thresholds: th },
    checks,
    rejectRateCi95: wilson95(counts.REJECT, total),
    statisticalNote,
    lowSample,
    declaredSampleSize: declared,
    warnings,
    photos,
  };
}

/* ------------------------------------------------------------------ */
/* Vendor scorecard                                                     */
/* ------------------------------------------------------------------ */

export type QcTrend = "improving" | "declining" | "stable" | "insufficient_data";

export interface VendorScore {
  rank: number;
  vendor: string;
  batches: number;
  /** Batches with at least one photo (the rates below use only these). */
  gradedBatches: number;
  totalPhotos: number;
  /** Mean of the per-batch A shares (each batch counts equally). */
  avgAPct: number;
  /** A share over all photos pooled (large batches count more). */
  pooledAPct: number;
  pooledABPct: number;
  /** Pooled REJECT share. */
  rejectionRate: number;
  reviewRate: number;
  verdicts: Record<QcVerdict, number>;
  /** Share of batches whose verdict was REJECT_LOT. */
  lotRejectRate: number;
  trend: QcTrend;
  /** Mean A share of the later half minus the earlier half, in percentage points. */
  trendDeltaPts: number | null;
  lastVerdict: QcVerdict | null;
}

export interface VendorScorecard {
  vendors: VendorScore[];
  rankingRule: string;
  warnings: string[];
}

interface BatchLike {
  vendor: string;
  receivedAt: number | null;
  order: number;
  counts: QcCounts;
  total: number;
  verdict: QcVerdict | null;
}

const TREND_DELTA_PTS = 5;

function readCounts(v: unknown): QcCounts | null {
  if (!isRecord(v)) return null;
  const out = emptyCounts();
  for (const k of ["A", "B", "REVIEW", "REJECT"] as const) {
    const n = v[k];
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
    out[k] = Math.floor(n);
  }
  return out;
}

export function vendorScorecard(batches: unknown): VendorScorecard {
  const warnings: string[] = [];
  const rankingRule =
    "Ranked by pooled rejection rate (lowest first), then pooled A share (highest first), then vendor name. Vendors without any graded photos are listed last.";
  const arr: unknown[] = Array.isArray(batches) ? batches : [];
  if (!Array.isArray(batches) && batches !== undefined && batches !== null) warnings.push("batches was not an array; treated as empty.");
  const groups = new Map<string, { display: string; items: BatchLike[] }>();
  let bad = 0;
  arr.slice(0, 50_000).forEach((b, order) => {
    if (!isRecord(b)) {
      bad++;
      return;
    }
    const counts = readCounts(b.counts);
    if (!counts) {
      bad++;
      return;
    }
    const display = cleanText(b.vendor, null) ?? "(unknown)";
    const key = display.toLowerCase();
    const verdictRaw = b.verdict;
    const verdict: QcVerdict | null =
      verdictRaw === "ACCEPT" || verdictRaw === "ACCEPT_WITH_DISCOUNT" || verdictRaw === "REJECT_LOT" || verdictRaw === "INSPECT"
        ? verdictRaw
        : null;
    const t = typeof b.receivedAt === "string" ? Date.parse(b.receivedAt) : NaN;
    const item: BatchLike = {
      vendor: display,
      receivedAt: Number.isFinite(t) ? t : null,
      order,
      counts,
      total: counts.A + counts.B + counts.REVIEW + counts.REJECT,
      verdict,
    };
    const g = groups.get(key);
    if (g) g.items.push(item);
    else groups.set(key, { display, items: [item] });
  });
  if (bad > 0) warnings.push(`${bad} batch record(s) were malformed and ignored.`);

  const scores: Array<VendorScore & { _sortable: boolean }> = [];
  groups.forEach((g) => {
    const items = g.items.slice();
    const allDated = items.every((i) => i.receivedAt !== null);
    items.sort((a, b) => (allDated ? (a.receivedAt as number) - (b.receivedAt as number) : 0) || a.order - b.order);
    const graded = items.filter((i) => i.total > 0);
    const pooled = emptyCounts();
    let totalPhotos = 0;
    for (const i of graded) {
      pooled.A += i.counts.A;
      pooled.B += i.counts.B;
      pooled.REVIEW += i.counts.REVIEW;
      pooled.REJECT += i.counts.REJECT;
      totalPhotos += i.total;
    }
    const perBatchA = graded.map((i) => (i.counts.A / i.total) * 100);
    const avgA = perBatchA.length > 0 ? perBatchA.reduce((s, v) => s + v, 0) / perBatchA.length : 0;

    let trend: QcTrend = "insufficient_data";
    let delta: number | null = null;
    if (perBatchA.length >= 3) {
      const half = Math.floor(perBatchA.length / 2);
      const early = perBatchA.slice(0, half);
      const late = perBatchA.slice(perBatchA.length - half);
      const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
      delta = round1(mean(late) - mean(early));
      trend = delta >= TREND_DELTA_PTS ? "improving" : delta <= -TREND_DELTA_PTS ? "declining" : "stable";
    }

    const verdicts: Record<QcVerdict, number> = { ACCEPT: 0, ACCEPT_WITH_DISCOUNT: 0, REJECT_LOT: 0, INSPECT: 0 };
    for (const i of items) if (i.verdict) verdicts[i.verdict]++;
    const verdictTotal = verdicts.ACCEPT + verdicts.ACCEPT_WITH_DISCOUNT + verdicts.REJECT_LOT + verdicts.INSPECT;
    const lastWithVerdict = items.slice().reverse().find((i) => i.verdict !== null);

    scores.push({
      rank: 0,
      vendor: g.display,
      batches: items.length,
      gradedBatches: graded.length,
      totalPhotos,
      avgAPct: round1(avgA),
      pooledAPct: pct(pooled.A, totalPhotos),
      pooledABPct: pct(pooled.A + pooled.B, totalPhotos),
      rejectionRate: pct(pooled.REJECT, totalPhotos),
      reviewRate: pct(pooled.REVIEW, totalPhotos),
      verdicts,
      lotRejectRate: pct(verdicts.REJECT_LOT, verdictTotal),
      trend,
      trendDeltaPts: delta,
      lastVerdict: lastWithVerdict ? lastWithVerdict.verdict : null,
      _sortable: graded.length > 0,
    });
  });

  scores.sort((a, b) => {
    if (a._sortable !== b._sortable) return a._sortable ? -1 : 1;
    if (a.rejectionRate !== b.rejectionRate) return a.rejectionRate - b.rejectionRate;
    if (a.pooledAPct !== b.pooledAPct) return b.pooledAPct - a.pooledAPct;
    return a.vendor < b.vendor ? -1 : a.vendor > b.vendor ? 1 : 0;
  });
  const vendors: VendorScore[] = scores.map((s, i) => {
    const { _sortable, ...rest } = s;
    void _sortable;
    return { ...rest, rank: i + 1 };
  });
  if (vendors.some((v) => v.gradedBatches < 3)) {
    warnings.push("Trends need at least 3 graded batches per vendor; vendors with fewer show insufficient_data.");
  }
  return { vendors, rankingRule, warnings };
}

/* ------------------------------------------------------------------ */
/* CSV                                                                  */
/* ------------------------------------------------------------------ */

const MAX_CELL_CHARS = 32_000;
const MAX_COLUMNS = 200;

function cellToString(v: unknown): { text: string; isString: boolean } {
  if (v === null || v === undefined) return { text: "", isString: false };
  if (typeof v === "number") return { text: Number.isFinite(v) ? String(v) : "", isString: false };
  if (typeof v === "bigint") return { text: String(v), isString: false };
  if (typeof v === "boolean") return { text: v ? "true" : "false", isString: false };
  if (v instanceof Date) return { text: Number.isFinite(v.getTime()) ? v.toISOString() : "", isString: false };
  if (typeof v === "string") return { text: v, isString: true };
  try {
    const j = JSON.stringify(v);
    return { text: typeof j === "string" ? j : "", isString: true };
  } catch {
    return { text: "", isString: true };
  }
}

/** Escape one CSV field: formula-injection guard first, then RFC 4180 quoting. */
export function csvCell(v: unknown): string {
  const { text, isString } = cellToString(v);
  let s = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  if (s.length > MAX_CELL_CHARS) s = s.slice(0, MAX_CELL_CHARS);
  if (isString && /^\s*[=+\-@]|^[\t\r\n]/.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s) || /^\s|\s$/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/**
 * Build an RFC 4180 CSV (CRLF line endings, header row, quoted fields where
 * required). String cells that start with = + - @ tab or CR (also after
 * leading spaces) are prefixed with a single quote so spreadsheet software
 * does not evaluate them as formulas. Typed numbers are written as-is
 * (NaN and Infinity become empty cells). Column order is `columns` when given,
 * otherwise the order keys are first seen.
 */
export function toCsv(rows: unknown, columns?: readonly string[]): string {
  const list: unknown[] = Array.isArray(rows) ? rows : [];
  let cols: string[];
  if (Array.isArray(columns) && columns.length > 0) {
    cols = columns.slice(0, MAX_COLUMNS).map((c) => String(c));
  } else {
    const seen = new Set<string>();
    cols = [];
    for (const r of list) {
      if (!isRecord(r)) continue;
      for (const k of Object.keys(r)) {
        if (!seen.has(k)) {
          seen.add(k);
          cols.push(k);
          if (cols.length >= MAX_COLUMNS) break;
        }
      }
      if (cols.length >= MAX_COLUMNS) break;
    }
  }
  if (cols.length === 0) return "";
  const out: string[] = [cols.map((c) => csvCell(c)).join(",")];
  for (const r of list) {
    const rec = isRecord(r) ? r : {};
    out.push(cols.map((c) => csvCell(Object.prototype.hasOwnProperty.call(rec, c) ? rec[c] : undefined)).join(","));
  }
  return out.join("\r\n") + "\r\n";
}

/** Tidy long-format report of a batch summary: one metric per row. */
export function batchReportCsv(summary: QcBatchSummary): string {
  const vendor = summary.vendor ?? "";
  const lot = summary.lotId ?? "";
  const rows: Array<Record<string, unknown>> = [];
  const add = (section: string, metric: string, value: unknown) => rows.push({ vendor, lot_id: lot, section, metric, value });

  add("verdict", "verdict", summary.verdict);
  add("verdict", "reason", summary.verdictReason);
  add("lot", "received_at", summary.receivedAt ?? "");
  add("lot", "total_photos", summary.totalPhotos);
  add("lot", "declared_sample_size", summary.declaredSampleSize);
  add("lot", "low_sample", summary.lowSample);
  add("lot", "statistical_note", summary.statisticalNote);
  for (const g of ["A", "B", "REVIEW", "REJECT"] as const) add("counts", g, summary.counts[g]);
  for (const g of ["A", "B", "REVIEW", "REJECT", "AB"] as const) add("percent", g, summary.percentages[g]);
  if (summary.pFresh) {
    add("p_fresh", "mean", summary.pFresh.mean);
    add("p_fresh", "median", summary.pFresh.median);
    add("p_fresh", "min", summary.pFresh.min);
    add("p_fresh", "max", summary.pFresh.max);
  }
  if (summary.rejectRateCi95) {
    add("reject_ci95", "low_pct", summary.rejectRateCi95[0]);
    add("reject_ci95", "high_pct", summary.rejectRateCi95[1]);
  }
  for (const f of summary.perFruit) {
    add("fruit", `${f.fruit} count`, f.count);
    add("fruit", `${f.fruit} A pct`, f.percentages.A);
    add("fruit", `${f.fruit} B pct`, f.percentages.B);
    add("fruit", `${f.fruit} REVIEW pct`, f.percentages.REVIEW);
    add("fruit", `${f.fruit} REJECT pct`, f.percentages.REJECT);
    add("fruit", `${f.fruit} mean p_fresh`, f.meanPFresh);
  }
  const a = summary.rule.acceptance;
  add("rule", "description", summary.rule.description);
  add("rule", "min_ab_pct", a.minAbPct);
  add("rule", "max_reject_pct", a.maxRejectPct);
  add("rule", "max_review_pct", a.maxReviewPct);
  add("rule", "reject_lot_above_pct", a.rejectLotAbovePct);
  add("rule", "min_sample", a.minSample);
  const t = summary.rule.thresholds;
  add("rule", "a_min_p_fresh", t.aMinPFresh);
  add("rule", "a_min_confidence", t.aMinConfidence);
  add("rule", "reject_below_p_fresh", t.rejectBelowPFresh);
  add("rule", "review_below_confidence", t.reviewBelowConfidence);
  for (const c of summary.checks) add("check", `${c.name} ${c.op} ${c.limit}`, `${c.actual} ${c.passed ? "passed" : "failed"}`);
  for (const w of summary.warnings) add("warning", "warning", w);
  return toCsv(rows, ["vendor", "lot_id", "section", "metric", "value"]);
}

/** One row per photo with its grade and reasons. */
export function batchPhotosCsv(summary: QcBatchSummary): string {
  const rows = summary.photos.map((p, i) => ({
    vendor: summary.vendor ?? "",
    lot_id: summary.lotId ?? "",
    index: i + 1,
    photo_id: p.photoId ?? "",
    fruit: p.fruit,
    freshness_status: p.freshness_status ?? "",
    p_fresh: p.p_fresh,
    confidence: p.confidence,
    grade: p.grade,
    reasons: p.reasons.join(" "),
  }));
  return toCsv(rows, ["vendor", "lot_id", "index", "photo_id", "fruit", "freshness_status", "p_fresh", "confidence", "grade", "reasons"]);
}

export function vendorScorecardCsv(card: VendorScorecard): string {
  const rows = card.vendors.map((v) => ({
    rank: v.rank,
    vendor: v.vendor,
    batches: v.batches,
    graded_batches: v.gradedBatches,
    total_photos: v.totalPhotos,
    avg_a_pct: v.avgAPct,
    pooled_a_pct: v.pooledAPct,
    pooled_ab_pct: v.pooledABPct,
    rejection_rate_pct: v.rejectionRate,
    review_rate_pct: v.reviewRate,
    lot_reject_rate_pct: v.lotRejectRate,
    trend: v.trend,
    trend_delta_pts: v.trendDeltaPts,
    last_verdict: v.lastVerdict ?? "",
  }));
  return toCsv(rows, [
    "rank", "vendor", "batches", "graded_batches", "total_photos", "avg_a_pct", "pooled_a_pct", "pooled_ab_pct",
    "rejection_rate_pct", "review_rate_pct", "lot_reject_rate_pct", "trend", "trend_delta_pts", "last_verdict",
  ]);
}
