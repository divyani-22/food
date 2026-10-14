/**
 * Server-side barcode decoding for images received outside the web UI (WhatsApp photos).
 * Pure JS: jpeg-js / pngjs decode the pixels, @zxing/library finds the barcode.
 * Supports JPEG and PNG (WhatsApp sends JPEG). WebP is not decoded here and returns null.
 */
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from "@zxing/library";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

const MAX_PIXELS = 24_000_000; // refuse decompression bombs (about 6000 x 4000)

interface Gray {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

function decodePixels(bytes: Uint8Array, contentType: string): Gray | null {
  const buf = Buffer.from(bytes);
  let width = 0;
  let height = 0;
  let rgba: Uint8Array | Buffer;
  try {
    if (/jpe?g/i.test(contentType)) {
      const img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 256, formatAsRGBA: true });
      width = img.width;
      height = img.height;
      rgba = img.data;
    } else if (/png/i.test(contentType)) {
      const img = PNG.sync.read(buf);
      width = img.width;
      height = img.height;
      rgba = img.data;
    } else {
      return null;
    }
  } catch {
    return null;
  }
  if (!width || !height || width * height > MAX_PIXELS) return null;
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    const a = rgba[p + 3] / 255;
    // composite on white, then ITU-R BT.601 luma
    const r = rgba[p] * a + 255 * (1 - a);
    const g = rgba[p + 1] * a + 255 * (1 - a);
    const b = rgba[p + 2] * a + 255 * (1 - a);
    gray[i] = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
  }
  return { width, height, data: gray };
}

function rotate90(src: Gray): Gray {
  const out = new Uint8ClampedArray(src.data.length);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      out[x * src.height + (src.height - 1 - y)] = src.data[y * src.width + x];
    }
  }
  return { width: src.height, height: src.width, data: out };
}

/** Downscale by an integer factor (box filter) to help very large or noisy photos. */
function downscale(src: Gray, factor: number): Gray {
  const w = Math.floor(src.width / factor);
  const h = Math.floor(src.height / factor);
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = 0; dy < factor; dy++) for (let dx = 0; dx < factor; dx++) sum += src.data[(y * factor + dy) * src.width + x * factor + dx];
      out[y * w + x] = (sum / (factor * factor)) | 0;
    }
  }
  return { width: w, height: h, data: out };
}

const hints = new Map<DecodeHintType, unknown>([
  // 1D retail formats only. Rotations are handled in decodeBarcodeFromImage.
  [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]],
]);

function tryDecode(img: Gray): string | null {
  const reader = new MultiFormatReader();
  try {
    const source = new RGBLuminanceSource(img.data, img.width, img.height);
    // Hints must be passed to decode(): MultiFormatReader.decode(image) calls setHints(null) and would
    // otherwise run every 2D reader too (slow, and it logs a stack trace per failed reader).
    return reader.decode(new BinaryBitmap(new HybridBinarizer(source)), hints).getText();
  } catch {
    return null;
  }
}

/**
 * Returns the digits of the first EAN-13/EAN-8/UPC-A/UPC-E barcode found (any of the four 90-degree rotations,
 * and a downscaled copy for big photos), or null. The caller must still validate the check digit.
 */
export function decodeBarcodeFromImage(bytes: Uint8Array, contentType: string): string | null {
  const base = decodePixels(bytes, contentType);
  if (!base) return null;
  const variants: Gray[] = [base];
  const longest = Math.max(base.width, base.height);
  if (longest > 1600) variants.push(downscale(base, Math.min(4, Math.ceil(longest / 1200))));
  for (const variant of variants) {
    let cur = variant;
    for (let turn = 0; turn < 4; turn++) {
      const text = tryDecode(cur);
      if (text) return text.replace(/\D/g, "") || null;
      cur = rotate90(cur);
    }
  }
  return null;
}
