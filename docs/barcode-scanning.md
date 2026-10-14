# Hybrid barcode scanning + OCR

Product identification is instant when a barcode is available. The vision-LLM OCR path is only used when the
barcode is missing or unknown, or when the product has no ingredient text on Open Food Facts (OFF).

## Flow

```
Barcode mode                       Image mode (label photo)
  camera / photo / typed             choose photo
        |                                 |
   checkBarcode()                   decode barcode from the photo (zxing / BarcodeDetector)
        |                                 |-- none / invalid checksum  -> OCR exactly as before
        v                                 |-- valid code
 openFoodFacts.getByBarcode  <------------+
        |
  +-----+---------------------+------------------------+
  | found + ingredients       | found, no ingredients  | not found / outage
  | prefill, editable text,   | name prefilled, guide  | distinct messages, offer
  | createScan + analyze,     | to Image (OCR) mode    | Image (OCR) mode
  | NO processOCR / upload    |                        |
```

In Image mode the hybrid path is automatic only when a valid barcode was decoded **and** OFF returned ingredient
text. The banner always has "Read the label with OCR instead" to force the OCR path. A scan created through the
barcode path is stored with `inputType: "text"` (the DB enum has no barcode value) and the OFF ingredient text
(possibly edited by the user) as `rawIngredients`.

## Code map

| Piece | File |
|---|---|
| Normalization, GS1 check digits, UPC-E expansion, candidate picking (pure, unit-tested) | `IngreScan-AI/client/src/lib/barcode.ts` |
| Decoding: BarcodeDetector + zxing, photo preprocessing variants, camera helpers | `IngreScan-AI/client/src/lib/barcodeDecode.ts` |
| UI: live camera, photo, typed entry | `IngreScan-AI/client/src/components/BarcodeScanner.tsx` |
| Third input mode + hybrid image flow | `IngreScan-AI/client/src/pages/Scanner.tsx` |
| Scan action in the explorer | `IngreScan-AI/client/src/pages/OpenFoodFactsExplorer.tsx` |
| OFF client, base URL, cache | `IngreScan-AI/server/lib/offClient.ts`, `openFoodFacts` router in `server/routers.ts` |

## Validation rules

* Accepted: EAN-13 (13 digits), UPC-A (12), EAN-8 (8), UPC-E (8, number system 0/1, expanded to UPC-A to verify).
* Spaces and hyphens are stripped. Failures carry a reason: `empty`, `non_numeric`, `bad_length`, `bad_checksum`
  (with the expected check digit).
* Lookup codes: UPC-A and UPC-E are padded to 13 digits (OFF stores UPC-A as EAN-13 with a leading zero); EAN-8 stays 8 digits.
* An 8-digit code valid as both EAN-8 and UPC-E is treated as EAN-8 unless the decoder says `upc_e`.
* The **server** only rejects malformed input (not 4 to 20 digits returns `null` without calling OFF). It does not
  verify check digits because real OFF data contains some codes with invalid check digits. The **client** shows a
  warning for a bad check digit and only looks the code up after the user presses "Look up anyway".
* Decoders validate check digits themselves: zxing throws `ChecksumException` when a barcode is found but its check digit
  fails, and the native detector normally drops such reads. We cannot recover the digits in that case, so the UI
  reports "a barcode was detected but its check digit does not match" (photo) or a hold-steady hint (live camera,
  after 4 consecutive failures) instead of silently ignoring it, and offers typed entry. Codes whose digits are known
  but invalid (typed, or returned by a decoder that does not validate) get the explicit "Look up anyway" button.

## Browser support

| Capability | Engine | Where |
|---|---|---|
| Live camera + photo | Native `BarcodeDetector` (formats ean_13, ean_8, upc_a, upc_e) | Chrome/Edge on Android and ChromeOS, Chrome on macOS; not in desktop Chromium on Linux, not in Firefox, not in Safari (as of this writing) |
| Live camera + photo | `@zxing/browser` / `@zxing/library` (pure JS, lazy-loaded chunk) | Everywhere with `getUserMedia` and canvas |
| Photo only | Both engines are tried | Native first, then zxing |
| Typed entry | none | Always works |

The native detector is used when `BarcodeDetector.getSupportedFormats()` includes at least one of our formats;
otherwise zxing is used. The zxing chunk is only downloaded when scanning starts.

Camera caveats:

* `getUserMedia` needs a secure context: HTTPS or `localhost`/`127.0.0.1`. On plain `http://<lan-ip>` the camera
  button explains this and points to photo upload and typed entry.
* Permission denied, no camera, camera busy and unknown errors each show a specific message.
* The stream and the decode timer are released on stop, on unmount, when the code is found and when the tab is hidden.
* A code is delivered once; the same code re-read within 3 seconds is dropped. Invalid-checksum reads are surfaced
  as a hint after two identical reads instead of being ignored.

## Photo decoding and fallbacks

Photos are drawn on a canvas capped at 1600 px (EXIF orientation honored where `createImageBitmap` supports it).
If the first decode fails, these variants are tried in order until one yields a **valid** code:
original, grayscale + auto-contrast, 50% downscale (with and without contrast), 150% upscale, rotations 90/180/270
(with and without contrast), then four overlapping crops (bottom, top, left, right) upscaled. If only checksum-invalid
reads occur, the first one is reported so the user can correct it. If nothing decodes, the message suggests
more light, less glare, filling the frame, holding steady, or typing the number.

## Open Food Facts configuration and caching

| Env var | Default | Meaning |
|---|---|---|
| `OPENFOODFACTS_BASE_URL` | `https://world.openfoodfacts.org` | Base URL for both `getByBarcode` and `search` (mirrors, local stub). Must be http(s); invalid values are ignored with a log line. |
| `OFF_CACHE_HIT_TTL_SECONDS` | `21600` | TTL of found products (0 disables caching hits) |
| `OFF_CACHE_MISS_TTL_SECONDS` | `300` | TTL of confirmed not-found results (HTTP 404 or `status: 0`) |
| `OFF_CACHE_MAX_ENTRIES` | `500` | Size bound, least recently used entry is evicted |
| `OFF_CACHE_DISABLED` | unset | `true` turns the cache off. It is also off when `NODE_ENV=test` unless a test enables it |

Error semantics (unchanged): not found returns `null`; any outage (network error, timeout, 5xx, non-JSON) throws
`SERVICE_UNAVAILABLE`. **Outages are never cached.** The cache key includes the base URL. The cache is per server
process, in memory.

## Fixtures

PNG fixtures live in `e2e/fixtures/`. They are generated by a throwaway script whose dependencies are **not**
project dependencies:

```bash
python3 -m venv /tmp/barcode-fixtures-venv
/tmp/barcode-fixtures-venv/bin/pip install python-barcode pillow numpy
/tmp/barcode-fixtures-venv/bin/python e2e/fixtures/generate.py
```

| File | Content |
|---|---|
| `ean13-valid.png` | 4006381333931 (stub product "Test Biscuits") |
| `upca-valid.png` | 036000291452, looked up as 0036000291452 |
| `ean13-bad-checksum.png` | 4006381333932 (check digit should be 1) |
| `ean13-rotated-90.png` | valid code rotated 90 degrees |
| `ean13-noisy-blurred.png` | valid code with Gaussian blur and noise |
| `product-photo-with-barcode.png` | label text plus the valid barcode in a corner |
| `label-no-barcode.png` | same label, no barcode |
| `ean13-unknown.png`, `ean13-no-ingredients.png`, `ean13-outage.png`, `ean13-outage-hybrid.png` | codes the stub answers with 404, product without ingredients, 503 that later recovers, 503 always |

## Tests

```bash
cd IngreScan-AI
npx vitest run server/barcode.test.ts server/off.test.ts server/routers.test.ts   # unit + router tests
npx tsc --noEmit                                                                    # types

# end to end (needs MariaDB with database ingrescan_c, Chromium via playwright, ffmpeg for the live-camera checks)
cd ../e2e && node barcode-scan.mjs
```

`e2e/barcode-scan.mjs` starts a local OFF stub (`/api/v2/product/<code>.json` with realistic fields, 404 body for
unknown codes, 503 for the outage code, `/cgi/search.pl`), starts the real app with `OPENFOODFACTS_BASE_URL` pointing
at it, drives Chromium, asserts on DB rows through the `mysql` CLI and on network requests (no `scanner.processOCR`
or `scanner.uploadImage` on the barcode path). Live camera checks use Chromium's fake device with an MJPEG file
generated from the fixture by ffmpeg at run time.

## Known limits

* The native `BarcodeDetector` path cannot be exercised in headless Chromium on Linux; it is code-reviewed only.
  The zxing path is what the automated tests cover.
* Real phone cameras (focus, glare, motion blur), Safari/iOS and Firefox were not tested here. zxing performance on
  low-end phones depends on the device; the live loop decodes at most about 5 frames per second at up to 1280 px.
* Only the four retail symbologies are read. GTIN-14 (ITF-14), QR and Code 128 are ignored.
* OFF data is community-edited: ingredient text can be missing, outdated or in another language. The text is
  editable before analysis, and the UI says where it came from.
* The scan record does not store the barcode (no column for it); the source is visible in the UI at scan time only.
