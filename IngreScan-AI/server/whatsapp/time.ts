/** Timezone and local-calendar helpers built on Intl only (no external deps). */

export function isValidTimeZone(zone: string | undefined | null): boolean {
  if (!zone || !/^[A-Za-z0-9_+\-/]{1,64}$/.test(zone)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Canonical spelling Intl reports (e.g. "asia/kolkata" -> "Asia/Calcutta" or "Asia/Kolkata" by ICU). */
export function canonicalTimeZone(zone: string): string | null {
  if (!isValidTimeZone(zone)) return null;
  // Keep the spelling the user typed when it is a valid, properly capitalised IANA name. The ICU database
  // resolves modern names to legacy aliases (Asia/Kolkata -> Asia/Calcutta), which would be confusing to show back.
  if (/^[A-Z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+)*$/.test(zone)) return zone;
  return new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone;
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string): Intl.DateTimeFormat {
  let f = fmtCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    fmtCache.set(zone, f);
  }
  return f;
}

export function localParts(epochMs: number, zone: string): LocalParts {
  const parts = formatter(zone).formatToParts(new Date(epochMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  let hour = get("hour");
  if (hour === 24) hour = 0;
  return { year: get("year"), month: get("month"), day: get("day"), hour, minute: get("minute") };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Local calendar date YYYY-MM-DD in the given zone. */
export function localDate(epochMs: number, zone: string): string {
  const p = localParts(epochMs, zone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

function dateToUtcDays(d: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000;
}

/** Add whole calendar days to YYYY-MM-DD. */
export function addDaysToLocalDate(d: string, days: number): string {
  const t = dateToUtcDays(d) + Math.trunc(days);
  const dt = new Date(t * 86_400_000);
  return `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Calendar days from `from` to `to` (positive when `to` is later). NaN on bad input. */
export function daysBetween(from: string, to: string): number {
  return dateToUtcDays(to) - dateToUtcDays(from);
}

export function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && Number.isFinite(dateToUtcDays(s)) && addDaysToLocalDate(s, 0) === s;
}
