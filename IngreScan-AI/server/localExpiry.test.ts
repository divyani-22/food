import { describe, expect, it } from "vitest";
import { localExpiry } from "../client/src/lib/utils";

describe("localExpiry (calendar days in local tz)", () => {
  const now = new Date(2026, 0, 10, 23, 30); // local Jan 10, late evening
  it("same calendar date is 0 days left, expiring soon", () => {
    expect(localExpiry("2026-01-10T00:00:00Z", now)).toEqual({ daysLeft: 0, status: "expiring_soon" });
  });
  it("yesterday is expired, next week is fresh", () => {
    expect(localExpiry("2026-01-09T00:00:00Z", now).status).toBe("expired");
    expect(localExpiry("2026-01-17T00:00:00Z", now)).toEqual({ daysLeft: 7, status: "fresh" });
  });
  it("invalid date is expired", () => {
    expect(localExpiry("nope", now).status).toBe("expired");
  });
});
