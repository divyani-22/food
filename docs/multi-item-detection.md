# Multi-item detection ("Scan a whole shelf")

Upload one photo containing several fruits or vegetables. The server finds each item, classifies every crop with the
existing FreshGuard EfficientNet-B0 multitask model (fruit type, freshness, shelf life), and the web app shows a review
list. The user unticks or retypes items, then adds the chosen ones to their pantry with the existing per-user
`produce.addInventory` tRPC mutation (no new store).

## Setup

```
python3 tools/fetch_detector.py      # downloads models/detector/yolox_s.onnx (35.9 MB, SHA-256 pinned)
pip install onnxruntime numpy pillow # already in requirements.txt
python3 app.py                       # Flask now serves POST /api/detect
```

The weights are not committed (`models/detector/` is git-ignored). Without them `/api/detect` answers
`503 {"code": "detector_not_installed"}` and the UI shows a clear message with a button for the single-item scan.
`FRESHGUARD_DETECTOR_PATH` overrides the model location.

## How it works

1. `detector.py`: YOLOX-S (COCO, 640x640, letterboxed) run with onnxruntime only (no torch/ultralytics at runtime).
2. Only COCO classes apple, banana, orange and carrot are kept (broccoli is detected by COCO but FreshGuard cannot label it).
   Per-class NMS, then class-agnostic de-duplication (IoU > 0.6 or box > 85% inside a better one), boxes under 24 px dropped, max 20 items.
3. Each box is padded by 10% and cropped; the crop goes through the FreshGuard classifier. The detector label is never trusted:
   the fruit, freshness and shelf life come from the classifier. A crop is dropped (returned under `rejected`, count shown in
   the UI) if its out-of-distribution score says it does not look like produce (`reason: "not_produce"`, see
   `docs/non-produce-rejection.md`) or the classifier confidence is below 70% (`low_classifier_confidence`).
4. Consistency checks on every kept crop (`SHELF_CHECKS`, default on). `needs_check: true` and `check_reasons` are set when
   the detector's COCO label and a classifier fruit that COCO can also name disagree (`label_mismatch`, for example detector
   orange vs classifier carrot), the produce likelihood is between the reject level (0.5) and 0.8 (`low_produce_likelihood`),
   or the top two fruits are within 25 points (`ambiguous_type`). The web app lists such items as "Check this item" and leaves
   them unticked; the stored `confidence` is still the model's real value (it is not rewritten).
5. Each kept item gets a 256 px crop thumbnail in `static/uploads/` (pruned like other uploads), which is its pantry image.

Response of `POST /api/detect` (multipart `file` or JSON `{"image": base64}`): `{items: [{box:{x,y,w,h} in image px,
detector_label, detector_score, source, needs_check, check_reasons, ...all /api/predict fields (incl. produce_likelihood), image_url}],
rejected, image:{width,height}, min_confidence, ood, second_pass, detector, note}`. `source` is `detector` or `second_pass`.

Web proxy: `POST /api/freshguard/detect`, login required, 10 requests/min (on top of the 60/min FreshGuard limit), declared
body over 10 MB gets 413. The browser downscales photos to 1600 px before upload.

## Optional second pass (off by default; the numbers say it does not help)

`SHELF_SECOND_PASS=1` adds a sliding-window pass for regions the detector missed: square windows at 3 scales (50%, 34% and 24%
of the shorter image side, 50% overlap, at most 120 windows) are classified in batches; a window is a candidate only if its
produce likelihood is at least 0.9 (`SHELF_SECOND_PASS_MIN_LIKELIHOOD`) and the classifier is at least 90% sure; candidates
that overlap an existing item are dropped, the rest go through NMS and are capped at 6; every extra item is returned with
`source: "second_pass"` and `needs_check: true`.

Measured with `tools/eval_shelf.py` (below): zero additional correct items and 15 additional false positives (strict bar);
62 additional false positives with the bar lowered to 0.5. The classifier simply does not give confident, correct answers on
the regions the detector misses (tomato in particular), so a stricter score only removes the right answers along with the wrong
ones. It therefore ships disabled; the code and flag stay so it can be re-measured on real shelf photos.

## Evaluation: `tools/eval_shelf.py`

```
pip install scikit-image scikit-learn matplotlib   # only for the distractor tiles
python3 tools/eval_shelf.py --per-layout 6 --json out.json
```

30 composites (5 layouts: row, grid, scatter, small, dense; 6 seeds each; 1400x1000) built from the 5 bundled sample photos
(256 produce tiles: apple, banana, orange, strawberry, tomato) plus 76 non-produce distractor tiles. Each configuration is run through the
real `/api/detect` route with the real YOLOX and classifier. A prediction is a true positive if at least 60% of its box lies
inside a ground-truth tile of the same class that has no true positive yet. "Accepted" = what the web app ticks by default
(`needs_check == false`); "all" = every listed item.

| config | view | precision | recall | TP | FP (wrong label / spurious) |
| --- | --- | --- | --- | --- | --- |
| before (no OOD, no checks) | all = accepted | 0.72 | 0.80 | 205 | 81 (65 / 16) |
| default (OOD gate + checks) | accepted | 1.00 | 0.68 | 174 | 0 |
| default | all listed | 0.88 | 0.74 | 190 | 25 (17 / 8) |
| + second pass (strict) | all listed | 0.83 | 0.74 | 190 | 40 (17 / 23) |
| + second pass (loose, 0.5) | all listed | 0.69 | 0.74 | 190 | 87 (17 / 69) |

Per class (before -> default accepted): apple precision 0.52 -> 1.00, orange 0.77 -> 1.00, carrot (never in the images)
FP 20 -> 0, strawberry recall 0.85 -> 0.43, tomato recall 0.18 -> 0.00 (precision 1.00 -> undefined: nothing accepted).
Regressions, stated plainly: 15 correct items (205 -> 190) are now rejected as not produce, and 16 more correct items
become "check this item" (unticked), so recall of the default-ticked list drops from 0.80 to 0.68; the strawberry and tomato
tiles are mostly lost (in a 15-composite probe with the checks off, crops inside tomato tiles were labelled apple, orange, bell pepper,
carrot, strawberry or tomato, mostly with confidence above 70%; the checks cannot repair a wrong label that the detector
shares, they only drop crops whose produce likelihood is low or whose two labels conflict).
Distractor false positives were 0 before as well: the COCO detector did not fire on these distractor tiles, so the OOD gate
cannot show a gain on them in this benchmark; its measurable effect here is on the wrongly labelled fruit crops. The
non-produce score itself is evaluated in `docs/non-produce-rejection.md`.

## Limits (read before relying on it)

- Recall: COCO knows only apple, banana, orange, broccoli, carrot as produce. Mango, bell pepper, potato, tomato, cucumber and
  strawberry are often not detected at all, or detected as another class. Items missing from the list can be added with the single-item scan.
- The produce-likelihood gate and the consistency checks reduce, but do not remove, false detections (for example an orange crop
  labelled carrot): they catch low-energy crops and detector/classifier conflicts. A crop that both models label wrongly and
  confidently (a tomato called apple) still passes. The review list exists for that reason.
- The evaluation above uses 5 source photos pasted on plain backgrounds; real shelves are harder. Treat the numbers as relative effects only.
- Crops are center-cropped to a square by the existing classifier preprocessing; long items may be partly cut.
- Changing an item's type in the review list uses that fruit's shelf life and storage tip for the item's freshness status; the stored confidence stays the model's value for the original label.
- Server-side only: photos are uploaded for this mode (no on-device path).

## License decision

YOLOX (Megvii) is Apache-2.0, so the weights and code can be used commercially and could be committed. They are downloaded
instead to keep the repository small. Ultralytics YOLOv8 was considered and rejected because it is AGPL-3.0.
Attribution: YOLOX, https://github.com/Megvii-BaseDetection/YOLOX, release 0.1.1rc0.

## Tests

- `tests/test_detector.py`: pure logic (letterbox, decode, NMS, de-dup, padding, cap), no model needed.
- `tests/test_app.py`: `/api/detect` with a fake localiser (503, 400, classifier override, threshold, zero items).
- `tests/test_detector_integration.py`: real YOLOX + real checkpoint on a composite of the bundled samples; skips if the model, torch or onnxruntime is missing.
- `tests/test_ood.py`, `tests/test_ood_integration.py`: see `docs/non-produce-rejection.md`.
- `tools/eval_shelf.py`: the before/after benchmark above (not a pytest test).
- `e2e/multi-item.mjs`: real servers, Playwright at 390 px and 1280 px, proxy limits, untick/retype/add, DB check, per-user isolation, detector-missing UI.

Tested: all of the above on CPU, Linux, onnxruntime 1.29. Untested: GPU, real fridge photos (only a composite of five stock photos),
iOS/Android camera capture, MySQL (e2e ran on SQLite), production-mode auth (anonymous 401 check runs only with EXPECT_PROD=1).
