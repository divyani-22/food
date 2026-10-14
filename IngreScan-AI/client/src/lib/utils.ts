import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Format a Date as YYYY-MM-DD in the user's LOCAL timezone (toISOString uses UTC and can be off by a day). */
export function toLocalDateInput(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Calendar-day expiry status in the user's LOCAL timezone. Expiry dates are stored as UTC midnight
 * of the chosen date, so compare that calendar date with today's local date.
 */
export function localExpiry(expiry: Date | string | number, now: Date = new Date()) {
  const e = new Date(expiry);
  if (Number.isNaN(e.getTime())) return { daysLeft: 0, status: "expired" as const };
  const expiryDay = Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate());
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const daysLeft = Math.round((expiryDay - today) / 86_400_000);
  const status = daysLeft < 0 ? ("expired" as const) : daysLeft <= 3 ? ("expiring_soon" as const) : ("fresh" as const);
  return { daysLeft, status };
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
