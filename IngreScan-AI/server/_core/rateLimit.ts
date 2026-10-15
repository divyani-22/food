import type { NextFunction, Request, Response } from "express";

const SWEEP_THRESHOLD = 10_000;
const SWEEP_MIN_INTERVAL_MS = 1_000;
const MAX_KEYS = 100_000;

/**
 * Bucket key for a client address. IPv4-mapped IPv6 collapses to the IPv4 address, and every IPv6 address is reduced
 * to its /64 prefix: one subscriber normally owns a whole /64, so keying on the full address would let a single
 * client dodge the limit by rotating addresses.
 */
export function rateLimitKey(ip: string): string {
  const raw = ip.trim().toLowerCase().split("%")[0];
  const mapped = /^(?:0{0,4}:){0,5}ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(raw) ?? /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(raw);
  if (mapped) return mapped[1];
  if (!raw.includes(":")) return raw;
  // Expand "::" to a full 8-group address, then keep the first 4 groups.
  const [head, tail] = raw.split("::");
  const h = head ? head.split(":") : [];
  const t = tail === undefined ? [] : tail ? tail.split(":") : [];
  const groups = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  if (groups.length !== 8 || groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return raw;
  return groups.slice(0, 4).map(g => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

/** Minimal fixed-window, in-memory per-IP rate limiter (single-process). */
export function createRateLimiter({ windowMs, max, keyFn }: { windowMs: number; max: number; keyFn?: (req: Request) => string | null }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  let lastSweep = 0;
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    // Sweeping scans every entry, so do it at most once per second (a spray of unique keys must not make each request O(n)).
    if (hits.size > SWEEP_THRESHOLD && now - lastSweep >= SWEEP_MIN_INTERVAL_MS) {
      lastSweep = now;
      hits.forEach((v, k) => v.resetAt <= now && hits.delete(k));
    }
    const key = keyFn?.(req) ?? rateLimitKey(req.ip || req.socket.remoteAddress || "unknown");
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
      // Hard cap: drop the oldest-inserted keys (Map keeps insertion order).
      while (hits.size > MAX_KEYS) {
        const oldest = hits.keys().next().value;
        if (oldest === undefined) break;
        hits.delete(oldest);
      }
    }
    entry.count++;
    if (entry.count > max) {
      res.setHeader("Retry-After", Math.ceil((entry.resetAt - now) / 1000));
      res.status(429).json({ error: "Too many requests. Please slow down." });
      return;
    }
    next();
  };
}
