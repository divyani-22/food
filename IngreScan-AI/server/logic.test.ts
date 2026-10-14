import { describe, expect, it } from "vitest";
import {
  clampRiskScore,
  computeBmi,
  computeExpiry,
  firstCategory,
  getLLMText,
  normalizeGrade,
  normalizeNova,
  parseAllergens,
  parseLLMJson,
  parseTimestampInput,
  sanitizeAlternative,
  sanitizeFileName,
  sanitizeIngredient,
} from "./logic";

const now = new Date("2026-10-13T12:00:00Z");
const inDays = (d: number) => new Date(now.getTime() + d * 86400000);

describe("computeExpiry", () => {
  it("classifies fresh / expiring_soon / expired", () => {
    expect(computeExpiry(inDays(10), now)).toEqual({ daysLeft: 10, status: "fresh" });
    expect(computeExpiry(inDays(3), now)).toEqual({ daysLeft: 3, status: "expiring_soon" });
    expect(computeExpiry(inDays(0.5), now)).toEqual({ daysLeft: 1, status: "expiring_soon" });
    expect(computeExpiry(inDays(-2), now).status).toBe("expired");
  });
  it("never returns -0 and handles invalid dates", () => {
    const r = computeExpiry(inDays(-0.3), now);
    expect(Object.is(r.daysLeft, -0)).toBe(false);
    expect(computeExpiry("garbage", now)).toEqual({ daysLeft: 0, status: "expired" });
  });
});

describe("parseTimestampInput", () => {
  it("accepts valid dates and rejects invalid / out-of-range", () => {
    expect(parseTimestampInput("2026-12-31")).toBeInstanceOf(Date);
    expect(parseTimestampInput("nope")).toBeNull();
    expect(parseTimestampInput("")).toBeNull();
    expect(parseTimestampInput("2099-01-01")).toBeNull(); // beyond MySQL TIMESTAMP range
    expect(parseTimestampInput("1960-01-01")).toBeNull();
  });
});

describe("parseLLMJson / getLLMText", () => {
  it("parses plain, fenced and prose-wrapped JSON", () => {
    expect(parseLLMJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseLLMJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(parseLLMJson('Here you go: {"a":3} hope it helps')).toEqual({ a: 3 });
  });
  it("throws on empty / invalid", () => {
    expect(() => parseLLMJson("")).toThrow();
    expect(() => parseLLMJson("not json")).toThrow();
  });
  it("extracts text from string, array and missing choices", () => {
    expect(getLLMText({ choices: [{ message: { content: "hi" } }] })).toBe("hi");
    expect(getLLMText({ choices: [{ message: { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] } }] })).toBe("ab");
    expect(getLLMText({})).toBe("");
    expect(getLLMText(undefined)).toBe("");
  });
});

describe("sanitizeAlternative brand", () => {
  it("keeps a named brand, trims it, and stores null for empty/missing/non-string brands", () => {
    const base = { productName: "Roasted makhana", reason: "No palm oil" };
    expect(sanitizeAlternative({ ...base, brand: "  Farmley  " })?.brand).toBe("Farmley");
    expect(sanitizeAlternative({ ...base, brand: "" })?.brand).toBeNull();
    expect(sanitizeAlternative({ ...base })?.brand).toBeNull();
    expect(sanitizeAlternative({ ...base, brand: 42 })?.brand).toBeNull();
    expect(sanitizeAlternative({ ...base, brand: "x".repeat(400) })?.brand?.length).toBeLessThanOrEqual(255);
  });
});

describe("sanitizeIngredient / sanitizeAlternative", () => {
  it("drops nameless entries and invalid risk levels, truncates long names", () => {
    expect(sanitizeIngredient({ riskLevel: "high" })).toBeNull();
    const i = sanitizeIngredient({ name: "x".repeat(400), riskLevel: "HIGH", sources: ["a", 5] })!;
    expect(i.name).toHaveLength(255);
    expect(i.riskLevel).toBe("high");
    expect(i.sources).toBe('["a"]');
    expect(sanitizeIngredient({ name: "Sugar", riskLevel: "weird" })!.riskLevel).toBeNull();
    expect(sanitizeIngredient({ name: "Sugar" })!.sources).toBe("[]");
  });
  it("requires productName and reason for alternatives", () => {
    expect(sanitizeAlternative({ productName: "A" })).toBeNull();
    expect(sanitizeAlternative({ productName: "A", reason: "r" })!.sources).toBe("[]");
  });
});

describe("misc helpers", () => {
  it("clampRiskScore", () => {
    expect(clampRiskScore(150)).toBe(100);
    expect(clampRiskScore(-5)).toBe(0);
    expect(clampRiskScore("42.6")).toBe(43);
    expect(clampRiskScore(undefined)).toBeNull();
    expect(clampRiskScore(NaN)).toBeNull();
  });
  it("Open Food Facts normalisers", () => {
    expect(normalizeGrade("a")).toBe("A");
    expect(normalizeGrade("unknown")).toBeNull();
    expect(normalizeGrade("not-applicable")).toBeNull();
    expect(normalizeGrade(undefined)).toBeNull();
    expect(normalizeNova(4)).toBe(4);
    expect(normalizeNova("3")).toBe(3);
    expect(normalizeNova(9)).toBeNull();
    expect(firstCategory("en:snacks, en:chips")).toBe("snacks");
    expect(firstCategory(undefined)).toBe("Food");
    expect(firstCategory(["x"])).toBe("Food");
    expect(parseAllergens("en:milk, en:nuts,")).toEqual(["milk", "nuts"]);
    expect(parseAllergens(null)).toEqual([]);
  });
  it("sanitizeFileName strips paths", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("my photo (1).jpg")).toBe("my_photo__1_.jpg");
    expect(sanitizeFileName("")).toBe("file");
  });
  it("computeBmi", () => {
    expect(computeBmi(170, 70)).toBe(24.2);
    expect(computeBmi(undefined, 70)).toBeUndefined();
    expect(computeBmi(0, 70)).toBeUndefined();
  });
});

describe("computeExpiry: expiring today", () => {
  it("treats an item expiring today (daysLeft 0) as expiring_soon, not expired", () => {
    const now = new Date("2026-01-10T12:00:00Z");
    const r = computeExpiry("2026-01-10T00:00:00Z", now);
    expect(r).toEqual({ daysLeft: 0, status: "expiring_soon" });
    expect(computeExpiry("2026-01-08T00:00:00Z", now).status).toBe("expired");
  });
});
