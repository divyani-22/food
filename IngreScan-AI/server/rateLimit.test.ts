import { describe, expect, it, vi } from "vitest";
import { createRateLimiter } from "./_core/rateLimit";

function run(limiter: any, ip = "1.1.1.1") {
  const res: any = { statusCode: 200, setHeader: vi.fn(), status(c: number) { this.statusCode = c; return this; }, json: vi.fn() };
  const next = vi.fn();
  limiter({ ip, socket: {} } as any, res, next);
  return { res, next };
}

describe("createRateLimiter", () => {
  it("blocks after max requests per window, per IP", () => {
    const l = createRateLimiter({ windowMs: 60_000, max: 2 });
    expect(run(l).next).toHaveBeenCalled();
    expect(run(l).next).toHaveBeenCalled();
    const third = run(l);
    expect(third.next).not.toHaveBeenCalled();
    expect(third.res.statusCode).toBe(429);
    expect(run(l, "2.2.2.2").next).toHaveBeenCalled();
  });
});
