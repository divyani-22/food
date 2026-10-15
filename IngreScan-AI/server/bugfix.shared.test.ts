import { describe, expect, it } from "vitest";
import { parseReceiptText } from "../shared/engines/receiptParser";
import { addDaysIso, estimateShelfLife, normalizeFoodName } from "../shared/engines/shelfLife";
import { canonicalProduceKey } from "../shared/engines/ethylene";
import { ebillToText } from "../shared/engines/ebill";

const NOW = new Date("2026-10-15T10:00:00Z");

describe("receipt parser: decimal comma weights", () => {
  it("reads 1,5 kg as 1.5 kg, not 5 kg", () => {
    const r = parseReceiptText("Tomato 1,5 kg 60.00\nOnion 0,5 kg 20.00", { now: NOW });
    expect(r.items.map((i) => [i.name, i.quantity, i.unit])).toEqual([["Tomato", 1.5, "kg"], ["Onion", 0.5, "kg"]]);
  });
  it("reads comma weight with comma rate", () => {
    const r = parseReceiptText("Tomato 1,5 kg @ 40,00\nMilk 30.00", { now: NOW });
    expect(r.items[0]).toMatchObject({ name: "Tomato", quantity: 1.5, unit: "kg" });
  });
  it("does not treat a thousands group as decimal", () => {
    const r = parseReceiptText("Rice 1,000 g 90.00\nMilk 30.00", { now: NOW });
    expect(r.items[0].packSize ?? "").not.toMatch(/^0 g/);
  });
});

describe("receipt parser: merchant lookup ignores prototype keys", () => {
  it("does not take a store name from Object.prototype", () => {
    for (const merchant of ["constructor", "toString", "__proto__"]) {
      const r = parseReceiptText("Milk 30.00", { now: NOW, ebill: true, merchant });
      expect(r.store).toBeUndefined();
    }
  });
});

describe("shelf life", () => {
  it("ignores zero-width characters and soft hyphens inside a word", () => {
    expect(normalizeFoodName("mi​lk").tokens).toEqual(["milk"]);
    expect(estimateShelfLife("Mi­lk")?.matchedKey).toBe("milk");
  });
  it("addDaysIso survives non-finite day counts", () => {
    expect(addDaysIso(NOW, NaN)).toBe("2026-10-15");
    expect(addDaysIso(new Date("2024-02-28T23:00:00Z"), 2)).toBe("2024-03-01");
  });
});

describe("ethylene lookup", () => {
  it("no fuzzy match inside multi-word names", () => {
    expect(canonicalProduceKey("Free range eggs")).toBeNull();
    expect(canonicalProduceKey("Grade A eggs")).toBeNull();
    expect(canonicalProduceKey("Beach towel")).toBeNull();
  });
  it("processed foods naming a fruit are not produce", () => {
    expect(canonicalProduceKey("Banana bread")).toBeNull();
    expect(canonicalProduceKey("Red pepper flakes")).toBeNull();
    expect(canonicalProduceKey("Mint chocolate")).toBeNull();
    expect(canonicalProduceKey("Banana")).toBe("banana");
  });
  it("still tolerates a single-word typo", () => {
    expect(canonicalProduceKey("bananna")).toBe("banana");
  });
});

describe("ebill header date", () => {
  it("rejects an impossible written date", () => {
    expect(ebillToText("Date: 31 Feb 2026\nMilk 3.00").headerDate).toBeUndefined();
    expect(ebillToText("Date: 14 Oct 2026\nMilk 3.00").headerDate).toBe("2026-10-14");
  });
});
