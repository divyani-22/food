/**
 * Message builders. Plain text with WhatsApp styling (*bold*), UPPERCASE status words
 * and "-" bullets. No emoji by default; an optional marker table is used when
 * `useEmoji` is true. Emoji are written as escapes so the source stays emoji-free.
 */
import { daysBetween } from "./time";
import type {
  FreshnessStatus,
  PackagedReport,
  PantryItem,
  ProduceClassification,
  Recipe,
} from "./types";

export interface FormatOptions {
  useEmoji?: boolean;
}

export type MarkerKind = "ok" | "warn" | "bad";

const EMOJI_MARKERS: Record<MarkerKind, string> = {
  ok: "\u{1F7E2}",
  warn: "\u{1F7E1}",
  bad: "\u{1F534}",
};

export function marker(kind: MarkerKind, opts?: FormatOptions): string {
  return opts?.useEmoji ? EMOJI_MARKERS[kind] + " " : "";
}

export const MAX_MESSAGE_CHARS = 4000;

/**
 * WhatsApp has no escape character, so user-supplied text is neutralised by
 * replacing the four formatting characters with visually similar, non-formatting
 * characters. Also strips line breaks and caps the length.
 */
export function escapeWa(input: string, maxLen = 60): string {
  const s = input
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\u0000-\u001F\u007F​-‏‪-‮⁠﻿]/g, "")
    .replace(/\*/g, "∗")
    .replace(/_/g, "＿")
    .replace(/~/g, "∼")
    .replace(/`/g, "ˋ")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > maxLen ? s.slice(0, maxLen - 3).trimEnd() + "..." : s;
}

/** Split into chunks of at most `max` characters, preferring line boundaries. */
export function splitMessage(text: string, max = MAX_MESSAGE_CHARS): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let cur = "";
  const push = () => {
    if (cur) chunks.push(cur);
    cur = "";
  };
  for (const line of text.split("\n")) {
    if (line.length > max) {
      push();
      let rest = line;
      while (rest.length > max) {
        let cut = rest.lastIndexOf(" ", max);
        if (cut < max / 2) cut = max;
        chunks.push(rest.slice(0, cut));
        rest = rest.slice(cut).replace(/^ /, "");
      }
      cur = rest;
      continue;
    }
    if (cur === "") cur = line;
    else if (cur.length + 1 + line.length <= max) cur += "\n" + line;
    else {
      push();
      cur = line;
    }
  }
  push();
  return chunks;
}

// ------------------------------------------------------------- relative days

export function describeDays(days: number): string {
  if (days < -1) return `expired ${-days} days ago`;
  if (days === -1) return "expired yesterday";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

export type ExpiryStatus = "FRESH" | "EXPIRING SOON" | "EXPIRED" | "NO DATE";

export function expiryStatus(daysLeft: number | null, soonDays = 2): ExpiryStatus {
  if (daysLeft === null || Number.isNaN(daysLeft)) return "NO DATE";
  if (daysLeft < 0) return "EXPIRED";
  if (daysLeft <= soonDays) return "EXPIRING SOON";
  return "FRESH";
}

function statusMarker(s: ExpiryStatus, o?: FormatOptions): string {
  return s === "FRESH" ? marker("ok", o) : s === "EXPIRING SOON" ? marker("warn", o) : s === "EXPIRED" ? marker("bad", o) : "";
}

// -------------------------------------------------------------- static texts

export function helpMessage(linked: boolean, webAppUrl: string): string {
  if (!linked) return linkGuidance(webAppUrl);
  return [
    "*FoodIQ commands*",
    "- Send a photo of a fruit or vegetable: freshness check",
    "- Send a barcode number or ingredient text: product risk report",
    "- ADD: save the last checked item to your pantry",
    "- FRIDGE or PANTRY: list your items (MORE for the next page)",
    "- COOK or RESCUE: recipes for items about to expire",
    "- CLEAR <item>: mark an item as used up",
    "- REMIND <hour 0-23>: daily reminder hour",
    "- TZ <zone>: your time zone, e.g. TZ Asia/Kolkata",
    "- STOP / START: turn reminders off / on",
    "- HELP: show this list",
  ].join("\n");
}

export function linkGuidance(webAppUrl: string): string {
  return [
    "Welcome to FoodIQ.",
    "This WhatsApp number is not connected to an account yet.",
    "",
    "1. Open the web app" + (webAppUrl ? ` (${webAppUrl})` : "") + " and sign in.",
    "2. Go to Profile and choose Connect WhatsApp.",
    "3. Send the code you see here, like this: LINK ABCD2345",
    "",
    "The code expires after 10 minutes.",
  ].join("\n");
}

export const MSG = {
  linkUsage: "Send LINK followed by the 8-character code from Profile > Connect WhatsApp, for example: LINK ABCD2345",
  linkOk: (name?: string) =>
    `Your account is connected${name ? `, ${escapeWa(name, 40)}` : ""}. Send a photo of a fruit or vegetable to check it, or HELP for all commands.`,
  linkInvalid: "That code was not recognised. Check it and try again, or generate a new one in Profile > Connect WhatsApp.",
  linkExpired: "That code has expired. Generate a new one in Profile > Connect WhatsApp.",
  linkUsed: "That code was already used. Generate a new one in Profile > Connect WhatsApp.",
  linkLocked: "Too many attempts. Please wait a few minutes and try again.",
  rateLimited: "You are sending messages too quickly. Please wait a moment and try again.",
  genericError: "Sorry, something went wrong on our side. Please try again in a moment.",
  unknown: "I did not understand that. Send a photo of a fruit or vegetable, a barcode number, or reply HELP for the list of commands.",
  unsupportedMedia: "I can only read photos (JPEG, PNG or WebP) and text. Please send a photo or type HELP.",
  location: "I cannot use locations. Send a photo of a fruit or vegetable, a barcode number, or reply HELP.",
  tooLarge: "That image is too large. Please send a smaller photo (under 8 MB).",
  badMediaType: "I can only read JPEG, PNG or WebP photos. Please send a photo.",
  mediaFailed: "I could not download that photo. Please try sending it again.",
  retryPhoto: [
    "I could not identify that item with enough confidence.",
    "Tips for a better result:",
    "- Good lighting, no flash glare",
    "- One fruit or vegetable, filling most of the frame",
    "- Hold the camera steady and avoid blur",
    "Then send the photo again. Supported items are common fruits and vegetables.",
  ].join("\n"),
  addNothing: "There is nothing to add. Send a photo of a fruit or vegetable first, then reply ADD.",
  addExpired: "That inspection is too old to save (15 minute limit). Please send the photo again, then reply ADD.",
  addSpoiled: "This item is not safe to eat, so it was not added to your pantry.",
  clearUsage: "Tell me which item, for example: CLEAR milk",
  clearNone: (q: string) => `I could not find an item matching "${escapeWa(q, 40)}". Reply FRIDGE to see your items.`,
  clearChoiceInvalid: (n: number) => `Please reply with a number from 1 to ${n}, or CANCEL.`,
  clearChoiceExpired: "That choice has expired. Send CLEAR followed by the item name again.",
  cancelled: "Okay, cancelled.",
  pantryEmpty: "Your pantry is empty. Send a photo of a fruit or vegetable and reply ADD to save it.",
  moreNone: "There are no more items. Reply FRIDGE to start again.",
  rescueNone: "Nothing in your pantry is close to expiring. Reply FRIDGE to see everything.",
  rescueNoRecipes: "I could not find a recipe right now. Try again later or use the items soon.",
  stop: "Reminders are turned off. Reply START any time to turn them back on.",
  start: (hour: number, tz: string) =>
    `Reminders are on. You will get one message a day around ${formatHour(hour)} (${tz}) when something is about to expire. Reply STOP to turn them off.`,
  remindUsage: (hour: number) => `Send REMIND followed by an hour from 0 to 23, for example: REMIND 8. Current hour: ${formatHour(hour)}.`,
  remindOk: (hour: number) => `Done. Daily reminders will be sent around ${formatHour(hour)} local time.`,
  remindQuiet: (start: number, end: number) =>
    `Reminders are not sent between ${formatHour(start)} and ${formatHour(end)}. Please pick an hour from ${end} to ${start - 1}.`,
  tzUsage: "Send TZ followed by an IANA time zone, for example: TZ Asia/Kolkata or TZ America/New_York",
  tzInvalid: (z: string) => `"${escapeWa(z, 40)}" is not a valid time zone. Use the form Region/City, for example Asia/Kolkata.`,
  tzOk: (z: string) => `Time zone set to ${z}.`,
  digitsHint: "That does not look like a barcode. Barcodes have 8 to 14 digits. Send the number printed under the bars or a photo of it.",
  barcodeLength: "That number has a length barcodes do not use. Supported lengths are 8, 12, 13 and 14 digits. Please check it and try again.",
  barcodeChecksum: (d: string) => `The barcode ${d} fails its check digit, so it was probably mistyped. Please check the digits and send it again.`,
  barcodeUnknown: (d: string) => `I could not find a product for barcode ${d}. You can paste the ingredient list as text and I will analyse it.`,
};

export function formatHour(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

// --------------------------------------------------------------- reports

const STATUS_TEXT: Record<FreshnessStatus, { word: string; kind: MarkerKind }> = {
  fresh: { word: "FRESH", kind: "ok" },
  normal: { word: "OK - USE SOON", kind: "warn" },
  rotten: { word: "SPOILED - DO NOT EAT", kind: "bad" },
};

export function produceReport(c: ProduceClassification, opts?: FormatOptions): string {
  const st = STATUS_TEXT[c.freshnessStatus];
  const lines = [
    "*INSPECTION REPORT*",
    `Item: ${escapeWa(c.fruit)}`,
    `Confidence: ${Math.round(c.confidence)}%`,
    `Status: ${marker(st.kind, opts)}${st.word}`,
  ];
  if (c.freshnessStatus !== "rotten") {
    lines.push(`Estimated shelf life: ${c.shelfLifeDays} ${c.shelfLifeDays === 1 ? "day" : "days"}`);
  }
  if (c.storageTip) lines.push(`Storage tip: ${escapeWa(c.storageTip, 200)}`);
  lines.push("");
  lines.push(
    c.freshnessStatus === "rotten"
      ? "Please discard it. Send another photo to check a different item."
      : "Reply ADD to save this item to your pantry.",
  );
  return lines.join("\n");
}

export function riskLabel(score: number): string {
  return score >= 67 ? "HIGH" : score >= 34 ? "MODERATE" : "LOW";
}

export function packagedReport(r: PackagedReport, opts?: FormatOptions): string {
  if (r.noIngredientData) {
    const lines = [
      "*PRODUCT FOUND*",
      `Product: ${escapeWa(r.productName)}${r.brand ? ` (${escapeWa(r.brand, 40)})` : ""}`,
      "",
      "This product has no ingredient list in the database, so I cannot calculate a risk score.",
      "Send a clear photo of the ingredient label, or type the ingredients, and I will analyze them.",
    ];
    if (r.allergens.length) lines.push("", `Allergens listed: ${r.allergens.map((a) => escapeWa(a, 30)).join(", ")}`);
    return lines.join("\n");
  }
  const score = Math.max(0, Math.min(100, Math.round(r.riskScore)));
  const label = riskLabel(score);
  const kind: MarkerKind = label === "HIGH" ? "bad" : label === "MODERATE" ? "warn" : "ok";
  const lines = [
    "*PRODUCT RISK REPORT*",
    `Product: ${escapeWa(r.productName)}${r.brand ? ` (${escapeWa(r.brand, 40)})` : ""}`,
    `Risk score: ${score}/100 - ${marker(kind, opts)}${label}`,
  ];
  if (r.highRiskAdditives.length) {
    lines.push("", "*High-risk additives*");
    for (const a of r.highRiskAdditives.slice(0, 8)) lines.push(`- ${escapeWa(a, 80)}`);
    if (r.highRiskAdditives.length > 8) lines.push(`- and ${r.highRiskAdditives.length - 8} more`);
  } else {
    lines.push("", "High-risk additives: none found");
  }
  lines.push(r.allergens.length ? `Allergens: ${r.allergens.map((a) => escapeWa(a, 30)).join(", ")}` : "Allergens: none flagged");
  if (r.personalAlerts.length) {
    lines.push("", "*Alerts for you*");
    for (const a of r.personalAlerts.slice(0, 6)) lines.push(`- ${escapeWa(a, 160)}`);
  }
  if (r.healthierAlternative) {
    const h = r.healthierAlternative;
    lines.push(
      "",
      `Healthier option: ${escapeWa(h.name)}${h.brand ? ` (${escapeWa(h.brand, 40)})` : ""}${
        typeof h.riskScore === "number" ? ` - risk ${Math.round(h.riskScore)}/100` : ""
      }`,
    );
  }
  lines.push("", "This is general information, not medical advice.");
  return lines.join("\n");
}

// ---------------------------------------------------------------- pantry

export interface PantryRow {
  item: PantryItem;
  daysLeft: number | null;
  status: ExpiryStatus;
}

/** Rows sorted by urgency: most overdue first, then soonest, undated last. */
export function sortPantry(items: PantryItem[], today: string): PantryRow[] {
  const rows = items.map((item) => {
    const d = item.expiryDate ? daysBetween(today, item.expiryDate) : NaN;
    const daysLeft = Number.isFinite(d) ? d : null;
    return { item, daysLeft, status: expiryStatus(daysLeft) };
  });
  return rows.sort((a, b) => {
    const da = a.daysLeft ?? Number.POSITIVE_INFINITY;
    const db = b.daysLeft ?? Number.POSITIVE_INFINITY;
    return da === db ? a.item.name.localeCompare(b.item.name) : da - db;
  });
}

export function pantryPage(
  rows: PantryRow[],
  page: number,
  pageSize: number,
  opts?: FormatOptions,
): { text: string; hasMore: boolean; page: number; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const p = Math.min(Math.max(1, page), totalPages);
  const slice = rows.slice((p - 1) * pageSize, p * pageSize);
  const lines = [`*YOUR PANTRY* (${rows.length} ${rows.length === 1 ? "item" : "items"}, page ${p}/${totalPages})`];
  slice.forEach((r, i) => {
    const when = r.daysLeft === null ? "no expiry date" : describeDays(r.daysLeft);
    lines.push(`${(p - 1) * pageSize + i + 1}. ${escapeWa(r.item.name)} - ${when} - ${statusMarker(r.status, opts)}${r.status}`);
  });
  const hasMore = p < totalPages;
  lines.push("");
  if (hasMore) lines.push("Reply MORE for the next page.");
  lines.push("Reply COOK for recipes, or CLEAR <item> when you have used something.");
  return { text: lines.join("\n"), hasMore, page: p, totalPages };
}

export function rescueMessage(recipes: Recipe[], expiring: string[]): string {
  const lines = ["*RESCUE RECIPES*", `Using: ${expiring.slice(0, 6).map((n) => escapeWa(n, 30)).join(", ")}`, ""];
  recipes.slice(0, 3).forEach((r, i) => {
    lines.push(`${i + 1}. *${escapeWa(r.title, 80)}*`);
    lines.push(escapeWa(r.summary, 500));
    lines.push("");
  });
  return lines.join("\n").trimEnd();
}

// -------------------------------------------------------------- reminders

export interface ReminderItem {
  name: string;
  daysLeft: number;
}

export function reminderText(items: ReminderItem[], opts?: FormatOptions): string {
  const lines = [`*PANTRY REMINDER*`, "These items need attention soon:"];
  for (const it of items.slice(0, 10)) {
    const k: MarkerKind = it.daysLeft <= 0 ? "bad" : "warn";
    lines.push(`- ${marker(k, opts)}${escapeWa(it.name)}: ${describeDays(it.daysLeft)}`);
  }
  if (items.length > 10) lines.push(`- and ${items.length - 10} more`);
  lines.push("", "Reply COOK for a recipe.", "Reply STOP to turn off reminders.");
  return lines.join("\n");
}

/**
 * Single-line variable for the approved template. Templates forbid newlines,
 * tabs and runs of 4+ spaces in variables.
 */
export function reminderTemplateVariable(items: ReminderItem[]): string {
  const shown = items.slice(0, 5).map((it) => `${escapeWa(it.name, 30)} (${describeDays(it.daysLeft)})`);
  const more = items.length > 5 ? `, and ${items.length - 5} more` : "";
  return shown.join(", ") + more;
}
