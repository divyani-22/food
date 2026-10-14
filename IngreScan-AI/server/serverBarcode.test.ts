import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { decodeBarcodeFromImage } from "./lib/serverBarcode";

const fx = (name: string) => new Uint8Array(fs.readFileSync(path.resolve(__dirname, "../../e2e/fixtures", name)));

describe("decodeBarcodeFromImage (real fixture images)", () => {
  it("reads EAN-13 and UPC-A barcodes", () => {
    expect(decodeBarcodeFromImage(fx("ean13-valid.png"), "image/png")).toMatch(/^\d{13}$/);
    expect(decodeBarcodeFromImage(fx("upca-valid.png"), "image/png")).toMatch(/^\d{12}$/);
  });
  it("reads a rotated barcode and a barcode inside a product photo", () => {
    expect(decodeBarcodeFromImage(fx("ean13-rotated-90.png"), "image/png")).toMatch(/^\d{13}$/);
    expect(decodeBarcodeFromImage(fx("product-photo-with-barcode.png"), "image/png")).toMatch(/^\d{8,13}$/);
  });
  it("returns null for a label without a barcode, unsupported types and garbage", () => {
    expect(decodeBarcodeFromImage(fx("label-no-barcode.png"), "image/png")).toBeNull();
    expect(decodeBarcodeFromImage(fx("ean13-valid.png"), "image/webp")).toBeNull();
    expect(decodeBarcodeFromImage(new Uint8Array([1, 2, 3, 4]), "image/jpeg")).toBeNull();
    expect(decodeBarcodeFromImage(new Uint8Array(0), "image/png")).toBeNull();
  });
  it("reads the noisy/blurred fixture and rejects a wrong check digit", () => {
    expect(decodeBarcodeFromImage(fx("ean13-noisy-blurred.png"), "image/png")).toMatch(/^\d{13}$/);
    // ZXing validates the EAN check digit itself, so a misprinted/misread code is rejected instead of guessed.
    expect(decodeBarcodeFromImage(fx("ean13-bad-checksum.png"), "image/png")).toBeNull();
  });
  it("decodes the same code for the same image on repeated calls", () => {
    const a = decodeBarcodeFromImage(fx("ean13-valid.png"), "image/png");
    expect(decodeBarcodeFromImage(fx("ean13-valid.png"), "image/png")).toBe(a);
  });
});
