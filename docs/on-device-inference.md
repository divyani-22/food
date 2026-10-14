# On-device produce inspection

The Produce page (`/produce`) classifies fruit and vegetable photos inside the user's browser with
ONNX Runtime Web. No image is uploaded, and after the first model download it works offline. The Flask
service (`app.py`, PyTorch) stays in place as an automatic fallback and as the reference implementation.

## How it works

```
photo (File / camera / sample Blob)
  -> worker: createImageBitmap (EXIF orientation applied, no colour management)
  -> PIL-exact Resize(256, bilinear, antialiased) + CenterCrop(224) + ToTensor + Normalize
  -> onnxruntime-web session (WebGPU if available, else wasm)
  -> fruit_logits, fresh_logits
  -> main thread: softmax, freshness rules, result object (same shape as the Flask PredictionResult)
```

Source files (all under `IngreScan-AI/client/src/lib/`):

| File | Role |
|---|---|
| `onDeviceProduce.ts` | public API: `isOnDeviceSupported`, `ensureOnDeviceModel`, `classifyOnDevice`, status subscription |
| `onDeviceEngine.ts` | model/wasm download and Cache API storage, ORT session, decode and preprocessing |
| `onDeviceWorker.ts` | dedicated worker hosting the engine (UI thread stays free); main-thread fallback if workers/OffscreenCanvas are missing |
| `onDeviceMath.ts` | pure helpers: softmax, rounding, freshness rules, PIL-exact resize, tensor conversion (unit-tested) |
| `fruitInfo.json` | generated knowledge base and freshness rules |

`onnxruntime-web` is imported dynamically inside the engine, so it is not in the main bundle
(the ORT chunk is about 410 kB, 113 kB gzipped, loaded on demand).

## Single source of truth

`fruit_info.py` holds the fruit knowledge **and** the freshness rules (thresholds 0.7 / 0.3, status labels, badge
colours, messages, defaults). `app.py` imports `evaluate_freshness` from it (`appmod.evaluate_freshness` still
works). `python tools/export_onnx.py` (or `--knowledge-only`) generates `fruitInfo.json` from it, and
`tests/test_onnx_export.py` fails when the committed JSON is out of date.

## Preprocessing parity

Canvas `drawImage` does not reproduce PIL's antialiased bilinear downscale. Measured on 45 images against the
PIL/torchvision pipeline (cropped 224x224 input, then the same ONNX model):

| Resize method | mean pixel diff | max p_fresh diff | top-1 flips |
|---|---|---|---|
| canvas single step, high smoothing | 1.90 | 14.6 pts | 1 |
| canvas multi-step halving | 1.91 | 5.9 pts | 1 |
| canvas single step, default smoothing | 2.14 | 17.7 pts | 1 |
| **PIL port in `onDeviceMath.ts` (used)** | 0 (bit-identical) | 0.0 pts | 0 |

So the app ports Pillow's resampler (triangle filter scaled by the downscale factor, 8-bit fixed-point
coefficients, uint8 rounding between the horizontal and vertical pass, banker's rounding for the crop offset).
Vitest checks SHA-1 equality with PIL for 11 image sizes. Large photos are read in 128-row bands, so a 12 MP image
never needs a full-size canvas.

End-to-end (`e2e/on-device-inference.mjs`, real Chromium, 45 images: 5 samples + 40 derived: crops, 90 degree
rotations, downscales, JPEG q30, darkened, EXIF orientation 6 and 3, PNG, WebP, grayscale, a 12 MP image,
a 200x150 image) browser result vs the Flask/PyTorch service: top-1 fruit 45/45, freshness status 45/45,
max |p_fresh diff| 0.0 points, max confidence diff 0.0 (values compared at the 0.1 rounding of the result).
Both the dev server and the production build were run.

## Model, size and first load

* `client/public/models/freshguard.onnx`: 16.1 MB, opset 17, input `input` [1,3,224,224], outputs
  `fruit_logits`, `fresh_logits`. Max logit difference vs torch: 2.3e-5 over 25 verification images.
* `freshguard.meta.json`: class lists, fresh index, preprocessing, checkpoint and model SHA-256, versions.
* ORT runtime (wasm), served from `/ort/`: 14.2 MB (CPU/wasm) or 28.3 MB (WebGPU-capable runtime, only fetched when a
  WebGPU adapter exists). First load is therefore about 30 MB (CPU) or 44 MB (WebGPU). The page starts the download on
  open, unless the browser reports Save-Data; the status line shows the progress.
* Measured on loopback: first load 1.5 to 3 s; warm inspection 100 to 170 ms (CPU/wasm, headless Chromium). Real
  networks will be dominated by the download.

## Caching and offline

Model, meta and wasm are stored in the Cache API (`freshguard-ondevice-v1`); the model key contains the SHA-256 so a
re-export invalidates it and old entries are deleted. A reload with the model and wasm requests blocked loads from
the cache (tested). Network cut after loading: inspections keep working; saving to history resumes when back online
(React Query pauses the mutation).
Not provided: there is no service worker, so the app shell itself (HTML/JS) is not available for a cold offline start.

## Execution providers

onnxruntime-web 1.30 ships WebGPU and wasm in its default build. A legacy WebGL backend still exists as a separate
`onnxruntime-web/webgl` entry but is not in the default build, and this app does not use it. Order used:
`["webgpu", "wasm"]` when `navigator.gpu.requestAdapter()` succeeds, otherwise wasm only (smaller runtime). If the
WebGPU session fails to create, it retries with wasm. Wasm runs single-threaded, so no COOP/COEP headers are needed
and no other page (fonts, images) is affected.

WebGPU verification: headless Chromium has no GPU. With `E2E_WEBGPU=1` (flag `--enable-unsafe-webgpu`) it exposes a
software adapter; the full suite passed with provider WebGPU (parity identical) but at about 2.6 s per inspection,
which says nothing about real GPU speed. Real GPUs were not tested.

## Serving (dev and production)

`vite.config.ts` has a small plugin: in `vite` dev it serves the two `.wasm` files from `node_modules` at `/ort/`
(MIME `application/wasm`); in `vite build` it emits them to `dist/public/ort/` and drops the duplicate hashed copies
Vite would otherwise add under `assets/`. The app downloads the wasm itself and passes it to ORT as `wasmBinary`.
Verified with the production build served by Express: `.wasm` is `application/wasm`, the model is served, no
cross-origin isolation headers are sent or needed.

## UI and fallback

The Image Input card has a status line ("Loading on-device model 43%", "Runs on this device (CPU)", "Using server")
and an On device / Server switch, persisted in `localStorage` (`ingrescan.produce.engine`). If loading or running
on-device fails (blocked wasm, failed fetch, no memory), a toast explains it, that inspection is answered by
`/api/freshguard/predict`, and the page keeps using the server until the user selects "On device" again. Browsers
without WebAssembly or createImageBitmap use the server only. History and pantry saving is shared by both paths;
on-device results have an empty `image_url` (samples keep their static URL).

## Re-exporting the model

```
python tools/export_onnx.py            # export + verify (fails above 1e-3 logit diff) + meta + fruitInfo.json
python tools/export_onnx.py --verify-only
python tools/export_onnx.py --knowledge-only
```

Re-export after changing the checkpoint; regenerate the knowledge JSON after editing `fruit_info.py`.

## Tests

* `python -m pytest tests/test_onnx_export.py`: JSON freshness, parity torch vs onnx, meta vs checkpoint, one model copy.
* `npx vitest run server/onDevice.test.ts`: softmax, rounding, rules, result shape, PIL-exact resize.
* `node e2e/on-device-inference.mjs`: needs the stack running (see the header of the script).

## Caveats

* Safari and Firefox were not tested (Chromium only); older browsers lacking `createImageBitmap` options fall back to
  default decoding, which may differ slightly. Low-end phones were not tested (about 30 to 44 MB download, wasm memory).
* Images with embedded wide-gamut ICC profiles are decoded without colour conversion to match PIL; not separately tested.
* Images with transparency: PIL drops alpha, the canvas path can differ on semi-transparent pixels.
* Probabilities are computed in float64 from float32 logits; ties at the 0.1 rounding boundary could differ by 0.1.
