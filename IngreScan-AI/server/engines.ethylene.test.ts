import { describe, it, expect } from "vitest";
import {
  analyzeEthyleneStorage,
  ethyleneProfile,
  canonicalProduceKey,
  ETHYLENE_TABLE,
} from "../shared/engines/ethylene";

const FRESHGUARD = ["apple", "banana", "bell_pepper", "carrot", "cucumber", "mango", "orange", "potato", "strawberry", "tomato"];

function assertClean(value: unknown) {
  const json = JSON.stringify(value);
  // eslint-disable-next-line no-control-regex
  expect(json).toMatch(/^[\x20-\x7e]*$/);
  expect(json).not.toMatch(/\d\s?%/);
}

describe("ethylene knowledge table", () => {
  it("covers all 10 FreshGuard classes", () => {
    for (const k of FRESHGUARD) {
      const p = ETHYLENE_TABLE.find((e) => e.key === k);
      expect(p, k).toBeDefined();
      expect(p!.source).toContain("UC Davis");
    }
  });

  it("covers common grocery produce", () => {
    for (const n of ["spinach", "kale", "lettuce", "broccoli", "cauliflower", "cabbage", "kiwi", "avocado", "pear", "peach", "plum", "melon", "grapes", "lemon", "lime", "onion", "garlic", "sweet potato", "blueberries", "zucchini", "asparagus"]) {
      expect(ethyleneProfile(n), n).not.toBeNull();
    }
  });

  it("rates ripening-dependent fruit and key producers", () => {
    expect(ethyleneProfile("apple")!.production).toBe("high");
    expect(ethyleneProfile("banana")!.ripeningDependent).toBe(true);
    expect(ethyleneProfile("avocado")!.ripeningDependent).toBe(true);
    expect(ethyleneProfile("tomato")!.ripeningDependent).toBe(true);
    expect(ethyleneProfile("spinach")!.sensitivity).toBe("high");
    expect(ethyleneProfile("carrot")!.damage).toContain("bitter");
  });

  it("does not make claims with numeric percentages", () => {
    assertClean(ETHYLENE_TABLE);
  });
});

describe("name matching", () => {
  it.each([
    ["Apples", "apple"],
    ["APPLE", "apple"],
    ["Capsicum", "bell_pepper"],
    ["red bell peppers", "bell_pepper"],
    ["Aubergine", "eggplant"],
    ["Brinjal", "eggplant"],
    ["Courgettes", "zucchini"],
    ["tomatoes", "tomato"],
    ["Tomatoe", "tomato"],
    ["bananna", "banana"],
    ["Organic Baby Spinach 200g", "spinach"],
    ["Palak", "spinach"],
    ["strawberries", "strawberry"],
    ["Cherry Tomatoes", "tomato"],
    ["limes", "lemon_lime"],
    ["Sweet lime", "orange"],
    ["kiwi fruit", "kiwi"],
    ["Mangoes", "mango"],
    ["  grapes!!  ", "grape"],
  ])("%s -> %s", (input, key) => {
    expect(canonicalProduceKey(input)).toBe(key);
  });

  it("returns null for unknown, empty and processed items", () => {
    for (const n of ["", "   ", "milk", "bread", "apple juice", "tomato ketchup", "potato chips", "123", "pepper"]) {
      expect(canonicalProduceKey(n), n).toBeNull();
    }
  });

  it("is safe with hostile input", () => {
    for (const n of ["__proto__", "constructor", "toString", "hasOwnProperty", "prototype", "\u{1F34E}", "\u82F9\u679C", "a".repeat(100_000)]) {
      expect(() => ethyleneProfile(n)).not.toThrow();
    }
    expect(ethyleneProfile("__proto__")).toBeNull();
    expect(ethyleneProfile("constructor")).toBeNull();
    expect(ethyleneProfile("\u{1F34E}")).toBeNull();
    expect(ethyleneProfile("a".repeat(100_000))).toBeNull();
    expect(ethyleneProfile(("apple ").repeat(5000))!.key).toBe("apple");
    expect(ethyleneProfile(undefined as unknown as string)).toBeNull();
    expect(ethyleneProfile(42 as unknown as string)).toBeNull();
  });

  it("does not treat prototype keys as produce in analysis", () => {
    const out = analyzeEthyleneStorage([{ name: "__proto__" }, { name: "constructor" }, { name: "apple" }]);
    expect(out).toEqual([]);
  });
});

describe("analyzeEthyleneStorage", () => {
  it("warns for apple stored with spinach (default fridge)", () => {
    const alerts = analyzeEthyleneStorage([{ name: "Apples" }, { name: "Spinach" }]);
    expect(alerts).toHaveLength(1);
    const a = alerts[0];
    expect(a.severity).toBe("warning");
    expect(a.kind).toBe("damage");
    expect(a.storageLocation).toBe("fridge");
    expect(a.producer.key).toBe("apple");
    expect(a.sensitive.key).toBe("spinach");
    expect(a.advice).toMatch(/apart|different drawer/i);
    expect(a.damage).toMatch(/yellow/i);
    assertClean(alerts);
  });

  it("warns for banana + broccoli and mentions yellowing", () => {
    const [a] = analyzeEthyleneStorage([{ name: "banana", storageLocation: "pantry" }, { name: "broccoli", storageLocation: "pantry" }]);
    expect(a.severity).toBe("warning");
    expect(a.storageLocation).toBe("pantry");
    expect(a.damage).toMatch(/yellow/i);
  });

  it("flags carrots near apples with bitterness", () => {
    const [a] = analyzeEthyleneStorage([{ name: "carrots" }, { name: "apple" }]);
    expect(a.sensitive.key).toBe("carrot");
    expect(a.damage).toMatch(/bitter/i);
  });

  it("uses synonyms (capsicum, aubergine) and cucumber damage", () => {
    const alerts = analyzeEthyleneStorage([{ name: "Capsicum" }, { name: "apple" }, { name: "cucumber" }]);
    const keys = alerts.map((a) => a.sensitive.key).sort();
    expect(keys).toEqual(["bell_pepper", "cucumber"]);
  });

  it("only pairs items in the same storage space", () => {
    expect(analyzeEthyleneStorage([{ name: "apple", storageLocation: "pantry" }, { name: "spinach", storageLocation: "fridge" }])).toEqual([]);
  });

  it("ignores the freezer entirely", () => {
    expect(analyzeEthyleneStorage([{ name: "apple", storageLocation: "freezer" }, { name: "spinach", storageLocation: "freezer" }])).toEqual([]);
  });

  it("treats unknown storage locations as fridge", () => {
    const [a] = analyzeEthyleneStorage([{ name: "apple", storageLocation: "garage" }, { name: "lettuce", storageLocation: null }]);
    expect(a.storageLocation).toBe("fridge");
  });

  it("never raises a potato alert (mixed evidence)", () => {
    expect(analyzeEthyleneStorage([{ name: "apple" }, { name: "potatoes" }])).toEqual([]);
    expect(analyzeEthyleneStorage([{ name: "banana" }, { name: "potato" }])).toEqual([]);
    expect(ethyleneProfile("potato")!.mixedEvidence).toBe(true);
  });

  it("gives one ripening alert for banana + avocado with the paper-bag option", () => {
    const alerts = analyzeEthyleneStorage([{ name: "banana" }, { name: "avocado" }]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("ripening");
    expect(alerts[0].severity).toBe("info");
    expect(alerts[0].advice).toMatch(/paper bag/i);
  });

  it("mentions deliberate ripening on the counter", () => {
    const [a] = analyzeEthyleneStorage([{ name: "banana", storageLocation: "pantry" }, { name: "avocado", storageLocation: "pantry" }]);
    expect(a.advice).toMatch(/paper bag/i);
  });

  it("does not alert on low-sensitivity or non-producing items", () => {
    expect(analyzeEthyleneStorage([{ name: "orange" }, { name: "strawberries" }, { name: "onion" }, { name: "garlic" }])).toEqual([]);
    expect(analyzeEthyleneStorage([{ name: "apple" }, { name: "strawberry" }, { name: "orange" }])).toEqual([]);
  });

  it("deduplicates repeated items and mentions urgency", () => {
    const alerts = analyzeEthyleneStorage([
      { name: "apple" }, { name: "apples" }, { name: "Spinach", daysLeft: 1 }, { name: "spinach", daysLeft: 6 },
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].advice).toMatch(/use it soon/);
  });

  it("handles empty and invalid inputs", () => {
    expect(analyzeEthyleneStorage([])).toEqual([]);
    expect(analyzeEthyleneStorage(null as unknown as [])).toEqual([]);
    expect(analyzeEthyleneStorage([null, undefined, 5, {}, { name: 7 }] as unknown as [])).toEqual([]);
  });

  it("sorts warnings before info and is deterministic regardless of order", () => {
    const items = [{ name: "banana" }, { name: "avocado" }, { name: "apple" }, { name: "lettuce" }, { name: "kiwi" }, { name: "cucumber" }];
    const a = analyzeEthyleneStorage(items);
    const b = analyzeEthyleneStorage([...items].reverse());
    expect(a).toEqual(b);
    expect(a).toEqual(analyzeEthyleneStorage(items));
    const firstInfo = a.findIndex((x) => x.severity === "info");
    if (firstInfo >= 0) expect(a.slice(firstInfo).every((x) => x.severity === "info")).toBe(true);
    expect(a.length).toBeGreaterThan(2);
    assertClean(a);
  });

  it("handles a huge list and long names", () => {
    const items = Array.from({ length: 2000 }, (_, i) => ({ name: i % 2 ? "apple" : "x".repeat(5000) + i }));
    expect(() => analyzeEthyleneStorage(items)).not.toThrow();
  });

  it("output never has emoji or non-ASCII even for unicode names", () => {
    const alerts = analyzeEthyleneStorage([{ name: "Apple \u{1F34E}" }, { name: "Spinach \u82F9" }]);
    expect(alerts.length).toBe(1);
    assertClean(alerts);
  });
});
