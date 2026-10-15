import { afterEach, describe, expect, it, vi } from "vitest";
import { round1 } from "../client/src/lib/onDeviceMath";
import { checkBarcode, normalizeBarcodeInput } from "../client/src/lib/barcode";

describe("round1 is Python round(x, 1) on the exact binary value", () => {
  // Reference values produced by CPython 3: round(x, 1)
  const cases: Array<[number, number]> = [
    [12.35, 12.3],
    [0.35, 0.3],
    [0.45, 0.5],
    [0.15, 0.1],
    [0.05, 0.1],
    [0.95, 0.9],
    [7.35, 7.3],
    [33.35, 33.4],
    [66.65, 66.7],
    [12.45, 12.4],
    [12.25, 12.2], // exact tie, half to even
    [12.75, 12.8], // exact tie, half to even
    [99.96, 100],
    [0, 0],
  ];
  for (const [x, want] of cases) {
    it(`round1(${x}) = ${want}`, () => expect(round1(x)).toBe(want));
  }
});

describe("barcode input normalisation", () => {
  it("strips directional marks, zero-width joiners, BOM and soft hyphens pasted with a code", () => {
    const code = "4006381333931";
    for (const junk of ["‎", "‏", "‌", "‍", "⁠", "﻿", "­", "‪", "‬"]) {
      expect(normalizeBarcodeInput(`${junk}${code}${junk}`)).toBe(code);
      expect(checkBarcode(`${code.slice(0, 6)}${junk}${code.slice(6)}`).ok).toBe(true);
    }
  });
  it("treats unicode dashes like hyphens", () => {
    expect(normalizeBarcodeInput("4006381–333931")).toBe("4006381333931");
  });
});

describe("startLiveDecoding keeps scanning after a bad frame", () => {
  const g = globalThis as any;
  afterEach(() => {
    vi.useRealTimers();
    delete g.BarcodeDetector;
    delete g.document;
    vi.resetModules();
  });

  it("survives onCandidates throwing once", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    g.BarcodeDetector = class {
      static async getSupportedFormats() {
        return ["ean_13"];
      }
      async detect() {
        return [{ rawValue: "4006381333931", format: "ean_13" }];
      }
    };
    g.document = { createElement: () => ({ getContext: () => null }) };
    const { startLiveDecoding } = await import("../client/src/lib/barcodeDecode");
    const video = { readyState: 4, videoWidth: 640, videoHeight: 480 } as any;
    let calls = 0;
    const unhandled: unknown[] = [];
    const onRej = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onRej);
    const handle = await startLiveDecoding(
      video,
      () => {
        calls++;
        if (calls === 1) throw new Error("consumer blew up");
      },
      { intervalMs: 10 },
    );
    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(10);
    handle.stop();
    process.off("unhandledRejection", onRej);
    expect(calls).toBeGreaterThan(1);
    expect(unhandled).toHaveLength(0);
  });
});
