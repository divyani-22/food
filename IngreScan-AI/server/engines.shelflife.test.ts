import { describe, expect, it } from "vitest";
import {
  SHELF_LIFE_TABLE,
  addDaysIso,
  classifyFoodItem,
  estimateShelfLife,
  isFoodItem,
} from "../shared/engines/shelfLife";

const NOW = new Date("2026-10-14T10:00:00Z");
const key = (name: string, opts: Parameters<typeof estimateShelfLife>[1] = {}) =>
  estimateShelfLife(name, { now: NOW, ...opts })?.matchedKey ?? null;

describe("shelf-life table integrity", () => {
  it("has at least 100 entries with unique keys", () => {
    expect(SHELF_LIFE_TABLE.length).toBeGreaterThanOrEqual(100);
    const keys = SHELF_LIFE_TABLE.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("uses only valid categories, confidences and non-negative integer days", () => {
    const cats = ["Dairy", "Produce", "Meat", "Grains", "Snacks", "Beverages", "Condiments", "Other"];
    for (const e of SHELF_LIFE_TABLE) {
      expect(cats).toContain(e.category);
      expect(["high", "medium", "low"]).toContain(e.confidence);
      for (const d of [e.days, e.openedDays ?? {}]) {
        for (const v of Object.values(d)) {
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
        }
      }
      expect(Object.keys(e.days).length).toBeGreaterThan(0);
      expect(e.days[e.defaultLocation] ?? 0).toBeGreaterThan(0);
    }
  });
  it("is pure ASCII (no emoji or non-English glyphs) in every string", () => {
    const blob = JSON.stringify(SHELF_LIFE_TABLE);
    expect(/[^\x20-\x7E]/.test(blob)).toBe(false);
  });
  it("keeps safety-critical numbers conservative", () => {
    const get = (k: string) => SHELF_LIFE_TABLE.find((e) => e.key === k)!;
    expect(get("chicken").days.fridge).toBeLessThanOrEqual(2);
    expect(get("ground_meat").days.fridge).toBeLessThanOrEqual(2);
    expect(get("fish").days.fridge).toBeLessThanOrEqual(2);
    expect(get("prawns").days.fridge).toBeLessThanOrEqual(2);
    expect(get("cooked_rice").days.fridge).toBe(1);
    expect(get("cooked_meat").days.fridge).toBeLessThanOrEqual(4);
    expect(get("milk").days.fridge).toBeLessThanOrEqual(7);
    expect(get("milk").openedDays?.fridge).toBeLessThanOrEqual(5);
    expect(get("eggs").days.fridge).toBeLessThanOrEqual(35);
    expect(get("deli_meat").openedDays?.fridge).toBeLessThanOrEqual(5);
  });
});

describe("estimateShelfLife: matching", () => {
  it("handles brand and size noise", () => {
    expect(key("Amul Taaza Toned Milk 500ml")).toBe("milk");
    expect(key("Britannia Whole Wheat Bread 400g")).toBe("bread");
    expect(key("Mother Dairy Dahi 400 g")).toBe("curd");
    expect(key("Aashirvaad Whole Wheat Atta 5kg")).toBe("flour_atta");
    expect(key("Basmati Rice 5 kg")).toBe("rice_raw");
    expect(key("Milk Full Cream 1L")).toBe("milk");
  });
  it("is case, plural and punctuation insensitive", () => {
    expect(key("TOMATOES")).toBe("tomato");
    expect(key("  bananas!! ")).toBe("banana");
    expect(key("Potato")).toBe("potato");
    expect(key("EGGS (12)")).toBe("eggs");
    expect(key("mangoes")).toBe("mango");
  });
  it("expands receipt abbreviations", () => {
    expect(key("TMT 1kg")).toBe("tomato");
    expect(key("BNLS CHKN BRST 1lb")).toBe("chicken");
    expect(key("ORG BNNA")).toBe("banana");
    expect(key("WH MLK 2L")).toBe("milk");
  });
  it("understands Indian names", () => {
    expect(key("Paneer 200g")).toBe("paneer");
    expect(key("Toor Dal 1kg")).toBe("dal_dry");
    expect(key("Bhindi")).toBe("okra");
    expect(key("Palak")).toBe("spinach");
    expect(key("Desi Ghee 500ml")).toBe("ghee");
    expect(key("Chapati")).toBe("roti");
  });
  it("prefers the head noun and longest phrase", () => {
    expect(key("Peanut Butter")).toBe("peanut_butter");
    expect(key("Ice Cream")).toBe("ice_cream");
    expect(key("Cream Cheese")).toBe("cream_cheese");
    expect(key("Tomato Ketchup")).toBe("ketchup");
    expect(key("Apple Juice")).toBe("juice");
    expect(key("Butter Chicken")).toBe("cooked_dish");
    expect(key("Chicken Biryani")).toBe("cooked_rice");
  });
  it("documented false-match cases do NOT map to the plain ingredient", () => {
    expect(key("Butterscotch Ice Cream")).toBe("ice_cream");
    expect(key("Butter Scotch")).toBeNull();
    expect(key("Milk Chocolate")).toBe("chocolate");
    expect(key("Cream Cracker")).toBe("biscuit");
    expect(key("Cadbury Dairy Milk Silk 60g")).toBe("chocolate");
    expect(key("Apple Pie")).toBeNull();
    expect(key("Egg Roll")).toBeNull();
    expect(key("Mango Shake Mix")).toBeNull();
    expect(key("Cream Roll")).toBeNull();
    expect(key("Coconut Water")).toBeNull();
    expect(key("Cold Coffee")).toBe("fresh_juice");
    expect(key("Milk Powder")).toBe("milk_powder");
    expect(key("Cream of Wheat")).toBe("cereal");
  });
  it("returns null for unknown or empty input", () => {
    expect(estimateShelfLife("", { now: NOW })).toBeNull();
    expect(estimateShelfLife("   ", { now: NOW })).toBeNull();
    expect(estimateShelfLife("Xyzzy Frobnicator", { now: NOW })).toBeNull();
    expect(estimateShelfLife(undefined as unknown as string)).toBeNull();
    expect(estimateShelfLife(42 as unknown as string)).toBeNull();
    expect(estimateShelfLife("123456", { now: NOW })).toBeNull();
  });
  it("many unexplained leading words lower confidence or reject", () => {
    const e = estimateShelfLife("Super Duper Mega Organic Farm Fresh Tomato", { now: NOW });
    expect(e?.matchedKey).toBe("tomato");
    expect(estimateShelfLife("Qwerty Asdf Zxcv Poiu Tomato", { now: NOW })).toBeNull();
    const two = estimateShelfLife("Qwerty Asdf Tomato", { now: NOW });
    expect(two?.confidence).toBe("low");
  });
  it("minConfidence filters low-confidence entries", () => {
    expect(estimateShelfLife("bottle gourd", { now: NOW })?.confidence).toBe("low");
    expect(estimateShelfLife("bottle gourd", { now: NOW, minConfidence: "medium" })).toBeNull();
    expect(estimateShelfLife("milk", { now: NOW, minConfidence: "high" })).not.toBeNull();
  });
});

describe("estimateShelfLife: locations, opened, frozen", () => {
  it("frozen switches to freezer shelf life", () => {
    const e = estimateShelfLife("Frozen Green Peas 500g", { now: NOW })!;
    expect(e.location).toBe("freezer");
    expect(e.days).toBeGreaterThanOrEqual(90);
    const c = estimateShelfLife("frozen chicken breast", { now: NOW })!;
    expect(c.location).toBe("freezer");
    expect(c.days).toBeGreaterThan(estimateShelfLife("chicken breast", { now: NOW })!.days);
    expect(c.note).toMatch(/quality/i);
  });
  it("respects an explicit location", () => {
    const f = estimateShelfLife("milk", { now: NOW, location: "freezer" })!;
    expect(f.location).toBe("freezer");
    expect(f.days).toBeGreaterThan(30);
  });
  it("room-temperature storage of perishables yields 0 days with a warning", () => {
    const e = estimateShelfLife("raw chicken", { now: NOW, location: "pantry" })!;
    expect(e.days).toBe(0);
    expect(e.expiryDate).toBe("2026-10-14");
    expect(e.note).toMatch(/room temperature/i);
    expect(estimateShelfLife("paneer", { now: NOW, location: "pantry" })!.days).toBe(0);
  });
  it("falls back to the default location when a location has no figure", () => {
    const e = estimateShelfLife("rice", { now: NOW, location: "fridge" })!;
    expect(e.locationFallback).toBe(true);
    expect(e.location).toBe("pantry");
    expect(e.confidence).not.toBe("high");
  });
  it("opened is never longer than unopened for sealed foods", () => {
    for (const name of ["milk", "curd", "butter", "cheddar cheese", "mayonnaise", "ketchup", "jam", "juice", "ice cream", "cooking oil"]) {
      const a = estimateShelfLife(name, { now: NOW })!;
      const b = estimateShelfLife(name, { now: NOW, opened: true })!;
      expect(b.days).toBeLessThanOrEqual(a.days);
    }
  });
  it("opened mayonnaise must be refrigerated", () => {
    const e = estimateShelfLife("mayonnaise", { now: NOW, opened: true })!;
    expect(e.location).toBe("fridge");
    const pantry = estimateShelfLife("mayonnaise", { now: NOW, opened: true, location: "pantry" })!;
    expect(pantry.days).toBe(0);
  });
  it("cooked variants of raw foods use the cooked figure", () => {
    expect(key("Cooked Chicken")).toBe("cooked_meat");
    expect(key("Grilled Chicken")).toBe("cooked_meat");
    expect(key("Fried Rice")).toBe("cooked_rice");
    expect(estimateShelfLife("cooked rice", { now: NOW })!.days).toBe(1);
    expect(key("Boiled Egg")).toBe("boiled_egg");
    expect(key("cooked fish")).toBe("cooked_fish");
    expect(key("Leftover Dal")).toBe("cooked_dal");
  });
  it("raw poultry, mince and fish are 1-2 days at most", () => {
    for (const n of ["chicken", "chicken mince", "minced beef", "fish", "prawns"]) {
      expect(estimateShelfLife(n, { now: NOW })!.days).toBeLessThanOrEqual(2);
    }
  });
});

describe("estimateShelfLife: output contract", () => {
  it("returns a well-formed estimate", () => {
    const e = estimateShelfLife("Amul Taaza Toned Milk 500ml", { now: NOW })!;
    expect(e.isEstimate).toBe(true);
    expect(e.category).toBe("Dairy");
    expect(e.location).toBe("fridge");
    expect(e.expiryDate).toBe(addDaysIso(NOW, e.days));
    expect(e.expiryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.note).toMatch(/^Estimate only/);
    expect(e.matchScore).toBeGreaterThan(0.5);
  });
  it("computes dates from the injected clock across month and year ends", () => {
    expect(addDaysIso(new Date("2026-12-30T23:00:00Z"), 5)).toBe("2027-01-04");
    expect(addDaysIso(new Date("2028-02-27T00:00:00Z"), 2)).toBe("2028-02-29");
    expect(addDaysIso(new Date("2026-10-14T00:00:00Z"), 0)).toBe("2026-10-14");
  });
  it("tolerates an invalid clock and is deterministic", () => {
    const bad = estimateShelfLife("milk", { now: new Date("garbage") })!;
    expect(bad.expiryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const a = JSON.stringify(estimateShelfLife("Paneer 200g", { now: NOW }));
    const b = JSON.stringify(estimateShelfLife("Paneer 200g", { now: NOW }));
    expect(a).toBe(b);
  });
  it("all string output is ASCII, no emoji", () => {
    const names = ["milk", "chicken", "frozen peas", "rice", "cooked rice", "mayonnaise", "paneer", "bread", "ice cream"];
    for (const n of names) {
      const e = estimateShelfLife(n, { now: NOW })!;
      expect(/[^\x20-\x7E]/.test(JSON.stringify(e))).toBe(false);
    }
  });
});

describe("estimateShelfLife: hostile input", () => {
  it("handles huge strings quickly", () => {
    const huge = "milk ".repeat(200_000);
    const t = Date.now();
    const e = estimateShelfLife(huge, { now: NOW });
    expect(Date.now() - t).toBeLessThan(1500);
    expect(e === null || typeof e.days === "number").toBe(true);
    expect(isFoodItem("x".repeat(1_000_000))).toBe(true);
  });
  it("handles unicode, emoji and control characters", () => {
    expect(key("\u{1F95B} Milk \u0000\u0007")).toBe("milk");
    expect(key("MILK​")).toBe("milk");
    expect(key("Café au lait")).toBeNull();
    expect(estimateShelfLife("\u4E2D\u6587", { now: NOW })).toBeNull();
    expect(estimateShelfLife("\u0000\u0001", { now: NOW })).toBeNull();
  });
  it("does not choke on prototype-ish strings or regex metacharacters", () => {
    for (const s of ["__proto__", "constructor", "toString", "(((", "[a-z]+*", "$1 \\ ^"]) {
      expect(() => estimateShelfLife(s, { now: NOW })).not.toThrow();
    }
  });
});

describe("isFoodItem / classifyFoodItem", () => {
  it("rejects non-food items", () => {
    for (const n of ["Detergent Powder 1kg", "Surf Excel Matic", "Carry Bag", "Delivery Fee", "Tissue Box", "Toilet Paper 4 Roll", "Dettol Handwash", "Dish Wash Liquid Lemon", "Shampoo", "Paper Towels", "Plastic Bag", "Handling Charge", "Dog Food 3kg", "Aluminium Foil", "Garbage Bags"]) {
      expect(isFoodItem(n), n).toBe(false);
      expect(estimateShelfLife(n, { now: NOW }), n).toBeNull();
    }
  });
  it("keeps food that contains non-food-looking words", () => {
    for (const n of ["Tea Bags 100", "Bagged Salad", "Sponge Cake", "Cotton Candy", "Cup Noodles", "Ice Cream Cup", "Total Greek Yogurt", "Pad Thai Noodles"]) {
      expect(isFoodItem(n), n).toBe(true);
    }
  });
  it("classifies unknown vs food", () => {
    expect(classifyFoodItem("milk")).toBe("food");
    expect(classifyFoodItem("Xyzzy")).toBe("unknown");
    expect(classifyFoodItem(null)).toBe("unknown");
    expect(isFoodItem("")).toBe(true);
  });
});
