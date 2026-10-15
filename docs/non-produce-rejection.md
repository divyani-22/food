# Non-produce rejection ("this does not look like fresh produce")

The FreshGuard classifier is a closed-set softmax over 10 fruits, so it names *some* fruit for any photo (a cat, a
receipt, a gravel road). This change adds an out-of-distribution (OOD) score so those photos are flagged instead of
answered with a confident fruit name. Nothing was retrained; no new model file is needed.

## What is returned

`POST /api/predict` (and every crop in `POST /api/detect`) gets four additive fields; all existing fields are unchanged and
the response is still HTTP 200:

| field | meaning |
| --- | --- |
| `produce_score` | energy score `logsumexp(fruit_logits)` (higher = more like the training photos) |
| `produce_likelihood` | `sigmoid((score - 6.0) / 1.5)`, in 0..1. A monotone rescale for readability, **not a calibrated probability** |
| `is_produce` | `produce_likelihood >= PRODUCE_MIN_LIKELIHOOD` |
| `produce_min_likelihood`, `ood_method` | the threshold used and `"energy"` |

`fruit`, `confidence`, `freshness_*` are still the closed-set answer even when `is_produce` is false, for backward
compatibility; callers must not present them as a verdict when the flag is false.

Configuration (environment of the Flask process, read per request): `PRODUCE_MIN_LIKELIHOOD`, default `0.5` (score 6.0).
`0` disables flagging (the fields are still reported). A higher value is stricter. Flagged `/api/predict` photos are not
written to the standalone Flask `scan_history`.

## Why the energy score

Candidates measured with `tools/eval_ood.py`: max-softmax, max-logit, energy. A Mahalanobis distance on the 1280-d
penultimate features and a logistic head on features were also tried while developing (scratch code, not shipped):
under leave-one-source-out they were at chance (Mahalanobis AUROC 0.45) or unstable (logistic head 0.82, wide
interval), which is expected with five source photos. The training-free scores are all about 0.90, within each other's
error, and energy was chosen because:

* it needs no fitted parameters, so it cannot be over-fitted to five photos;
* it is a function of `fruit_logits` only, which the ONNX export already outputs. `tools/eval_ood.py` computes it from the
  ONNX logits: max |difference| to PyTorch 2.7e-4 over 184 images. **The browser path can therefore compute the same score
  with no re-export**, but `onDevice*.ts` does not do so yet (see "On-device").

Multi-view averaging (squash/pad/crop variants) gave AUROC 0.82 to 0.92 depending on the combination, not a consistent
gain, so it was not adopted.

## Evaluation (small and partly synthetic: read the limits)

Run: `python3 tools/eval_ood.py` (needs `pip install scikit-image scikit-learn matplotlib` for the full negative set).

* Positives: 75 images made from the **5 bundled sample photos** (apple, banana, orange, strawberry, tomato) x 15 synthetic
  variants (flip, rotate, crops, 1/3 downscale, JPEG 35, dark, bright, blur, tilt, pasted on four backgrounds).
  They are not independent samples and cover 5 of the 10 classes.
* Negatives: 109 images from 65 sources: scikit-image / scikit-learn / matplotlib sample images (astronaut, cat, coffee
  cup, coins, rocket, text page, horse, gravel, a flower, ...), the repo's barcode/product fixtures, and procedural images
  (solid fruit-coloured fills, gradients, noise, rendered text, flat shapes). Several are deliberately adversarial.

Results (this run):

| score | AUROC | 95% bootstrap interval (resampling sources) |
| --- | --- | --- |
| energy (shipped) | 0.903 | 0.80 to 0.99 |
| max-logit | 0.902 | 0.80 to 0.99 |
| max-softmax | 0.901 | 0.81 to 0.98 |

Chosen threshold 0.5 (energy 6.0), picked **on these same sets**, so the numbers below are optimistic:

* positives accepted: 77.3%; **false "not produce" on real produce images: 22.7%** (apple 8/15 variants rejected, tomato 7/15,
  strawberry 2/15, banana and orange 0/15; the rejected variants are mostly the fruit pasted small on a plain background
  or heavily cropped/blurred);
* non-produce wrongly accepted as produce: 11.0% (12 of 109 images: gravel, horse, colour wheel, clock, flower, a crop of
  the astronaut photo, and others);
* hold-out check: choosing the threshold on the scikit-image and fixture negatives only (energy 6.7) and testing on the
  other negatives gives 2.6% false accepts (1 of 39) at 74.7% positive acceptance. 39 images is too few to claim more;
* at 0% false accepts on this negative set the energy threshold is 9.8 and only 38.7% of positives pass; at 5% false
  accepts, 64%; at 10%, 76%.

Takeaway: the score is useful (it clearly separates cats, receipts, products, faces, flat fills) but it is not a
reliable produce detector. Textured natural images such as gravel can score as high as real fruit. The default threshold
trades about one in five legitimate (but small, cropped or low-contrast) fruit photos for the flag, which is why the UI
always offers "Use anyway". The `PRODUCE_MIN_LIKELIHOOD` default should be revisited once real user photos exist.

## UI behaviour

* Single item (`ProduceScanner`): when `is_produce === false` a card titled "This does not look like fresh produce" replaces the
  verdict, with "Try another photo" and "Use anyway". The scan is not written to history until the user chooses "Use anyway",
  which then shows the usual verdict and saves it. A missing field (on-device result or an older server) means unknown and is
  never treated as a rejection.
* Shelf (`ShelfScan`): crops below the threshold are dropped (reason `not_produce`, counted in a note); kept crops between the
  threshold and `SHELF_SURE_LIKELIHOOD` (0.8) are marked "Check this item" and start unticked. Ticking is the "use anyway" choice.

## On-device

The ONNX model already has what is needed. To get the same flag in the browser, `client/src/lib/onDevice*.ts` should expose
`fruit_logits` and apply `energy = max + ln(sum(exp(l - max)))`, `likelihood = 1 / (1 + exp(-(energy - 6.0) / 1.5))`,
`is_produce = likelihood >= 0.5` (constants in `ood.py`, matching `tools/eval_ood.py`). Until then the on-device path
reports no flag and the page behaves as before. Parity between the two paths is only guaranteed to the ONNX/PyTorch logit
tolerance (about 3e-4 on the energy), so a photo extremely close to the threshold can be flagged by one engine and not the other.

## Other consumers of `/api/predict`

`IngreScan-AI/server/whatsappRuntime.ts` (`classifyImage`) reads `/api/predict` but ignores the flag, so the WhatsApp bot can
still name a cat as a carrot. It should return `null` (its existing "not produce" path) when `d.is_produce === false`, and
`ProduceClassification` in `server/whatsapp/types.ts` could carry `isProduce?: boolean`. The proxy
(`server/_core/index.ts`) forwards the JSON unchanged, so no proxy change is needed.

## Tests

* `tests/test_ood.py`: pure score, rescale, env parsing, threshold behaviour (no model).
* `tests/test_app.py`: flag fields, 200 + no persistence when flagged, configurable/zero threshold, shelf rejection.
* `tests/test_ood_integration.py`: real checkpoint: sample photos not flagged, a product photo / green fill / gradient flagged,
  energy from the ONNX `fruit_logits` agrees with PyTorch.
* `e2e/multi-item.mjs`: proxy flag, flagged card, "Use anyway", history persistence, 390 px and 1280 px.
