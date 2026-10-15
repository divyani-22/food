"""Real checkpoint (and real ONNX file) on bundled photos: the non-produce score must separate obvious cases.

Run in a subprocess so real torch is used (test_app.py stubs torch). Skipped when torch/torchvision are missing.
These are smoke checks on a handful of images, not an accuracy claim: see tools/eval_ood.py and
docs/non-produce-rejection.md for the measured (small, synthetic) evaluation.
"""
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
ONNX = ROOT / "IngreScan-AI" / "client" / "public" / "models" / "freshguard.onnx"

SCRIPT = r"""
import io, json, sys
sys.path.insert(0, %r)
from PIL import Image
import numpy as np
import app, ood

c = app.app.test_client()

def predict(im):
    buf = io.BytesIO(); im.convert("RGB").save(buf, "JPEG")
    r = c.post("/api/predict?persist=0", data={"file": (io.BytesIO(buf.getvalue()), "x.jpg")})
    d = r.get_json()
    p = app.UPLOAD_FOLDER.parent.parent / d["image_url"].lstrip("/")
    p.unlink(missing_ok=True)
    return r.status_code, d

out = {"samples": {}, "negatives": {}}
for n in ("apple", "banana", "orange", "strawberry"):
    st, d = predict(Image.open(app.SAMPLES_DIR / (n + ".jpg")))
    out["samples"][n] = {"status": st, "fruit": d["fruit"], "is_produce": d["is_produce"], "L": d["produce_likelihood"],
                         "keys": sorted(set(("fruit", "fruit_kr", "confidence", "p_fresh", "freshness_status", "top_candidates",
                                             "shelf_life_days", "storage_tips", "image_url", "produce_score",
                                             "produce_likelihood", "is_produce")) - set(d))}
negs = {
    "product_photo": Image.open(app.BASE_DIR / "e2e" / "fixtures" / "product-photo-with-barcode.png"),
    "green_solid": Image.new("RGB", (320, 320), (60, 160, 60)),
    "gradient": Image.fromarray((np.linspace(0, 255, 320)[None, :, None] * np.ones((320, 1, 3))).astype("uint8")),
}
for k, im in negs.items():
    st, d = predict(im)
    out["negatives"][k] = {"status": st, "is_produce": d["is_produce"], "L": d["produce_likelihood"], "fruit": d["fruit"]}

# the same score from the exported ONNX fruit_logits must agree with PyTorch (so the browser can compute it)
onnx = %r
if onnx:
    import onnxruntime as ort
    from torchvision import transforms
    sess = ort.InferenceSession(onnx, providers=["CPUExecutionProvider"])
    worst = 0.0
    for n in ("apple", "banana", "orange", "strawberry", "tomato"):
        im = Image.open(app.SAMPLES_DIR / (n + ".jpg")).convert("RGB")
        x = app.inference_transform(im).unsqueeze(0)
        import torch
        with torch.no_grad():
            tf = app.model(x)[0][0].numpy()
        of = sess.run(None, {"input": x.numpy()})[0][0]
        worst = max(worst, abs(ood.energy_score(tf) - ood.energy_score(of)))
    out["onnx_energy_diff"] = worst
print("JSON:" + json.dumps(out))
"""


def _has(mod):
    return subprocess.run([sys.executable, "-c", f"import {mod}"], capture_output=True).returncode == 0


@pytest.fixture(scope="module")
def out():
    if not (_has("torch") and _has("torchvision")):
        pytest.skip("torch/torchvision not installed")
    onnx = str(ONNX) if ONNX.is_file() and _has("onnxruntime") else ""
    proc = subprocess.run([sys.executable, "-c", SCRIPT % (str(ROOT), onnx)], cwd=ROOT,
                          capture_output=True, text=True, timeout=600)
    assert proc.returncode == 0, proc.stderr[-2000:]
    return json.loads(next(l for l in proc.stdout.splitlines() if l.startswith("JSON:"))[5:])


def test_real_produce_samples_are_not_flagged(out):
    for name, r in out["samples"].items():
        assert r["status"] == 200 and r["fruit"] == name, (name, r)
        assert r["is_produce"] is True and r["L"] > 0.5, (name, r)
        assert r["keys"] == [], f"missing legacy/new keys for {name}: {r['keys']}"


def test_real_non_produce_images_are_flagged_with_http_200(out):
    for name, r in out["negatives"].items():
        assert r["status"] == 200, (name, r)
        assert r["is_produce"] is False and r["L"] < 0.5, (name, r)
        assert r["fruit"]  # legacy closed-set label still present


def test_energy_is_computable_from_onnx_logits(out):
    if "onnx_energy_diff" not in out:
        pytest.skip("ONNX model or onnxruntime missing")
    assert out["onnx_energy_diff"] < 1e-2, out["onnx_energy_diff"]
