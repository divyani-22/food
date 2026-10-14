"""Runs the real YOLOX detector + real FreshGuard checkpoint on a composite of the bundled sample photos.

Executed in a subprocess so real torch is used (test_app.py stubs it). Skips cleanly when torch,
onnxruntime or models/detector/yolox_s.onnx (python tools/fetch_detector.py) is missing.
"""
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
MODEL = ROOT / "models" / "detector" / "yolox_s.onnx"

SCRIPT = r"""
import io, json, sys
sys.path.insert(0, %r)
from PIL import Image
import app
c = app.app.test_client()
canvas = Image.new("RGB", (1200, 900), (235, 235, 230))
pos = {"apple": (20, 20), "banana": (430, 20), "orange": (850, 20), "strawberry": (20, 330), "tomato": (430, 330)}
for n, xy in pos.items():
    im = Image.open(app.BASE_DIR / "static" / "samples" / (n + ".jpg")).convert("RGB")
    im.thumbnail((380, 300))
    canvas.paste(im, xy)
buf = io.BytesIO(); canvas.save(buf, "JPEG")
r = c.post("/api/detect", data={"file": (io.BytesIO(buf.getvalue()), "c.jpg")})
d = r.get_json()
for it in d.get("items", []):
    (app.UPLOAD_FOLDER.parent.parent / it["image_url"].lstrip("/")).unlink(missing_ok=True)
print("JSON:" + json.dumps({"status": r.status_code, "items": [
    {"fruit": i["fruit"], "det": i["detector_label"], "conf": i["confidence"], "box": i["box"]} for i in d.get("items", [])],
    "rejected": len(d.get("rejected", []))}))
"""


def _has(mod):
    return subprocess.run([sys.executable, "-c", f"import {mod}"], capture_output=True).returncode == 0


@pytest.mark.skipif(not MODEL.is_file(), reason="detector model not installed (python tools/fetch_detector.py)")
@pytest.mark.skipif(not (_has("torch") and _has("onnxruntime")), reason="torch/onnxruntime not installed")
def test_real_detector_finds_several_items_in_composite():
    proc = subprocess.run([sys.executable, "-c", SCRIPT % str(ROOT)], cwd=ROOT,
                          capture_output=True, text=True, timeout=600)
    assert proc.returncode == 0, proc.stderr[-2000:]
    out = json.loads(next(l for l in proc.stdout.splitlines() if l.startswith("JSON:"))[5:])
    assert out["status"] == 200
    fruits = {i["fruit"] for i in out["items"]}
    assert len(out["items"]) >= 3, out
    assert len(out["items"]) <= 20
    assert {"apple", "banana"} <= fruits, out
