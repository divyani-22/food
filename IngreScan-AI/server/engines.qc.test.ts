import { describe, expect, it } from "vitest";
import {
  DEFAULT_QC_ACCEPTANCE,
  batchPhotosCsv,
  batchReportCsv,
  csvCell,
  gradePhoto,
  round1,
  summarizeBatch,
  toCsv,
  vendorScorecard,
  vendorScorecardCsv,
} from "../shared/engines/qcGrading";

const photo = (freshness_status: string, p_fresh: number, confidence: number, fruit = "apple") => ({
  freshness_status,
  p_fresh,
  confidence,
  fruit,
});
const many = (n: number, f: () => ReturnType<typeof photo>) => Array.from({ length: n }, f);
const A = () => photo("fresh", 95, 90);
const B = () => photo("normal", 60, 80);
const R = () => photo("rotten", 5, 90);
const V = () => photo("fresh", 90, 20);

describe("gradePhoto boundaries", () => {
  it("grade A needs fresh, p_fresh >= 80 and confidence >= 60", () => {
    expect(gradePhoto(photo("fresh", 80, 60)).grade).toBe("A");
    expect(gradePhoto(photo("fresh", 79.99, 60)).grade).toBe("B");
    expect(gradePhoto(photo("fresh", 80, 59.99)).grade).toBe("B");
    expect(gradePhoto(photo("fresh", 100, 100)).grade).toBe("A");
  });
  it("REJECT when p_fresh < 30 (30 itself is B)", () => {
    expect(gradePhoto(photo("normal", 29.99, 90)).grade).toBe("REJECT");
    expect(gradePhoto(photo("normal", 30, 90)).grade).toBe("B");
    expect(gradePhoto(photo("normal", 0, 90)).grade).toBe("REJECT");
  });
  it("REJECT when status is rotten, even with high p_fresh (flagged as conflict)", () => {
    const g = gradePhoto(photo("rotten", 95, 90));
    expect(g.grade).toBe("REJECT");
    expect(g.reasonCodes).toContain("status_conflict");
    expect(gradePhoto(photo("fresh", 10, 90)).reasonCodes).toContain("status_conflict");
  });
  it("REVIEW when confidence < 50 (50 itself is not REVIEW), even for rotten", () => {
    expect(gradePhoto(photo("fresh", 95, 49.99)).grade).toBe("REVIEW");
    expect(gradePhoto(photo("fresh", 95, 50)).grade).toBe("B");
    expect(gradePhoto(photo("rotten", 5, 10)).grade).toBe("REVIEW");
    expect(gradePhoto(photo("normal", 5, 0)).grade).toBe("REVIEW");
  });
  it("status normal is never A", () => {
    expect(gradePhoto(photo("normal", 100, 100)).grade).toBe("B");
  });
  it("is case and whitespace tolerant for status", () => {
    expect(gradePhoto(photo(" Fresh ", 90, 90)).grade).toBe("A");
    expect(gradePhoto(photo("ROTTEN", 90, 90)).grade).toBe("REJECT");
  });
  it("custom thresholds apply and inconsistent ones are repaired", () => {
    expect(gradePhoto(photo("fresh", 70, 55), { aMinPFresh: 70, aMinConfidence: 55 }).grade).toBe("A");
    expect(gradePhoto(photo("normal", 40, 90), { rejectBelowPFresh: 45 }).grade).toBe("REJECT");
    const g = gradePhoto(photo("normal", 85, 90), { rejectBelowPFresh: 99, aMinPFresh: 80 });
    expect(g.grade).toBe("B");
    expect(gradePhoto(photo("fresh", 90, 90), { aMinPFresh: Number.NaN, aMinConfidence: "x" as never }).grade).toBe("A");
  });
  it("explains every grade", () => {
    for (const p of [A(), B(), R(), V()]) {
      const g = gradePhoto(p);
      expect(g.reasons.length).toBeGreaterThan(0);
      expect(g.reasons.length).toBe(g.reasonCodes.length);
    }
  });
  it("hostile / malformed input becomes REVIEW, never throws", () => {
    const bad: unknown[] = [
      undefined, null, 5, "x", [], {},
      photo("fresh", Number.NaN, 90),
      photo("fresh", 90, Number.POSITIVE_INFINITY),
      photo("fresh", -1, 90),
      photo("fresh", 101, 90),
      photo("excellent", 90, 90),
      { freshness_status: "fresh", p_fresh: "90", confidence: 90 },
      { freshness_status: 1, p_fresh: 90, confidence: 90 },
    ];
    for (const b of bad) {
      const g = gradePhoto(b);
      expect(g.grade).toBe("REVIEW");
      expect(g.reasonCodes).toEqual(["invalid_input"]);
    }
  });
  it("normalises fruit names and ids safely", () => {
    const g = gradePhoto({ ...A(), fruit: "  Alphonso MANGO!! \u{1F96D}", photoId: "p\u0000-1" });
    expect(g.fruit).toBe("alphonso mango");
    expect(g.photoId).toBe("p -1");
    expect(gradePhoto({ ...A(), fruit: 123 as never }).fruit).toBe("unknown");
  });
  it("output is ASCII", () => {
    expect(/[^\x20-\x7E]/.test(JSON.stringify(gradePhoto(A())))).toBe(false);
  });
});

describe("summarizeBatch verdicts", () => {
  it("ACCEPT: 20 photos, all A", () => {
    const s = summarizeBatch(many(20, A), { vendor: "Farm Co", lotId: "L1" });
    expect(s.verdict).toBe("ACCEPT");
    expect(s.counts).toEqual({ A: 20, B: 0, REVIEW: 0, REJECT: 0 });
    expect(s.percentages.A).toBe(100);
    expect(s.percentages.AB).toBe(100);
    expect(s.vendor).toBe("Farm Co");
    expect(s.lotId).toBe("L1");
    expect(s.lowSample).toBe(false);
  });
  it("ACCEPT at exactly the limits: 5% reject, 10% review, 85% A/B is NOT enough (needs >= 90 A+B)", () => {
    // 100 photos: 5 reject + 10 review => A+B = 85 < 90 => not ACCEPT, review at limit => discount
    const s = summarizeBatch([...many(70, A), ...many(15, B), ...many(5, R), ...many(10, V)]);
    expect(s.percentages.AB).toBe(85);
    expect(s.verdict).toBe("ACCEPT_WITH_DISCOUNT");
  });
  it("ACCEPT boundary: 5% reject, 5% review, 90% A/B", () => {
    const s = summarizeBatch([...many(80, A), ...many(10, B), ...many(5, R), ...many(5, V)]);
    expect(s.percentages).toMatchObject({ AB: 90, REJECT: 5, REVIEW: 5 });
    expect(s.verdict).toBe("ACCEPT");
    expect(s.checks.every((c, i) => (i === 3 ? !c.passed : c.passed))).toBe(true);
  });
  it("just over 5% reject is not ACCEPT", () => {
    const s = summarizeBatch([...many(94, A), ...many(6, R)]);
    expect(s.verdict).toBe("ACCEPT_WITH_DISCOUNT");
    expect(s.verdictReason).toMatch(/reject_share_pct/);
  });
  it("REVIEW share over 10% means INSPECT", () => {
    const s = summarizeBatch([...many(88, A), ...many(12, V)]);
    expect(s.verdict).toBe("INSPECT");
    expect(s.verdictReason).toMatch(/Inspect manually/);
    const exactly = summarizeBatch([...many(90, A), ...many(10, V)]);
    expect(exactly.verdict).toBe("ACCEPT");
  });
  it("REJECT_LOT only when REJECT share is strictly above 20%", () => {
    expect(summarizeBatch([...many(80, A), ...many(20, R)]).verdict).toBe("ACCEPT_WITH_DISCOUNT");
    expect(summarizeBatch([...many(79, A), ...many(21, R)]).verdict).toBe("REJECT_LOT");
  });
  it("REJECT_LOT beats INSPECT when both apply", () => {
    expect(summarizeBatch([...many(50, A), ...many(25, R), ...many(25, V)]).verdict).toBe("REJECT_LOT");
  });
  it("empty and non-array batches are INSPECT with zeros, no NaN", () => {
    for (const input of [[], undefined, null, "x", {}]) {
      const s = summarizeBatch(input);
      expect(s.verdict).toBe("INSPECT");
      expect(s.totalPhotos).toBe(0);
      expect(s.pFresh).toBeNull();
      expect(s.rejectRateCi95).toBeNull();
      expect(s.percentages).toEqual({ A: 0, B: 0, REVIEW: 0, REJECT: 0, AB: 0 });
      expect(JSON.stringify(s)).not.toMatch(/NaN|Infinity/);
    }
  });
  it("malformed photos count as REVIEW and are reported", () => {
    const s = summarizeBatch([...many(18, A), null, { x: 1 }]);
    expect(s.counts.REVIEW).toBe(2);
    expect(s.invalidInputs).toBe(2);
    expect(s.warnings.join(" ")).toMatch(/malformed/);
    expect(s.verdict).toBe("ACCEPT");
  });
  it("custom acceptance rule is applied and echoed", () => {
    const s = summarizeBatch([...many(18, A), ...many(2, R)], { acceptance: { maxRejectPct: 10 } });
    expect(s.verdict).toBe("ACCEPT");
    expect(s.rule.acceptance.maxRejectPct).toBe(10);
    expect(s.rule.acceptance.minAbPct).toBe(DEFAULT_QC_ACCEPTANCE.minAbPct);
    expect(s.rule.description).toMatch(/10%/);
    const bad = summarizeBatch(many(20, A), { acceptance: { minAbPct: Number.NaN, maxRejectPct: 500 } });
    expect(bad.rule.acceptance.minAbPct).toBe(90);
    expect(bad.rule.acceptance.maxRejectPct).toBe(5);
  });
  it("echoes the numbers behind the decision", () => {
    const s = summarizeBatch([...many(80, A), ...many(10, B), ...many(5, R), ...many(5, V)]);
    expect(s.checks.map((c) => c.name)).toEqual(["ab_share_pct", "reject_share_pct", "review_share_pct", "reject_lot_share_pct"]);
    expect(s.checks[0]).toMatchObject({ actual: 90, op: ">=", limit: 90, passed: true });
    expect(s.rule.thresholds).toMatchObject({ aMinPFresh: 80, aMinConfidence: 60, rejectBelowPFresh: 30, reviewBelowConfidence: 50 });
  });
});

describe("summarizeBatch statistics", () => {
  it("small samples carry a statistical warning", () => {
    const s = summarizeBatch(many(19, A));
    expect(s.lowSample).toBe(true);
    expect(s.statisticalNote).toMatch(/not statistically representative/);
    expect(summarizeBatch(many(1, A)).statisticalNote).toMatch(/1 photo graded/);
    expect(summarizeBatch(many(20, A)).lowSample).toBe(false);
  });
  it("computes mean, median, min, max with one decimal", () => {
    const s = summarizeBatch([photo("fresh", 90, 90), photo("fresh", 85, 90), photo("normal", 40.25, 90), photo("normal", 41, 90)]);
    expect(s.pFresh).toEqual({ mean: 64.1, median: 63, min: 40.3, max: 90 });
  });
  it("median of odd and even counts", () => {
    expect(summarizeBatch([photo("fresh", 1, 90), photo("fresh", 2, 90), photo("fresh", 9, 90)]).pFresh!.median).toBe(2);
    expect(summarizeBatch([photo("fresh", 1, 90), photo("fresh", 2, 90)]).pFresh!.median).toBe(1.5);
  });
  it("per-fruit breakdown is sorted and complete", () => {
    const s = summarizeBatch([
      ...many(3, () => photo("fresh", 90, 90, "Mango")),
      ...many(1, () => photo("rotten", 10, 90, "mango")),
      ...many(2, () => photo("fresh", 85, 90, "banana")),
    ]);
    expect(s.perFruit.map((f) => [f.fruit, f.count])).toEqual([["mango", 4], ["banana", 2]]);
    expect(s.perFruit[0].counts).toEqual({ A: 3, B: 0, REVIEW: 0, REJECT: 1 });
    expect(s.perFruit[0].percentages.REJECT).toBe(25);
    expect(s.perFruit[0].meanPFresh).toBe(70);
  });
  it("prototype-like fruit names are harmless", () => {
    const s = summarizeBatch([photo("fresh", 90, 90, "__proto__"), photo("fresh", 90, 90, "constructor")]);
    expect(s.perFruit.map((f) => f.fruit).sort()).toEqual(["__proto__", "constructor"]);
  });
  it("Wilson interval is sensible", () => {
    const s = summarizeBatch([...many(90, A), ...many(10, R)]);
    const [lo, hi] = s.rejectRateCi95!;
    expect(lo).toBeLessThan(10);
    expect(hi).toBeGreaterThan(10);
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(100);
    expect(summarizeBatch(many(5, A)).rejectRateCi95![0]).toBe(0);
  });
  it("declared sample size mismatch is warned about", () => {
    expect(summarizeBatch(many(20, A), { sampleSize: 30 }).warnings.join(" ")).toMatch(/Declared sample size/);
    expect(summarizeBatch(many(20, A), { sampleSize: 20 }).warnings).toEqual([]);
  });
  it("rounding is consistent at one decimal", () => {
    expect(round1(2.25)).toBe(2.3);
    expect(round1(Number.NaN)).toBe(0);
    expect(round1(Number.POSITIVE_INFINITY)).toBe(0);
    expect(round1(-0.04)).toBe(0);
    const s = summarizeBatch([...many(1, A), ...many(2, B)]);
    expect(s.percentages.A).toBe(33.3);
    expect(s.percentages.B).toBe(66.7);
  });
  it("is deterministic and ASCII", () => {
    const input = [...many(30, A), ...many(5, B), ...many(2, R)];
    const a = JSON.stringify(summarizeBatch(input, { vendor: "V", lotId: "L", receivedAt: "2026-10-01" }));
    expect(a).toBe(JSON.stringify(summarizeBatch(input, { vendor: "V", lotId: "L", receivedAt: "2026-10-01" })));
    expect(/[^\x20-\x7E]/.test(a)).toBe(false);
  });
  it("handles a 100k batch quickly", () => {
    const t = Date.now();
    const s = summarizeBatch(many(100_000, A));
    expect(s.totalPhotos).toBe(100_000);
    expect(Date.now() - t).toBeLessThan(4000);
  });
  it("sanitises vendor, lot and date options", () => {
    const s = summarizeBatch(many(20, A), { vendor: "  Evil\u0000 =Vendor  ", lotId: 77 as never, receivedAt: "not a date" });
    expect(s.vendor).toBe("Evil =Vendor");
    expect(s.lotId).toBe("77");
    expect(s.receivedAt).toBeNull();
    expect(s.warnings.join(" ")).toMatch(/receivedAt/);
  });
});

describe("vendorScorecard", () => {
  const batch = (vendor: string, a: number, r: number, date?: string) =>
    summarizeBatch([...many(a, A), ...many(r, R)], { vendor, receivedAt: date });
  it("aggregates, ranks and detects trends", () => {
    const card = vendorScorecard([
      batch("Good Farm", 20, 0, "2026-01-01"),
      batch("Bad Farm", 15, 5, "2026-01-02"),
      batch("Good Farm", 19, 1, "2026-02-01"),
      batch("Improving", 10, 10, "2026-01-01"),
      batch("Improving", 15, 5, "2026-02-01"),
      batch("Improving", 20, 0, "2026-03-01"),
      batch("Bad Farm", 12, 8, "2026-02-02"),
    ]);
    expect(card.vendors.map((v) => v.vendor)).toEqual(["Good Farm", "Improving", "Bad Farm"]);
    expect(card.vendors.map((v) => v.rank)).toEqual([1, 2, 3]);
    const good = card.vendors[0];
    expect(good.batches).toBe(2);
    expect(good.totalPhotos).toBe(40);
    expect(good.rejectionRate).toBe(2.5);
    expect(good.avgAPct).toBe(97.5);
    expect(good.trend).toBe("insufficient_data");
    const imp = card.vendors[1];
    expect(imp.trend).toBe("improving");
    expect(imp.trendDeltaPts).toBe(50);
    expect(card.vendors[2].lotRejectRate).toBe(100);
    expect(card.rankingRule).toMatch(/rejection rate/);
  });
  it("declining and stable trends, ordered by date not input order", () => {
    const dec = vendorScorecard([
      batch("X", 5, 15, "2026-03-01"),
      batch("X", 20, 0, "2026-01-01"),
      batch("X", 12, 8, "2026-02-01"),
    ]);
    expect(dec.vendors[0].trend).toBe("declining");
    const stable = vendorScorecard([batch("Y", 18, 2), batch("Y", 18, 2), batch("Y", 18, 2)]);
    expect(stable.vendors[0].trend).toBe("stable");
  });
  it("groups vendor names case-insensitively and handles missing names", () => {
    const card = vendorScorecard([batch("ACME", 20, 0), batch("acme", 20, 0), summarizeBatch(many(20, A))]);
    expect(card.vendors.map((v) => v.vendor)).toEqual(["(unknown)", "ACME"]);
    expect(card.vendors.find((v) => v.vendor === "ACME")!.batches).toBe(2);
  });
  it("empty batches do not divide by zero and rank last", () => {
    const card = vendorScorecard([summarizeBatch([], { vendor: "Empty" }), batch("Real", 20, 0)]);
    expect(card.vendors.map((v) => v.vendor)).toEqual(["Real", "Empty"]);
    expect(card.vendors[1].rejectionRate).toBe(0);
    expect(JSON.stringify(card)).not.toMatch(/NaN|Infinity/);
  });
  it("ignores malformed records", () => {
    const card = vendorScorecard([null, 5, {}, { counts: { A: -1, B: 0, REVIEW: 0, REJECT: 0 } }, { vendor: "Z", counts: { A: 3, B: 0, REVIEW: 0, REJECT: 0 } }]);
    expect(card.vendors).toHaveLength(1);
    expect(card.warnings.join(" ")).toMatch(/malformed/);
    expect(vendorScorecard(undefined).vendors).toEqual([]);
    expect(vendorScorecard("x" as never).vendors).toEqual([]);
  });
  it("exports a scorecard CSV", () => {
    const csv = vendorScorecardCsv(vendorScorecard([batch("A", 20, 0)]));
    expect(csv.split("\r\n")[0]).toBe("rank,vendor,batches,graded_batches,total_photos,avg_a_pct,pooled_a_pct,pooled_ab_pct,rejection_rate_pct,review_rate_pct,lot_reject_rate_pct,trend,trend_delta_pts,last_verdict");
  });
});

describe("toCsv (RFC 4180 + formula injection)", () => {
  it("uses CRLF, a header row and stable column order", () => {
    expect(toCsv([{ b: 1, a: "x" }, { a: "y", c: true }])).toBe("b,a,c\r\n1,x,\r\n,y,true\r\n");
    expect(toCsv([{ b: 1, a: 2 }], ["a", "b"])).toBe("a,b\r\n2,1\r\n");
    expect(toCsv([], ["a", "b"])).toBe("a,b\r\n");
    expect(toCsv([])).toBe("");
    expect(toCsv(undefined)).toBe("");
  });
  it("quotes commas, quotes, CR and LF and doubles embedded quotes", () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("a\r\nb")).toBe('"a\r\nb"');
    expect(csvCell(" padded ")).toBe('" padded "');
    expect(csvCell("plain")).toBe("plain");
  });
  it("neutralises formula injection in strings", () => {
    for (const evil of ["=1+1", "+1+1", "-1+1", "@SUM(A1)", "\tcmd", "\rcmd", "=HYPERLINK(\"http://x\",\"y\")", " =1+1", "-5"]) {
      const out = csvCell(evil);
      const inner = out.startsWith('"') ? out.slice(1, -1) : out;
      expect(inner.startsWith("'"), evil).toBe(true);
    }
    expect(csvCell("=A1,B1")).toBe("\"'=A1,B1\"");
    expect(csvCell("safe=value")).toBe("safe=value");
    expect(csvCell("a-b")).toBe("a-b");
  });
  it("neutralises injection in header cells too", () => {
    expect(toCsv([{ "=evil": 1 }])).toBe("'=evil\r\n1\r\n");
  });
  it("writes typed numbers as-is, and NaN / Infinity as empty", () => {
    expect(toCsv([{ n: -5, m: 3.5, bad: Number.NaN, inf: Number.POSITIVE_INFINITY }])).toBe("n,m,bad,inf\r\n-5,3.5,,\r\n");
  });
  it("handles null, undefined, dates, objects and unserialisable values", () => {
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    const csv = toCsv([{ a: null, b: undefined, c: new Date("2026-10-14T00:00:00Z"), d: { x: 1 }, e: cyc, f: new Date("bad"), g: 10n }]);
    expect(csv).toBe('a,b,c,d,e,f,g\r\n,,2026-10-14T00:00:00.000Z,"{""x"":1}",,,10\r\n');
  });
  it("strips control characters and caps cell and column counts", () => {
    expect(csvCell("a\u0000b\u0007c")).toBe("abc");
    expect(csvCell("x".repeat(100_000)).length).toBe(32_000);
    const wide: Record<string, number> = {};
    for (let i = 0; i < 500; i++) wide[`c${i}`] = i;
    expect(toCsv([wide]).split("\r\n")[0].split(",").length).toBe(200);
  });
  it("ignores non-record rows and prototype keys", () => {
    expect(toCsv([1, null, "x", { a: 1 }])).toBe("a\r\n\r\n\r\n\r\n1\r\n".replace("\r\n\r\n\r\n\r\n", "\r\n\r\n\r\n\r\n"));
    expect(toCsv([{ a: 1 }], ["toString", "a"])).toBe("toString,a\r\n,1\r\n");
  });
  it("round-trips through a simple RFC 4180 parser", () => {
    const rows = [{ k: 'va"l,ue', n: "multi\nline", e: "" }, { k: "x", n: "y", e: "z" }];
    const csv = toCsv(rows);
    const parsed = parseCsv(csv);
    expect(parsed).toEqual([["k", "n", "e"], ['va"l,ue', "multi\nline", ""], ["x", "y", "z"]]);
  });
});

describe("batch reports", () => {
  const s = summarizeBatch([...many(80, A), ...many(10, B), ...many(5, R), ...many(5, V)], { vendor: "=Farm, Inc", lotId: "L-9" });
  it("batchReportCsv is a tidy, injection-safe table", () => {
    const csv = batchReportCsv(s);
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual(["vendor", "lot_id", "section", "metric", "value"]);
    expect(rows.every((r) => r.length === 5)).toBe(true);
    expect(rows[1][0]).toBe("'=Farm, Inc");
    expect(rows.find((r) => r[2] === "verdict" && r[3] === "verdict")![4]).toBe("ACCEPT");
    expect(rows.find((r) => r[2] === "counts" && r[3] === "A")![4]).toBe("80");
    expect(rows.some((r) => r[2] === "rule" && r[3] === "min_ab_pct" && r[4] === "90")).toBe(true);
    expect(/[^\x20-\x7E\r\n]/.test(csv)).toBe(false);
  });
  it("batchPhotosCsv has one row per photo", () => {
    const rows = parseCsv(batchPhotosCsv(s));
    expect(rows).toHaveLength(101);
    expect(rows[0]).toContain("grade");
    expect(rows[1]).toContain("A");
  });
  it("reports for an empty batch do not crash", () => {
    expect(() => batchReportCsv(summarizeBatch([]))).not.toThrow();
    expect(batchPhotosCsv(summarizeBatch([])).split("\r\n")[0]).toContain("photo_id");
  });
});

// Minimal RFC 4180 parser used only to verify the writer.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQ = false;
      } else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += ch;
  }
  return rows;
}
