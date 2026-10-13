// Pure helpers used by routers (kept side-effect free so they can be unit tested).

const DAY_MS = 1000 * 60 * 60 * 24;
// MySQL TIMESTAMP columns only support 1970-01-01 .. 2038-01-19 (UTC).
const MIN_TS = Date.UTC(1970, 0, 2);
const MAX_TS = Date.UTC(2038, 0, 1);

/** Parse a date string/Date for a MySQL TIMESTAMP column. Returns null when invalid or out of range. */
export function parseTimestampInput(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  const t = d.getTime();
  if (Number.isNaN(t) || t < MIN_TS || t > MAX_TS) return null;
  return d;
}

export type InventoryStatus = "fresh" | "expiring_soon" | "expired";

/** Whole days until expiry (rounded up, never -0, 0 for invalid dates) and derived status. */
export function computeExpiry(expiry: Date | string | number, now: Date = new Date()) {
  const t = new Date(expiry).getTime();
  const raw = Math.ceil((t - now.getTime()) / DAY_MS);
  const daysLeft = Number.isFinite(raw) ? raw + 0 : 0; // "+ 0" normalises -0 to 0
  let status: InventoryStatus = "fresh";
  if (!Number.isFinite(raw) || daysLeft < 0) status = "expired";
  else if (daysLeft <= 3) status = "expiring_soon";
  return { daysLeft, status };
}

/** Extract plain text from an LLM chat completion; tolerant of missing choices / array content. */
export function getLLMText(response: any): string {
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p: any) => (typeof p === "string" ? p : p?.type === "text" ? p.text ?? "" : ""))
      .join("")
      .trim();
  }
  return "";
}

/** Parse JSON from an LLM reply, tolerating ```json fences and surrounding prose. Throws on failure. */
export function parseLLMJson<T = any>(text: string): T {
  const trimmed = (text ?? "").trim();
  if (!trimmed) throw new Error("Empty AI response");
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // fall through
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim()) as T;
    } catch {
      // fall through
    }
  }
  const start = trimmed.search(/[{[]/);
  const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as T;
    } catch {
      // fall through
    }
  }
  throw new Error("AI response was not valid JSON");
}

const RISK_LEVELS = ["safe", "low", "moderate", "high", "severe"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
};

/** Normalise one LLM-produced ingredient; returns null if it has no usable name. */
export function sanitizeIngredient(raw: any) {
  const name = str(raw?.name, 255);
  if (!name) return null;
  const level = typeof raw?.riskLevel === "string" ? raw.riskLevel.toLowerCase().trim() : "";
  const sources = Array.isArray(raw?.sources)
    ? raw.sources.filter((s: unknown) => typeof s === "string")
    : [];
  return {
    name,
    scientificName: str(raw?.scientificName, 255),
    category: str(raw?.category, 100),
    riskLevel: (RISK_LEVELS as readonly string[]).includes(level) ? (level as RiskLevel) : null,
    shortTermEffects: str(raw?.shortTermEffects, 5000),
    longTermEffects: str(raw?.longTermEffects, 5000),
    sideEffects: str(raw?.sideEffects, 5000),
    personalizedRisk: str(raw?.personalizedRisk, 5000),
    sources: JSON.stringify(sources),
  };
}

export function sanitizeAlternative(raw: any) {
  const productName = str(raw?.productName, 255);
  const reason = str(raw?.reason, 5000);
  if (!productName || !reason) return null;
  const sources = Array.isArray(raw?.sources)
    ? raw.sources.filter((s: unknown) => typeof s === "string")
    : [];
  return {
    productName,
    reason,
    scientificJustification: str(raw?.scientificJustification, 5000),
    sources: JSON.stringify(sources),
  };
}

/** Clamp an LLM risk score to an integer 0-100 (NaN / non-numbers become null). */
export function clampRiskScore(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** Open Food Facts grades are a-e; anything else ("unknown", "not-applicable") becomes null. */
export function normalizeGrade(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const g = v.trim().toLowerCase();
  return /^[a-e]$/.test(g) ? g.toUpperCase() : null;
}

export function normalizeNova(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 4 ? n : null;
}

export function firstCategory(v: unknown): string {
  if (typeof v !== "string") return "Food";
  return v.split(",")[0]?.trim().replace(/^[a-z]{2}:/, "") || "Food";
}

export function parseAllergens(v: unknown): string[] {
  if (typeof v !== "string") return [];
  return v
    .split(",")
    .map(s => s.trim().replace(/^[a-z]{2}:/, ""))
    .filter(Boolean);
}

/** Make a user-provided file name safe for use inside a storage key. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "").slice(-100);
  return cleaned || "file";
}

/** BMI rounded to 1 decimal, or undefined when inputs are unusable. */
export function computeBmi(heightCm?: number | null, weightKg?: number | null): number | undefined {
  if (!heightCm || !weightKg || heightCm <= 0 || weightKg <= 0) return undefined;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}
