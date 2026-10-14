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
   the fruit, freshness and shelf life come from the classifier. A detection is kept only if the classifier confidence is
   at least 70%; the rest are returned under `rejected` (count shown in the UI).
4. Each kept item gets a 256 px crop thumbnail in `static/uploads/` (pruned like other uploads), which is its pantry image.

Response of `POST /api/detect` (multipart `file` or JSON `{"image": base64}`): `{items: [{box:{x,y,w,h} in image px,
detector_label, detector_score, ...all /api/predict fields, image_url}], rejected, image:{width,height}, min_confidence, detector, note}`.

Web proxy: `POST /api/freshguard/detect`, login required, 10 requests/min (on top of the 60/min FreshGuard limit), declared
body over 10 MB gets 413. The browser downscales photos to 1600 px before upload.

## Limits (read before relying on it)

- Recall: COCO knows only apple, banana, orange, broccoli, carrot as produce. Mango, bell pepper, potato, tomato, cucumber and
  strawberry are often not detected at all, or detected as another class. Items missing from the list can be added with the single-item scan.
- The classifier cannot reject non-produce, so a false detection (for example an orange crop labelled carrot) can pass if the classifier is confident.
  The review list exists for that reason.
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
- `e2e/multi-item.mjs`: real servers, Playwright at 390 px and 1280 px, proxy limits, untick/retype/add, DB check, per-user isolation, detector-missing UI.

Tested: all of the above on CPU, Linux, onnxruntime 1.29. Untested: GPU, real fridge photos (only a composite of five stock photos),
iOS/Android camera capture, MySQL (e2e ran on SQLite), production-mode auth (anonymous 401 check runs only with EXPECT_PROD=1).
