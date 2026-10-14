import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { Provider } from "./types";

export const DEFAULT_MAX_MEDIA_BYTES = 8 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Constant-time string comparison that does not leak length. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

// ------------------------------------------------------------------- SSRF guard

const HOST_ALLOWLIST: Record<Provider, { exact: string[]; suffix: string[] }> = {
  twilio: {
    exact: ["api.twilio.com", "media.twiliocdn.com"],
    suffix: [".twilio.com"],
  },
  meta: {
    exact: ["lookaside.fbsbx.com", "graph.facebook.com"],
    suffix: [".fbcdn.net"],
  },
};

/** True for private, loopback, link-local, CGNAT, multicast and reserved IP literals. */
export function isPrivateOrReservedIp(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  const kind = isIP(h);
  if (kind === 4) {
    const [a, b] = h.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (kind === 6) {
    if (h === "::" || h === "::1") return true;
    if (h.startsWith("::ffff:")) return true; // IPv4-mapped: always reject
    return /^(fc|fd|fe[89ab]|ff)/.test(h);
  }
  return false;
}

export interface MediaUrlCheck {
  ok: boolean;
  reason?: string;
}

/**
 * SSRF guard for media URLs. Hostname-literal checks only (no DNS lookups):
 * https, no credentials, default port, no IP literals, no localhost, and the
 * host must be on the provider allowlist.
 */
export function checkMediaUrl(rawUrl: string, provider: Provider): MediaUrlCheck {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (u.protocol !== "https:") return { ok: false, reason: "not_https" };
  if (u.username || u.password) return { ok: false, reason: "credentials_in_url" };
  if (u.port && u.port !== "443") return { ok: false, reason: "bad_port" };
  const host = u.hostname.toLowerCase();
  if (!host || host.endsWith(".")) return { ok: false, reason: "bad_host" };
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return { ok: false, reason: "local_host" };
  }
  if (isIP(host.replace(/^\[|\]$/g, "")) !== 0 || host.startsWith("[")) {
    return { ok: false, reason: "ip_literal" };
  }
  // Numeric-looking hosts such as 2130706433 or 0x7f.1 are normalised to IPv4 by URL,
  // but guard anyway.
  if (/^[0-9.x]+$/i.test(host)) return { ok: false, reason: "ip_literal" };
  const list = HOST_ALLOWLIST[provider];
  const allowed =
    list.exact.includes(host) || list.suffix.some((s) => host.endsWith(s) && host.length > s.length);
  if (!allowed) return { ok: false, reason: "host_not_allowed" };
  return { ok: true };
}

export function isAllowedMediaUrl(rawUrl: string, provider: Provider): boolean {
  return checkMediaUrl(rawUrl, provider).ok;
}

export function normalizeContentType(ct: string | null | undefined): string {
  return (ct ?? "").split(";")[0].trim().toLowerCase();
}

export function isAllowedImageType(ct: string | null | undefined): boolean {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(normalizeContentType(ct));
}

export class MediaRejectedError extends Error {
  constructor(public readonly reason: "too_large" | "bad_type" | "bad_url" | "download_failed" | "empty") {
    super(`media_rejected:${reason}`);
    this.name = "MediaRejectedError";
  }
}

// ------------------------------------------------------------------- Rate limit

export interface TokenBucketOptions {
  /** Burst size. */
  capacity: number;
  /** Tokens added per second. */
  refillPerSec: number;
  /** Bound on tracked keys; oldest entries are dropped beyond this. */
  maxKeys?: number;
  now?: () => number;
}

/** In-memory token bucket per key (phone). Single-process only; see docs for scaling. */
export class TokenBucketLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  private readonly opts: Required<Omit<TokenBucketOptions, "now">> & { now: () => number };

  constructor(opts: TokenBucketOptions) {
    this.opts = { maxKeys: 10_000, now: Date.now, ...opts };
  }

  take(key: string, nowOverride?: number): boolean {
    const now = nowOverride ?? this.opts.now();
    const { capacity, refillPerSec } = this.opts;
    const b = this.buckets.get(key) ?? { tokens: capacity, at: now };
    const elapsed = Math.max(0, now - b.at) / 1000;
    b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerSec);
    b.at = now;
    let ok = false;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      ok = true;
    }
    this.buckets.delete(key);
    this.buckets.set(key, b);
    if (this.buckets.size > this.opts.maxKeys) {
      const oldest = this.buckets.keys().next().value;
      if (oldest !== undefined) this.buckets.delete(oldest);
    }
    return ok;
  }
}

export function createDefaultRateLimiter(now?: () => number): TokenBucketLimiter {
  // Burst of 8 messages, then 1 message every 6 seconds.
  return new TokenBucketLimiter({ capacity: 8, refillPerSec: 1 / 6, now });
}
