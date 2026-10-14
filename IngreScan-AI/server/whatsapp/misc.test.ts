import { describe, expect, it } from "vitest";
import { gs1CheckDigit, validateBarcode } from "./barcode";
import {
  AttemptLimiter,
  LINK_CODE_ALPHABET,
  checkLinkCode,
  createLinkCode,
  findMatchingLinkRecord,
  generateLinkCode,
  hashLinkCode,
  normalizeLinkCode,
} from "./linking";
import { maskPhone, normalizePhone, toMetaAddress, toTwilioAddress } from "./phone";
import { addDaysToLocalDate, canonicalTimeZone, daysBetween, isIsoDate, isValidTimeZone } from "./time";

describe("barcode validation", () => {
  it.each(["5449000000996", "4006381333931", "96385074", "036000291452", "00012345678905"])("%s is valid", (b) =>
    expect(validateBarcode(b)).toEqual({ valid: true, digits: b }),
  );
  it("detects checksum errors and tells the expected digit", () => {
    expect(validateBarcode("5449000000995")).toMatchObject({ valid: false, reason: "checksum", expectedCheckDigit: 6 });
    expect(validateBarcode("96385075")).toMatchObject({ valid: false, reason: "checksum" });
  });
  it("detects bad lengths and characters", () => {
    for (const b of ["123456789", "1234567890", "12345678901", "abcdefgh", ""]) expect(validateBarcode(b)).toMatchObject({ valid: false, reason: "length" });
  });
  it("tolerates spaces and dashes", () => {
    expect(validateBarcode("5 449000 000996").valid).toBe(true);
  });
  it("gs1CheckDigit", () => {
    expect(gs1CheckDigit("544900000099")).toBe(6);
  });
});

describe("link codes", () => {
  it("generates 8-char codes from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const c = generateLinkCode();
      expect(c).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    }
    for (const bad of ["I", "L", "O", "0", "1"]) expect(LINK_CODE_ALPHABET).not.toContain(bad);
    expect(new Set(Array.from({ length: 50 }, generateLinkCode)).size).toBe(50);
  });
  it("normalizes and rejects malformed codes", () => {
    expect(normalizeLinkCode("abcd-2345")).toBe("ABCD2345");
    expect(normalizeLinkCode("ABCD 2345")).toBe("ABCD2345");
    for (const bad of ["ABCD234", "ABCD23456", "ABCD234O", "ABCD2341", "", "ABCD-234!"]) expect(normalizeLinkCode(bad)).toBeNull();
  });
  it("stores only a salted hash; check is single use with 10 minute TTL", () => {
    const { code, record } = createLinkCode({ userId: "u1", now: 1000 });
    expect(JSON.stringify(record)).not.toContain(code);
    expect(record.expiresAt).toBe(1000 + 10 * 60_000);
    expect(record.codeHash).toBe(hashLinkCode(code, record.salt));
    expect(checkLinkCode(record, code, 2000)).toBe("ok");
    expect(checkLinkCode(record, code.toLowerCase(), 2000)).toBe("ok");
    expect(checkLinkCode(record, "ZZZZZZZZ", 2000)).toBe("invalid");
    expect(checkLinkCode(record, code, record.expiresAt)).toBe("expired");
    expect(checkLinkCode({ ...record, usedAt: 1500 }, code, 2000)).toBe("used");
  });
  it("same code gets different hashes with different salts", () => {
    expect(hashLinkCode("ABCD2345", "a")).not.toBe(hashLinkCode("ABCD2345", "b"));
  });
  it("finds the matching record among several, preferring a live one", () => {
    const a = createLinkCode({ userId: "a", now: 0 });
    const b = createLinkCode({ userId: "b", now: 0 });
    expect(findMatchingLinkRecord([a.record, b.record], b.code, 5)?.record.userId).toBe("b");
    expect(findMatchingLinkRecord([a.record, b.record], "ZZZZZZZZ", 5)).toBeNull();
    expect(findMatchingLinkRecord([a.record], a.code, 10 * 60_000 + 1)?.status).toBe("expired");
  });
  it("AttemptLimiter locks after 5 failures and resets after the window", () => {
    const l = new AttemptLimiter(5, 1000);
    for (let i = 0; i < 5; i++) {
      expect(l.allowed("p", i)).toBe(true);
      l.fail("p", i);
    }
    expect(l.allowed("p", 10)).toBe(false);
    expect(l.allowed("q", 10)).toBe(true);
    expect(l.allowed("p", 1001)).toBe(true);
    l.fail("p", 1001);
    l.reset("p");
    expect(l.allowed("p", 1002)).toBe(true);
  });
});

describe("phone", () => {
  it("normalizes to E.164", () => {
    expect(normalizePhone("whatsapp:+919876543210")).toBe("+919876543210");
    expect(normalizePhone("WhatsApp:+1 (555) 123-4567")).toBe("+15551234567");
    expect(normalizePhone("919876543210")).toBe("+919876543210");
    expect(normalizePhone("00919876543210")).toBe("+919876543210");
  });
  it("rejects garbage", () => {
    for (const b of ["", undefined, null, "abc", "+0123456789", "123", "+1234567890123456", "whatsapp:", "tel:+12345678901x"]) expect(normalizePhone(b as any)).toBeNull();
  });
  it("addresses providers", () => {
    expect(toTwilioAddress("+919876543210")).toBe("whatsapp:+919876543210");
    expect(toMetaAddress("+919876543210")).toBe("919876543210");
    expect(maskPhone("+919876543210")).toBe("+919***3210");
  });
});

describe("time helpers", () => {
  it("validates IANA zones", () => {
    for (const z of ["Asia/Kolkata", "America/New_York", "UTC", "Europe/London"]) expect(isValidTimeZone(z)).toBe(true);
    for (const z of ["Mars/Base", "", "../../x", "Asia/Kolkata; DROP", "a".repeat(100), undefined]) expect(isValidTimeZone(z as any)).toBe(false);
    expect(canonicalTimeZone("asia/kolkata")).toMatch(/^Asia\/(Kolkata|Calcutta)$/);
    expect(canonicalTimeZone("nope")).toBeNull();
  });
  it("calendar arithmetic across month, year and leap boundaries", () => {
    expect(addDaysToLocalDate("2026-10-31", 2)).toBe("2026-11-02");
    expect(addDaysToLocalDate("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDaysToLocalDate("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysToLocalDate("2027-02-28", 1)).toBe("2027-03-01");
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
    expect(daysBetween("2026-11-02", "2026-10-31")).toBe(-2);
    expect(daysBetween("x", "2026-01-01")).toBeNaN();
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-02-28")).toBe(true);
  });
});

describe("canonicalTimeZone keeps the spelling users type", () => {
  it("does not rewrite modern names to legacy ICU aliases", () => {
    expect(canonicalTimeZone("Asia/Kolkata")).toBe("Asia/Kolkata");
    expect(canonicalTimeZone("America/Argentina/Buenos_Aires")).toBe("America/Argentina/Buenos_Aires");
    expect(canonicalTimeZone("UTC")).toBe("UTC");
    expect(canonicalTimeZone("Etc/GMT+3")).toBe("Etc/GMT+3");
  });
  it("fixes casing for sloppy input and rejects unknown zones", () => {
    expect(canonicalTimeZone("europe/london")).toBe("Europe/London");
    expect(canonicalTimeZone("Mars/Base")).toBeNull();
    expect(canonicalTimeZone("")).toBeNull();
  });
});
