/**
 * Pure barcode helpers: normalization and GS1 check-digit validation for
 * EAN-13, EAN-8, UPC-A and UPC-E. No DOM or network access, so it is unit-tested in node.
 */

export type BarcodeFormat = "ean_13" | "ean_8" | "upc_a" | "upc_e";

export type BarcodeFailureReason = "empty" | "non_numeric" | "bad_length" | "bad_checksum";

export type BarcodeValid = {
  ok: true;
  format: BarcodeFormat;
  /** Digits exactly as scanned/typed (after normalization). */
  code: string;
  /** Code to send to Open Food Facts: UPC-A / UPC-E are padded to 13 digits, EAN-8 and EAN-13 are kept. */
  lookupCode: string;
};

export type BarcodeInvalid = {
  ok: false;
  reason: BarcodeFailureReason;
  message: string;
  /** Normalized digits when the input was numeric, otherwise the trimmed input. */
  code: string;
  /** Best guess of the intended format, when the length identifies it. */
  format?: BarcodeFormat;
  /** Set when reason is bad_checksum: the check digit that would have been correct. */
  expectedCheckDigit?: number;
};

export type BarcodeCheck = BarcodeValid | BarcodeInvalid;

const DIGITS_ONLY = /^\d+$/;

/**
 * Whitespace, ASCII and Unicode hyphens/dashes, and invisible format characters (zero-width space/joiners, LRM/RLM,
 * bidi embedding marks, word joiner, BOM, soft hyphen) that web pages and chat apps add around pasted codes.
 * Built from code points so the source stays pure ASCII.
 */
const INVISIBLE_OR_SEPARATOR = new RegExp(
  "[\\s\\-" +
    [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2212, 0xad, 0x34f, 0x180e, 0xfeff].map((c) => String.fromCharCode(c)).join("") +
    String.fromCharCode(0x200b) + "-" + String.fromCharCode(0x200f) +
    String.fromCharCode(0x202a) + "-" + String.fromCharCode(0x202e) +
    String.fromCharCode(0x2060) + "-" + String.fromCharCode(0x2064) +
    "]",
  "g",
);

/** Strip spaces, hyphens and common invisible characters that appear when copying or typing codes. */
export function normalizeBarcodeInput(raw: string): string {
  return String(raw ?? "")
    .normalize("NFKC")
    .replace(INVISIBLE_OR_SEPARATOR, "");
}

/**
 * GS1 check digit for a payload (all digits except the check digit).
 * Weights 3,1,3,1... starting from the digit nearest the check digit.
 */
export function gs1CheckDigit(payload: string): number {
  let sum = 0;
  for (let i = payload.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) {
    sum += Number(payload[i]) * w;
  }
  return (10 - (sum % 10)) % 10;
}

/** True when the last digit of `digits` is the correct GS1 check digit for the rest. */
export function hasValidGs1Check(digits: string): boolean {
  if (!DIGITS_ONLY.test(digits) || digits.length < 2) return false;
  return gs1CheckDigit(digits.slice(0, -1)) === Number(digits[digits.length - 1]);
}

/**
 * Expand an 8-digit UPC-E code (number system digit, 6 compressed digits, check digit)
 * to its 12-digit UPC-A equivalent. Returns null when the input cannot be a UPC-E.
 * The check digit is carried over unchanged (it is the check digit of the expanded code).
 */
export function expandUpcE(upcE: string): string | null {
  if (!/^\d{8}$/.test(upcE)) return null;
  const ns = upcE[0];
  if (ns !== "0" && ns !== "1") return null;
  const d = upcE.slice(1, 7);
  const check = upcE[7];
  const last = d[5];
  let body: string;
  if (last === "0" || last === "1" || last === "2") body = d.slice(0, 2) + last + "0000" + d.slice(2, 5);
  else if (last === "3") body = d.slice(0, 3) + "00000" + d.slice(3, 5);
  else if (last === "4") body = d.slice(0, 4) + "00000" + d[4];
  else body = d.slice(0, 5) + "0000" + last;
  return ns + body + check;
}

/** Compress a 12-digit UPC-A to UPC-E when it is compressible (zero suppression), else null. */
export function compressToUpcE(upcA: string): string | null {
  if (!/^[01]\d{11}$/.test(upcA)) return null;
  const ns = upcA[0];
  const m = upcA.slice(1, 6); // manufacturer
  const p = upcA.slice(6, 11); // product
  const check = upcA[11];
  let body: string | null = null;
  if (/^\d\d[012]00$/.test(m) && /^00\d{3}$/.test(p)) body = m.slice(0, 2) + p.slice(2) + m[2];
  else if (/^\d{3}00$/.test(m) && /^000\d\d$/.test(p)) body = m.slice(0, 3) + p.slice(3) + "3";
  else if (/^\d{4}0$/.test(m) && /^0000\d$/.test(p)) body = m.slice(0, 4) + p[4] + "4";
  else if (/^\d{5}$/.test(m) && /^0000[5-9]$/.test(p)) body = m + p[4];
  return body ? ns + body + check : null;
}

function bad(reason: BarcodeFailureReason, message: string, code: string, extra: Partial<BarcodeInvalid> = {}): BarcodeInvalid {
  return { ok: false, reason, message, code, ...extra };
}

/**
 * Validate a scanned or typed code.
 * @param raw   raw input
 * @param hint  format reported by the decoder (disambiguates 8-digit EAN-8 vs UPC-E)
 */
export function checkBarcode(raw: string, hint?: BarcodeFormat): BarcodeCheck {
  const trimmed = String(raw ?? "").trim();
  const code = normalizeBarcodeInput(trimmed);
  if (!code) return bad("empty", "Enter or scan a barcode number.", "");
  if (!DIGITS_ONLY.test(code)) {
    return bad("non_numeric", "Barcodes contain digits only (EAN-13, EAN-8, UPC-A or UPC-E).", trimmed);
  }

  const ok = (format: BarcodeFormat, lookupCode: string): BarcodeValid => ({ ok: true, format, code, lookupCode });

  switch (code.length) {
    case 13: {
      if (hasValidGs1Check(code)) {
        // A UPC-A decoded as EAN-13 starts with 0; callers may treat both the same.
        return ok(hint === "upc_a" && code[0] === "0" ? "upc_a" : "ean_13", code);
      }
      return bad("bad_checksum", `Check digit does not match (expected ${gs1CheckDigit(code.slice(0, 12))}). The number may be misread or mistyped.`, code, {
        format: "ean_13",
        expectedCheckDigit: gs1CheckDigit(code.slice(0, 12)),
      });
    }
    case 12: {
      if (hasValidGs1Check(code)) return ok("upc_a", "0" + code);
      const exp = gs1CheckDigit(code.slice(0, 11));
      return bad("bad_checksum", `Check digit does not match (expected ${exp}). The number may be misread or mistyped.`, code, {
        format: "upc_a",
        expectedCheckDigit: exp,
      });
    }
    case 8: {
      const asEan8 = hasValidGs1Check(code);
      const expanded = expandUpcE(code);
      const asUpcE = expanded !== null && hasValidGs1Check(expanded);
      if (hint === "upc_e" && asUpcE) return ok("upc_e", "0" + expanded!);
      if (asEan8) return ok("ean_8", code);
      if (asUpcE) return ok("upc_e", "0" + expanded!);
      const exp = gs1CheckDigit(code.slice(0, 7));
      return bad("bad_checksum", `Check digit does not match (expected ${exp}). The number may be misread or mistyped.`, code, {
        format: hint === "upc_e" ? "upc_e" : "ean_8",
        expectedCheckDigit: exp,
      });
    }
    default:
      return bad(
        "bad_length",
        `A barcode has 8, 12 or 13 digits; this has ${code.length}.`,
        code,
      );
  }
}

export type LiveFeedback =
  | { state: "empty" }
  | { state: "incomplete"; message: string }
  | { state: "valid"; check: BarcodeValid }
  | { state: "invalid"; check: BarcodeInvalid };

/** Feedback while typing: stay quiet until the length could be a complete code. */
export function liveBarcodeFeedback(raw: string): LiveFeedback {
  const code = normalizeBarcodeInput(raw);
  if (!code) return { state: "empty" };
  if (DIGITS_ONLY.test(code) && code.length < 13 && code.length !== 8 && code.length !== 12) {
    const next = code.length < 8 ? 8 : code.length < 12 ? 12 : 13;
    return { state: "incomplete", message: `${code.length} digits so far. Keep typing (${next} digits expected).` };
  }
  const check = checkBarcode(raw);
  return check.ok ? { state: "valid", check } : { state: "invalid", check };
}

export type DecodedCandidate = { rawValue: string; format?: string | null };

/** Map decoder format names (BarcodeDetector style or zxing BarcodeFormat names) to ours. */
export function toBarcodeFormat(name: string | null | undefined): BarcodeFormat | undefined {
  const n = String(name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (n === "ean13") return "ean_13";
  if (n === "ean8") return "ean_8";
  if (n === "upca") return "upc_a";
  if (n === "upce") return "upc_e";
  return undefined;
}

export type BestCandidate = { check: BarcodeCheck; candidate: DecodedCandidate };

/**
 * Pick the best result from one decode pass: the first candidate with a valid check digit wins;
 * if none is valid, return the first candidate that at least looks like a barcode so the UI can warn
 * about it instead of dropping it silently. Returns null when nothing was decoded.
 */
export function pickBestCandidate(candidates: DecodedCandidate[]): BestCandidate | null {
  let firstInvalid: BestCandidate | null = null;
  for (const candidate of candidates) {
    if (!candidate || typeof candidate.rawValue !== "string") continue;
    const check = checkBarcode(candidate.rawValue, toBarcodeFormat(candidate.format));
    if (check.ok) return { check, candidate };
    if (!firstInvalid && check.reason !== "empty") firstInvalid = { check, candidate };
  }
  return firstInvalid;
}
