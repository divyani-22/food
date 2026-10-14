import { describe, expect, it } from "vitest";
import {
  checkBarcode,
  compressToUpcE,
  expandUpcE,
  gs1CheckDigit,
  liveBarcodeFeedback,
  normalizeBarcodeInput,
  pickBestCandidate,
  toBarcodeFormat,
} from "../client/src/lib/barcode";

describe("normalizeBarcodeInput", () => {
  it("strips spaces, hyphens and invisible characters", () => {
    expect(normalizeBarcodeInput(" 4006 3813-33931​ ")).toBe("4006381333931");
  });
});

describe("gs1CheckDigit", () => {
  it("matches published examples", () => {
    expect(gs1CheckDigit("400638133393")).toBe(1);
    expect(gs1CheckDigit("03600029145")).toBe(2);
    expect(gs1CheckDigit("9638507")).toBe(4);
  });
});

describe("checkBarcode valid codes", () => {
  it("accepts EAN-13 and keeps it for lookup", () => {
    const r = checkBarcode("4006381333931");
    expect(r).toMatchObject({ ok: true, format: "ean_13", lookupCode: "4006381333931" });
  });
  it("accepts real-world EAN-13 codes used in the app", () => {
    for (const c of ["3017620422003", "5449000000996", "8901030895470"]) {
      expect(checkBarcode(c).ok, c).toBe(true);
    }
  });
  it("accepts EAN-8 and keeps 8 digits for lookup", () => {
    expect(checkBarcode("96385074")).toMatchObject({ ok: true, format: "ean_8", lookupCode: "96385074" });
  });
  it("pads UPC-A to EAN-13 for lookup", () => {
    expect(checkBarcode("036000291452")).toMatchObject({ ok: true, format: "upc_a", code: "036000291452", lookupCode: "0036000291452" });
    expect(checkBarcode("737628064502")).toMatchObject({ ok: true, lookupCode: "0737628064502" });
  });
  it("expands UPC-E to UPC-A and pads to 13 digits", () => {
    expect(expandUpcE("04252614")).toBe("042100005264");
    expect(checkBarcode("04252614", "upc_e")).toMatchObject({ ok: true, format: "upc_e", lookupCode: "0042100005264" });
  });
  it("accepts input with spaces/hyphens", () => {
    expect(checkBarcode("400 6381-333931")).toMatchObject({ ok: true, code: "4006381333931" });
  });
});

describe("UPC-E expansion covers every suppression pattern", () => {
  it("expands each last-digit rule to the documented UPC-A layout", () => {
    expect(expandUpcE("01234505")).toBe("012000003455");
    expect(expandUpcE("01234515")).toBe("012100003455");
    expect(expandUpcE("01234525")).toBe("012200003455");
    expect(expandUpcE("01234535")).toBe("012300000455");
    expect(expandUpcE("01234545")).toBe("012340000055");
    expect(expandUpcE("01234555")).toBe("012345000055");
    expect(expandUpcE("01234595")).toBe("012345000095");
  });
  it("round-trips UPC-A to UPC-E and back for generated valid codes", () => {
    let tested = 0;
    for (const e of ["01234505", "01234515", "01234525", "01234535", "01234545", "01234555", "01234595", "04252614"]) {
      const a = expandUpcE(e)!;
      expect(compressToUpcE(a), a).toBe(e);
      tested++;
    }
    expect(tested).toBe(8);
  });
  it("rejects non UPC-E number systems and wrong lengths", () => {
    expect(expandUpcE("24252614")).toBeNull();
    expect(expandUpcE("1234")).toBeNull();
  });
});

describe("checkBarcode rejections", () => {
  it("empty", () => {
    expect(checkBarcode("   ")).toMatchObject({ ok: false, reason: "empty" });
  });
  it("non numeric", () => {
    expect(checkBarcode("40063813A3931")).toMatchObject({ ok: false, reason: "non_numeric" });
    expect(checkBarcode("abc")).toMatchObject({ ok: false, reason: "non_numeric" });
  });
  it("wrong length with the count in the message", () => {
    const r = checkBarcode("12345");
    expect(r).toMatchObject({ ok: false, reason: "bad_length" });
    expect(r.ok === false && r.message).toContain("5");
    expect(checkBarcode("40063813339311")).toMatchObject({ ok: false, reason: "bad_length" });
  });
  it("bad checksum reports the expected digit", () => {
    expect(checkBarcode("4006381333932")).toMatchObject({ ok: false, reason: "bad_checksum", format: "ean_13", expectedCheckDigit: 1 });
    expect(checkBarcode("036000291453")).toMatchObject({ ok: false, reason: "bad_checksum", format: "upc_a", expectedCheckDigit: 2 });
    expect(checkBarcode("96385075")).toMatchObject({ ok: false, reason: "bad_checksum", expectedCheckDigit: 4 });
  });
});

describe("8-digit ambiguity EAN-8 vs UPC-E", () => {
  it("honours the decoder hint when both interpretations are valid", () => {
    // find a code valid as both
    let found: string | null = null;
    for (let n = 0; n < 200000 && !found; n++) {
      const body = "0" + String(n).padStart(6, "0");
      const code = body + gs1CheckDigit(body);
      const ex = expandUpcE(code);
      if (ex && /^\d{12}$/.test(ex) && ex[11] === code[7] && gs1CheckDigit(ex.slice(0, 11)) === Number(code[7])) found = code;
    }
    expect(found).not.toBeNull();
    expect(checkBarcode(found!, "upc_e")).toMatchObject({ ok: true, format: "upc_e" });
    expect(checkBarcode(found!, "ean_8")).toMatchObject({ ok: true, format: "ean_8" });
  });
});

describe("liveBarcodeFeedback", () => {
  it("is quiet while incomplete, then validates", () => {
    expect(liveBarcodeFeedback("")).toEqual({ state: "empty" });
    expect(liveBarcodeFeedback("4006")).toMatchObject({ state: "incomplete" });
    expect(liveBarcodeFeedback("400638133393")).toMatchObject({ state: "invalid" }); // 12 digits, bad UPC-A check
    expect(liveBarcodeFeedback("4006381333931")).toMatchObject({ state: "valid" });
    expect(liveBarcodeFeedback("4006381333932")).toMatchObject({ state: "invalid" });
    expect(liveBarcodeFeedback("40063813339311")).toMatchObject({ state: "invalid" });
    expect(liveBarcodeFeedback("12ab")).toMatchObject({ state: "invalid" });
  });
});

describe("pickBestCandidate", () => {
  it("prefers a valid candidate over an earlier invalid one", () => {
    const best = pickBestCandidate([
      { rawValue: "4006381333932", format: "ean_13" },
      { rawValue: "3017620422003", format: "EAN_13" },
    ]);
    expect(best?.check).toMatchObject({ ok: true, code: "3017620422003" });
  });
  it("returns the first invalid candidate so it can be surfaced", () => {
    const best = pickBestCandidate([{ rawValue: "4006381333932", format: "ean_13" }]);
    expect(best?.check).toMatchObject({ ok: false, reason: "bad_checksum" });
  });
  it("returns null for nothing decoded", () => {
    expect(pickBestCandidate([])).toBeNull();
    expect(pickBestCandidate([{ rawValue: "" }])).toBeNull();
  });
  it("maps decoder format names", () => {
    expect(toBarcodeFormat("EAN_13")).toBe("ean_13");
    expect(toBarcodeFormat("upc_e")).toBe("upc_e");
    expect(toBarcodeFormat("UPC_A")).toBe("upc_a");
    expect(toBarcodeFormat("qr_code")).toBeUndefined();
  });
});
