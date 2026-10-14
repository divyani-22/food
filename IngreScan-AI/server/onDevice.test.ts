import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE,
  buildPredictionResult,
  centerCropOffset,
  evaluateFreshness,
  pyRound,
  resizeCenterCrop,
  resizeDims,
  round1,
  softmax,
  toNormalizedTensor,
} from "../client/src/lib/onDeviceMath";

const FRUITS = ["apple", "banana", "bell_pepper", "carrot", "cucumber", "mango", "orange", "potato", "strawberry", "tomato"];

describe("softmax", () => {
  it("sums to one and is stable for huge logits", () => {
    const p = softmax([1000, 1001, 999]);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(p[1]).toBeGreaterThan(p[0]);
    expect(p.every(Number.isFinite)).toBe(true);
  });
  it("matches a hand computed value", () => {
    const p = softmax([0, Math.log(3)]);
    expect(p[0]).toBeCloseTo(0.25, 12);
    expect(p[1]).toBeCloseTo(0.75, 12);
  });
});

describe("rounding helpers", () => {
  it("round1 behaves like Python round(x, 1)", () => {
    expect(round1(12.25)).toBe(12.2); // tie -> even, like Python
    expect(round1(12.35)).toBe(12.4);
    expect(round1(99.96)).toBe(100);
    expect(round1(0.04)).toBe(0);
  });
  it("pyRound is half-to-even", () => {
    expect([0.5, 1.5, 2.5, 3.5, 2.4, 2.6].map(pyRound)).toEqual([0, 2, 2, 4, 2, 3]);
  });
});

describe("freshness rules (shared with fruit_info.py through fruitInfo.json)", () => {
  it("applies the 0.7 / 0.3 thresholds inclusively", () => {
    expect(evaluateFreshness(0.7).status).toBe("fresh");
    expect(evaluateFreshness(0.69999).status).toBe("normal");
    expect(evaluateFreshness(0.3).status).toBe("rotten");
    expect(evaluateFreshness(0.30001).status).toBe("normal");
    expect(evaluateFreshness(0.95)).toMatchObject({ status_kr: "Fresh", badge_color: "emerald" });
    expect(evaluateFreshness(0.05)).toMatchObject({ status_kr: "Rotten", badge_color: "rose" });
    expect(evaluateFreshness(0.5)).toMatchObject({ status_kr: "Normal", badge_color: "amber" });
  });
  it("knowledge covers every class and has no emoji or Hangul", () => {
    for (const f of FRUITS) expect(KNOWLEDGE.fruits[f]).toBeTruthy();
    expect(JSON.stringify(KNOWLEDGE)).not.toMatch(/[ᄀ-ᇿ가-힯\u{1F000}-\u{1FAFF}☀-➿]/u);
  });
});

describe("buildPredictionResult", () => {
  const meta = { fruit_names: FRUITS, fresh_index: 0 };
  const fruitLogits = (idx: number, margin = 8) => FRUITS.map((_, i) => (i === idx ? margin : 0));

  it("returns the server PredictionResult shape", () => {
    const r = buildPredictionResult(meta, fruitLogits(1), [4, -4]);
    expect(Object.keys(r).sort()).toEqual(
      [
        "badge_color", "confidence", "cooking_tips", "freshness_kr", "freshness_status", "fruit", "fruit_kr",
        "image_url", "p_fresh", "shelf_life_days", "status_message", "storage_tips", "top_candidates",
      ].sort(),
    );
    expect(r.fruit).toBe("banana");
    expect(r.fruit_kr).toBe("Banana");
    expect(r.freshness_status).toBe("fresh");
    expect(r.shelf_life_days).toBe(KNOWLEDGE.fruits.banana.shelf_life_days.fresh);
    expect(r.cooking_tips).toBe(KNOWLEDGE.fruits.banana.cooking_fresh);
    expect(r.image_url).toBe("");
    expect(r.top_candidates).toHaveLength(4);
    expect(r.top_candidates[0]).toMatchObject({ code: "banana", name_kr: "Banana" });
    expect(r.top_candidates[0].probability).toBeGreaterThanOrEqual(r.top_candidates[1].probability);
  });

  it("uses the fresh_index logit for p_fresh and maps rotten correctly", () => {
    const rotten = buildPredictionResult(meta, fruitLogits(0), [-3, 3]);
    expect(rotten.freshness_status).toBe("rotten");
    expect(rotten.p_fresh).toBeLessThan(30);
    expect(rotten.shelf_life_days).toBe(0);
    const mid = buildPredictionResult(meta, fruitLogits(9), [0.2, 0]);
    expect(mid.freshness_status).toBe("normal");
    expect(mid.p_fresh).toBeCloseTo(55, 0);
  });

  it("rounds percentages to one decimal", () => {
    const r = buildPredictionResult(meta, fruitLogits(2, 2), [0.3, -0.1]);
    for (const v of [r.confidence, r.p_fresh, ...r.top_candidates.map((c) => c.probability)]) {
      expect(Math.round(v * 10)).toBeCloseTo(v * 10, 6);
    }
  });

  it("keeps class order for equal probabilities (stable sort like Python)", () => {
    const r = buildPredictionResult(meta, FRUITS.map(() => 0), [0, 0]);
    expect(r.top_candidates.map((c) => c.code)).toEqual(FRUITS.slice(0, 4));
  });
});

describe("PIL-equivalent resize + center crop", () => {
  it("computes torchvision Resize dims and CenterCrop offsets", () => {
    expect(resizeDims(300, 200, 256)).toEqual([384, 256]);
    expect(resizeDims(200, 300, 256)).toEqual([256, 384]);
    expect(resizeDims(333, 777, 256)).toEqual([256, 597]);
    expect(resizeDims(256, 400, 256)).toEqual([256, 400]);
    expect(centerCropOffset(384, 224)).toBe(80);
    expect(centerCropOffset(597, 224)).toBe(186); // (597-224)/2 = 186.5 -> half to even
    expect(centerCropOffset(255, 224)).toBe(16); // 15.5 -> 16
  });

  function synth(w: number, h: number): Uint8ClampedArray {
    const a = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        a[o] = (x * 7 + y * 13 + ((x * y) % 31)) & 255;
        a[o + 1] = (x * 3 + y * 5 + 50 + (x ^ y)) & 255;
        a[o + 2] = (x * 11 + y * 2 + 100 + ((x * y) % 17)) & 255;
        a[o + 3] = 255;
      }
    }
    return a;
  }

  // Digests of PIL.Image.resize(BILINEAR) + center crop through torchvision (Pillow 12.3, torchvision 0.29).
  const PIL_SHA1: Array<[number, number, string]> = [
    [300, 200, "f87439b6254a99290fda39015a70d6300d549896"],
    [200, 300, "28ad53d78e50766b002532f15c6ab9df81dc41cc"],
    [256, 400, "822f3d27b2fc3239a63187470d7036306919b4c5"],
    [400, 256, "2b306db338eaa17cbfcb5ac423134cbe252b52e3"],
    [1000, 1000, "ddfda0f51a3093d73d08b777af2d9a95916f70c3"],
    [257, 255, "15b246f989171d37c1702f9aceb9c20d672a11db"],
    [3000, 2000, "54d859e64ab7a78a3ed123da36379c4c64cd7d5f"],
    [2000, 3000, "6552481c58ba2508524bb0feea7c64049d741526"],
    [333, 777, "500cfcb500e48e6c2e106bf25dedf0964fcc022f"],
    [256, 256, "47e1c1942f7cbb42259d92136d70ab43b25955a4"],
    [100, 60, "c97b12435528e33a02fc31158140965aad74ec72"],
  ];

  for (const [w, h, sha] of PIL_SHA1) {
    it(`is bit-identical to PIL for ${w}x${h}`, () => {
      const px = synth(w, h);
      // Deliver rows in awkward bands to exercise the streaming path.
      const { rgb } = resizeCenterCrop(w, h, (y0, n) => px.subarray(y0 * w * 4, (y0 + n) * w * 4), 256, 224, 37);
      expect(createHash("sha1").update(rgb).digest("hex")).toBe(sha);
    });
  }

  it("normalises like ToTensor + Normalize in NCHW order", () => {
    const rgb = new Uint8Array([0, 128, 255, 255, 0, 128]); // two pixels
    const t = toNormalizedTensor(rgb, 2, 1, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]);
    expect(t).toHaveLength(6);
    expect(t[0]).toBeCloseTo((0 - 0.485) / 0.229, 5); // R of pixel 0
    expect(t[1]).toBeCloseTo((1 - 0.485) / 0.229, 5); // R of pixel 1
    expect(t[2]).toBeCloseTo((128 / 255 - 0.456) / 0.224, 5); // G of pixel 0
    expect(t[5]).toBeCloseTo((128 / 255 - 0.406) / 0.225, 5); // B of pixel 1
  });
});
