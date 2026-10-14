import { describe, expect, it } from "vitest";
import { TokenBucketLimiter, checkMediaUrl, isAllowedImageType, isAllowedMediaUrl, isPrivateOrReservedIp, safeEqual } from "./security";

describe("SSRF guard: Twilio", () => {
  it.each([
    "https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/MM1/Media/ME1",
    "https://media.twiliocdn.com/AC1/abc",
    "https://sub.twilio.com/x",
    "https://API.TWILIO.COM/x",
  ])("allows %s", (u) => expect(isAllowedMediaUrl(u, "twilio")).toBe(true));

  it.each([
    ["http://api.twilio.com/x", "not_https"],
    ["https://api.twilio.com@evil.com/x", "credentials_in_url"],
    ["https://user:pw@api.twilio.com/x", "credentials_in_url"],
    ["https://evil.com/api.twilio.com", "host_not_allowed"],
    ["https://api.twilio.com.evil.com/x", "host_not_allowed"],
    ["https://eviltwilio.com/x", "host_not_allowed"],
    ["https://twilio.com/x", "host_not_allowed"],
    ["https://api.twilio.com./x", "bad_host"],
    ["https://api.twilio.com:8443/x", "bad_port"],
    ["https://localhost/x", "local_host"],
    ["https://foo.localhost/x", "local_host"],
    ["https://127.0.0.1/x", "ip_literal"],
    ["https://169.254.169.254/latest/meta-data", "ip_literal"],
    ["https://10.0.0.5/x", "ip_literal"],
    ["https://[::1]/x", "ip_literal"],
    ["https://[::ffff:127.0.0.1]/x", "ip_literal"],
    ["https://2130706433/x", "ip_literal"],
    ["https://0x7f.1/x", "ip_literal"],
    ["ftp://api.twilio.com/x", "not_https"],
    ["file:///etc/passwd", "not_https"],
    ["javascript:alert(1)", "not_https"],
    ["not a url", "invalid_url"],
    ["", "invalid_url"],
    ["https://media.twiliocdn.com.evil.com/x", "host_not_allowed"],
  ])("blocks %s (%s)", (u, reason) => {
    const r = checkMediaUrl(u, "twilio");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(reason);
  });

  it("does not accept Meta hosts for Twilio and vice versa", () => {
    expect(isAllowedMediaUrl("https://lookaside.fbsbx.com/x", "twilio")).toBe(false);
    expect(isAllowedMediaUrl("https://api.twilio.com/x", "meta")).toBe(false);
  });
});

describe("SSRF guard: Meta", () => {
  it.each([
    "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1",
    "https://scontent.xx.fbcdn.net/v/x.jpg",
    "https://graph.facebook.com/v20.0/123",
  ])("allows %s", (u) => expect(isAllowedMediaUrl(u, "meta")).toBe(true));

  it.each([
    "http://lookaside.fbsbx.com/x",
    "https://fbcdn.net/x",
    "https://evilfbcdn.net/x",
    "https://lookaside.fbsbx.com@evil.com/x",
    "https://graph.facebook.com.evil.com/x",
    "https://facebook.com/x",
    "https://192.168.1.1/x",
    "https://[fd00::1]/x",
  ])("blocks %s", (u) => expect(isAllowedMediaUrl(u, "meta")).toBe(false));
});

describe("IP classification", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fc00::1", "::ffff:10.0.0.1"])(
    "%s is private/reserved",
    (ip) => expect(isPrivateOrReservedIp(ip)).toBe(true),
  );
  it.each(["8.8.8.8", "172.32.0.1", "1.1.1.1", "example.com"])("%s is not", (ip) => expect(isPrivateOrReservedIp(ip)).toBe(false));
});

describe("content types and compare", () => {
  it("allows only jpeg/png/webp", () => {
    for (const t of ["image/jpeg", "IMAGE/PNG", "image/webp; charset=binary"]) expect(isAllowedImageType(t)).toBe(true);
    for (const t of ["image/gif", "image/svg+xml", "text/html", "application/pdf", "", undefined, null]) expect(isAllowedImageType(t as any)).toBe(false);
  });
  it("safeEqual", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});

describe("TokenBucketLimiter", () => {
  it("allows a burst, refills over time, and isolates keys", () => {
    let t = 0;
    const l = new TokenBucketLimiter({ capacity: 2, refillPerSec: 1, now: () => t });
    expect([l.take("a"), l.take("a"), l.take("a")]).toEqual([true, true, false]);
    expect(l.take("b")).toBe(true);
    t = 1000;
    expect(l.take("a")).toBe(true);
    expect(l.take("a")).toBe(false);
    t = 60_000;
    expect([l.take("a"), l.take("a"), l.take("a")]).toEqual([true, true, false]);
  });
  it("bounds memory", () => {
    const l = new TokenBucketLimiter({ capacity: 1, refillPerSec: 0, maxKeys: 3, now: () => 0 });
    for (let i = 0; i < 10; i++) l.take("k" + i);
    expect((l as any).buckets.size).toBe(3);
  });
});
