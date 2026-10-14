import { describe, expect, it } from "vitest";
import {
  describeDays,
  escapeWa,
  expiryStatus,
  helpMessage,
  linkGuidance,
  marker,
  packagedReport,
  pantryPage,
  produceReport,
  reminderTemplateVariable,
  reminderText,
  sortPantry,
  splitMessage,
} from "./format";

const EMOJI = new RegExp("\\p{Extended_Pictographic}", "u");

describe("escapeWa", () => {
  it("neutralises WhatsApp formatting characters", () => {
    const out = escapeWa("*bold* _it_ ~st~ `code`");
    expect(out).not.toMatch(/[*_~`]/);
    expect(out.length).toBe("*bold* _it_ ~st~ `code`".length);
  });
  it("strips newlines/control chars and caps length", () => {
    expect(escapeWa("a\nb\r\nc\u0000d")).toBe("a b cd");
    const long = escapeWa("x".repeat(200));
    expect(long.length).toBe(60);
    expect(long.endsWith("...")).toBe(true);
  });
  it("leaves normal text untouched", () => {
    expect(escapeWa("Whole milk 1L")).toBe("Whole milk 1L");
  });
});

describe("splitMessage", () => {
  it("returns short text unchanged", () => {
    expect(splitMessage("hi")).toEqual(["hi"]);
  });
  it("splits at line boundaries into <= 4000 chars and loses nothing", () => {
    const lines = Array.from({ length: 600 }, (_, i) => `${i + 1}. item number ${i + 1} - tomorrow - EXPIRING SOON`);
    const text = lines.join("\n");
    const chunks = splitMessage(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(4000);
    expect(chunks.join("\n")).toBe(text);
    for (const c of chunks) for (const l of c.split("\n")) expect(lines).toContain(l);
  });
  it("hard-splits a single oversized line, preferring spaces", () => {
    const text = ("word ".repeat(2000)).trim();
    const chunks = splitMessage(text, 100);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(100);
    expect(chunks.join(" ")).toBe(text);
    const solid = splitMessage("x".repeat(250), 100);
    expect(solid.map((c) => c.length)).toEqual([100, 100, 50]);
  });
});

describe("report text (snapshot-style, stable)", () => {
  it("produce report", () => {
    expect(
      produceReport({ fruit: "Banana", confidence: 92.4, freshnessStatus: "fresh", shelfLifeDays: 5, storageTip: "Keep at room temperature." }),
    ).toBe(
      [
        "*INSPECTION REPORT*",
        "Item: Banana",
        "Confidence: 92%",
        "Status: FRESH",
        "Estimated shelf life: 5 days",
        "Storage tip: Keep at room temperature.",
        "",
        "Reply ADD to save this item to your pantry.",
      ].join("\n"),
    );
  });
  it("singular day and normal status", () => {
    const r = produceReport({ fruit: "Mango", confidence: 70, freshnessStatus: "normal", shelfLifeDays: 1 });
    expect(r).toContain("Status: OK - USE SOON");
    expect(r).toContain("Estimated shelf life: 1 day\n");
  });
  it("packaged report", () => {
    expect(
      packagedReport({
        productName: "Instant Noodles",
        riskScore: 58.4,
        highRiskAdditives: ["E621 monosodium glutamate"],
        allergens: ["gluten", "soy"],
        personalAlerts: ["High sodium for your blood pressure profile"],
        healthierAlternative: { name: "Brown rice noodles", riskScore: 21 },
      }),
    ).toBe(
      [
        "*PRODUCT RISK REPORT*",
        "Product: Instant Noodles",
        "Risk score: 58/100 - MODERATE",
        "",
        "*High-risk additives*",
        "- E621 monosodium glutamate",
        "Allergens: gluten, soy",
        "",
        "*Alerts for you*",
        "- High sodium for your blood pressure profile",
        "",
        "Healthier option: Brown rice noodles - risk 21/100",
        "",
        "This is general information, not medical advice.",
      ].join("\n"),
    );
  });
  it("clamps odd scores and handles empty lists", () => {
    const r = packagedReport({ productName: "X", riskScore: 400, highRiskAdditives: [], allergens: [], personalAlerts: [] });
    expect(r).toContain("Risk score: 100/100 - HIGH");
    expect(r).toContain("High-risk additives: none found");
    expect(r).toContain("Allergens: none flagged");
  });
});

describe("pantry formatting", () => {
  it("describeDays and expiryStatus", () => {
    expect([-3, -1, 0, 1, 2, 9].map(describeDays)).toEqual(["expired 3 days ago", "expired yesterday", "today", "tomorrow", "in 2 days", "in 9 days"]);
    expect([-1, 0, 2, 3, null].map((d) => expiryStatus(d))).toEqual(["EXPIRED", "EXPIRING SOON", "EXPIRING SOON", "FRESH", "NO DATE"]);
  });
  it("sorts by urgency", () => {
    const rows = sortPantry(
      [
        { id: "1", name: "B", kind: "produce", expiryDate: "2026-10-20" },
        { id: "2", name: "A", kind: "produce", expiryDate: null },
        { id: "3", name: "C", kind: "produce", expiryDate: "2026-10-10" },
        { id: "4", name: "D", kind: "packaged", expiryDate: "2026-10-14" },
      ],
      "2026-10-14",
    );
    expect(rows.map((r) => r.item.id)).toEqual(["3", "4", "1", "2"]);
  });
  it("clamps out-of-range pages", () => {
    const rows = sortPantry([{ id: "1", name: "A", kind: "produce", expiryDate: "2026-10-15" }], "2026-10-14");
    expect(pantryPage(rows, 99, 5).page).toBe(1);
    expect(pantryPage(rows, -4, 5).page).toBe(1);
  });
  it("keeps a huge pantry page well under the message limit", () => {
    const items = Array.from({ length: 8 }, (_, i) => ({ id: String(i), name: "n".repeat(200), kind: "produce" as const, expiryDate: "2026-10-15" }));
    const page = pantryPage(sortPantry(items, "2026-10-14"), 1, 8);
    expect(page.text.length).toBeLessThan(1500);
  });
});

describe("reminder text", () => {
  const items = [
    { name: "Spinach", daysLeft: 0 },
    { name: "Milk", daysLeft: 1 },
    { name: "Eggs", daysLeft: 2 },
  ];
  it("lists names with today/tomorrow/in N days and the COOK hint", () => {
    const t = reminderText(items);
    expect(t).toContain("- Spinach: today");
    expect(t).toContain("- Milk: tomorrow");
    expect(t).toContain("- Eggs: in 2 days");
    expect(t).toContain("Reply COOK for a recipe.");
    expect(t).toContain("Reply STOP");
  });
  it("template variable is one line without forbidden whitespace", () => {
    const v = reminderTemplateVariable([...items, ...Array.from({ length: 6 }, (_, i) => ({ name: `Item\n${i}`, daysLeft: 1 }))]);
    expect(v).not.toMatch(/[\n\t]/);
    expect(v).not.toMatch(/ {4}/);
    expect(v).toContain("Spinach (today), Milk (tomorrow), Eggs (in 2 days)");
    expect(v).toContain("and 4 more");
  });
});

describe("no emoji by default", () => {
  it("static texts and builders", () => {
    const all = [
      helpMessage(true, "https://x.test"),
      helpMessage(false, "https://x.test"),
      linkGuidance("https://x.test"),
      produceReport({ fruit: "A", confidence: 80, freshnessStatus: "rotten", shelfLifeDays: 0 }),
      reminderText([{ name: "A", daysLeft: 0 }]),
      marker("ok"),
    ].join("\n");
    expect(all).not.toMatch(EMOJI);
  });
  it("source files contain no literal emoji", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = __dirname;
    const files: string[] = [];
    const walk = (d: string) =>
      fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.join(d, e.name))));
    walk(dir);
    expect(files.length).toBeGreaterThan(10);
    for (const f of files.filter((x) => x.endsWith(".ts") && !x.endsWith("format.test.ts"))) {
      expect(fs.readFileSync(f, "utf8"), f).not.toMatch(EMOJI);
    }
  });
  it("markers are opt-in and table-driven", () => {
    expect(marker("ok", { useEmoji: true })).toMatch(EMOJI);
    expect(marker("bad", { useEmoji: true })).not.toBe(marker("ok", { useEmoji: true }));
    expect(marker("ok", { useEmoji: false })).toBe("");
    expect(produceReport({ fruit: "A", confidence: 80, freshnessStatus: "fresh", shelfLifeDays: 2 }, { useEmoji: true })).toMatch(EMOJI);
  });
});
