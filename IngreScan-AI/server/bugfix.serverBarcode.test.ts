import { describe, expect, it, vi } from "vitest";
import pngjs from "pngjs";
import { decodeBarcodeFromImage } from "./lib/serverBarcode";

function pngHeader(width: number, height: number): Uint8Array {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  b[24] = 8; // bit depth
  b[25] = 6; // RGBA
  return b;
}

describe("decompression-bomb guard", () => {
  it("rejects an oversized PNG from its header, before allocating the pixel buffer", () => {
    const spy = vi.spyOn(pngjs.PNG.sync, "read");
    expect(decodeBarcodeFromImage(pngHeader(30_000, 30_000), "image/png")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
