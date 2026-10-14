/**
 * Link-code helpers. The web app generates a code on the Profile page
 * ("Connect WhatsApp"); the user sends `LINK <code>` from WhatsApp.
 * Only a salted SHA-256 hash is stored; codes are single use and expire after 10 minutes.
 */
import { createHash, randomBytes, randomInt } from "node:crypto";
import { safeEqual } from "./security";

/** No I, L, O, 0 or 1: unambiguous when read from a screen. 31 symbols. */
export const LINK_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const LINK_CODE_LENGTH = 8;
export const LINK_CODE_TTL_MS = 10 * 60 * 1000;

export function generateLinkCode(): string {
  let out = "";
  for (let i = 0; i < LINK_CODE_LENGTH; i++) out += LINK_CODE_ALPHABET[randomInt(LINK_CODE_ALPHABET.length)];
  return out;
}

/** Uppercase, strip spaces/dashes. Returns null when it cannot be a valid code. */
export function normalizeLinkCode(input: string): string | null {
  const c = input.replace(/[\s-]/g, "").toUpperCase();
  if (c.length !== LINK_CODE_LENGTH) return null;
  for (const ch of c) if (!LINK_CODE_ALPHABET.includes(ch)) return null;
  return c;
}

export function generateSalt(): string {
  return randomBytes(16).toString("hex");
}

export function hashLinkCode(code: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${code}`).digest("hex");
}

export interface LinkCodeRecord {
  userId: string;
  salt: string;
  codeHash: string;
  expiresAt: number;
  usedAt: number | null;
}

/** Create a new code and the record to persist (the plaintext code is shown once, never stored). */
export function createLinkCode(args: { userId: string; now: number; ttlMs?: number }): {
  code: string;
  record: LinkCodeRecord;
} {
  const code = generateLinkCode();
  const salt = generateSalt();
  return {
    code,
    record: {
      userId: args.userId,
      salt,
      codeHash: hashLinkCode(code, salt),
      expiresAt: args.now + (args.ttlMs ?? LINK_CODE_TTL_MS),
      usedAt: null,
    },
  };
}

export type LinkCheck = "ok" | "invalid" | "expired" | "used";

export function checkLinkCode(record: LinkCodeRecord, code: string, now: number): LinkCheck {
  const norm = normalizeLinkCode(code);
  if (!norm) return "invalid";
  if (!safeEqual(hashLinkCode(norm, record.salt), record.codeHash)) return "invalid";
  if (record.usedAt !== null) return "used";
  if (now >= record.expiresAt) return "expired";
  return "ok";
}

/**
 * Salts are per code, so the code hash cannot be looked up directly. Load the
 * (small) set of recently issued records and let this helper find the match.
 * Records that match but are expired/used are reported so the user gets a precise message.
 */
export function findMatchingLinkRecord<T extends LinkCodeRecord>(
  records: T[],
  code: string,
  now: number,
): { record: T; status: LinkCheck } | null {
  let fallback: { record: T; status: LinkCheck } | null = null;
  for (const r of records) {
    const status = checkLinkCode(r, code, now);
    if (status === "ok") return { record: r, status };
    if (status !== "invalid") fallback = { record: r, status };
  }
  return fallback;
}

/** Fixed-window failure counter per key (phone). In-memory; see docs for multi-instance setups. */
export class AttemptLimiter {
  private fails = new Map<string, { count: number; windowStart: number }>();
  constructor(private readonly maxAttempts = 5, private readonly windowMs = 15 * 60 * 1000) {}

  allowed(key: string, now: number): boolean {
    const e = this.fails.get(key);
    if (!e) return true;
    if (now - e.windowStart >= this.windowMs) {
      this.fails.delete(key);
      return true;
    }
    return e.count < this.maxAttempts;
  }

  fail(key: string, now: number): void {
    const e = this.fails.get(key);
    if (!e || now - e.windowStart >= this.windowMs) this.fails.set(key, { count: 1, windowStart: now });
    else e.count += 1;
    if (this.fails.size > 10_000) {
      const oldest = this.fails.keys().next().value;
      if (oldest !== undefined) this.fails.delete(oldest);
    }
  }

  reset(key: string): void {
    this.fails.delete(key);
  }
}
