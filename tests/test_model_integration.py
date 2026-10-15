"""Runs the real EfficientNet checkpoint on the bundled sample photos.

Executed in a subprocess so the real torch is used even though test_app.py stubs it.
Skipped automatically when torch/torchvision are not installed.
"""
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent

SCRIPT = r"""
import json, sys
sys.path.insert(0, %r)
from PIL import Image
import app
out = {}
for name in ("apple", "banana", "orange", "strawberry", "tomato"):
    with Image.open(app.BASE_DIR / "static" / "samples" / f"{name}.jpg") as im:
        r = app.run_inference(im)
    out[name] = {"fruit": r["fruit"], "fruit_kr": r["fruit_kr"], "status": r["freshness_status"],
                 "p_fresh": r["p_fresh"], "confidence": r["confidence"]}
print("JSON:" + json.dumps(out))
"""


def _torch_available():
    probe = subprocess.run([sys.executable, "-c", "import torch, torchvision"], capture_output=True)
    return probe.returncode == 0


@pytest.mark.skipif(not _torch_available(), reason="torch/torchvision not installed")
def test_real_model_classifies_bundled_samples():
    proc = subprocess.run([sys.executable, "-c", SCRIPT % str(ROOT)], cwd=ROOT,
                          capture_output=True, text=True, timeout=300)
    assert proc.returncode == 0, proc.stderr[-2000:]
    line = next(l for l in proc.stdout.splitlines() if l.startswith("JSON:"))
    results = json.loads(line[5:])
    for name, r in results.items():
        assert r["fruit"] == name, results
        assert r["fruit_kr"] == name.replace("_", " ").title(), results
        assert r["status"] in ("fresh", "normal", "rotten")
        assert 0 <= r["p_fresh"] <= 100 and 0 <= r["confidence"] <= 100
