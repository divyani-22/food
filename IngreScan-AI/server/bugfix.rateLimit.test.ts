import { describe, expect, it, vi } from "vitest";
import { createRateLimiter, rateLimitKey } from "./_core/rateLimit";

function run(limiter: any, ip: string) {
  const res: any = { statusCode: 200, setHeader: vi.fn(), status(c: number) { this.statusCode = c; return this; }, json: vi.fn() };
  const next = vi.fn();
  limiter({ ip, socket: {} } as any, res, next);
  return { res, next };
}

describe("rate limiter keys", () => {
  it("one IPv6 /64 shares a bucket (a single subscriber owns 2^64 addresses)", () => {
    const l = createRateLimiter({ windowMs: 60_000, max: 2 });
    expect(run(l, "2001:db8:1:2::1").next).toHaveBeenCalled();
    expect(run(l, "2001:db8:1:2:aaaa:bbbb:cccc:dddd").next).toHaveBeenCalled();
    expect(run(l, "2001:DB8:1:2:0:0:0:99").next).not.toHaveBeenCalled();
    expect(run(l, "2001:db8:1:3::1").next).toHaveBeenCalled();
  });
  it("IPv4-mapped IPv6 and plain IPv4 are the same client", () => {
    expect(rateLimitKey("::ffff:10.1.2.3")).toBe("10.1.2.3");
    expect(rateLimitKey("10.1.2.3")).toBe("10.1.2.3");
    expect(rateLimitKey("::1")).toBe(rateLimitKey("0:0:0:0:0:0:0:1"));
  });
  it("a spray of unique client addresses does not make every request scan the whole table", () => {
    const l = createRateLimiter({ windowMs: 60_000, max: 5 });
    const res: any = { setHeader() {}, status() { return this; }, json() {} };
    const next = () => {};
    const t0 = Date.now();
    for (let i = 0; i < 30_000; i++) l({ ip: `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`, socket: {} } as any, res, next);
    expect(Date.now() - t0).toBeLessThan(1_000); // was ~15 s (O(n^2))
    expect(run(l, "9.9.9.9").next).toHaveBeenCalled();
  });
});

describe("keyFn", () => {
  it("uses the supplied per-user key instead of the IP", () => {
    const l = createRateLimiter({ windowMs: 60_000, max: 1, keyFn: (r: any) => r.u ?? null });
    const go = (u: string, ip: string) => { const next = vi.fn(); l({ ip, u, socket: {} } as any, { setHeader() {}, status() { return this; }, json() {} } as any, next); return next.mock.calls.length; };
    expect(go("a", "1.1.1.1")).toBe(1);
    expect(go("a", "2.2.2.2")).toBe(0);
    expect(go("b", "1.1.1.1")).toBe(1);
  });
});
