"""Checks for the in-browser (ONNX) inference artifacts.

* fruitInfo.json must be regenerated whenever fruit_info.py changes (`python tools/export_onnx.py --knowledge-only`).
* The exported ONNX model must reproduce the PyTorch checkpoint on real images.
"""
import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import fruit_info  # noqa: E402

WEB = ROOT / "IngreScan-AI"
KNOWLEDGE_JSON = WEB / "client" / "src" / "lib" / "fruitInfo.json"
MODEL = WEB / "client" / "public" / "models" / "freshguard.onnx"
META = WEB / "client" / "public" / "models" / "freshguard.meta.json"
CHECKPOINT = ROOT / "models" / "efficientnet_b0_freshguard_multitask.pt"
SAMPLES = sorted((ROOT / "static" / "samples").glob("*.jpg"))


def _load_export_module():
    spec = importlib.util.spec_from_file_location("export_onnx", ROOT / "tools" / "export_onnx.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


# ---------------------------------------------------------------- knowledge (no onnxruntime needed)

def test_fruit_info_json_is_up_to_date():
    assert KNOWLEDGE_JSON.is_file(), "run: python tools/export_onnx.py --knowledge-only"
    on_disk = json.loads(KNOWLEDGE_JSON.read_text(encoding="utf-8"))
    assert on_disk == fruit_info.build_client_knowledge(), (
        "client/src/lib/fruitInfo.json is out of date vs fruit_info.py; "
        "run: python tools/export_onnx.py --knowledge-only"
    )


def test_fruit_info_json_text_is_exactly_what_the_exporter_writes():
    exporter = _load_export_module()
    assert KNOWLEDGE_JSON.read_text(encoding="utf-8") == exporter.knowledge_json_text()


def test_freshness_rules_in_json_match_python_rules():
    rules = json.loads(KNOWLEDGE_JSON.read_text(encoding="utf-8"))["freshness"]
    assert rules["fresh_threshold"] == 0.7 and rules["rotten_threshold"] == 0.3
    for i in range(0, 1001):
        p = i / 1000
        expected = fruit_info.evaluate_freshness(p)
        status = "fresh" if p >= rules["fresh_threshold"] else "rotten" if p <= rules["rotten_threshold"] else "normal"
        meta = rules["statuses"][status]
        assert expected["status"] == status
        assert (expected["status_kr"], expected["badge_color"], expected["message"]) == (
            meta["status_kr"], meta["badge_color"], meta["message"],
        )


def test_app_uses_the_shared_freshness_rules():
    # app.py imports evaluate_freshness from fruit_info instead of defining its own copy.
    source = (ROOT / "app.py").read_text(encoding="utf-8")
    assert "def evaluate_freshness" not in source
    assert "evaluate_freshness" in source.split("from fruit_info import", 1)[1].split(")", 1)[0]


def test_knowledge_is_english_and_emoji_free():
    text = KNOWLEDGE_JSON.read_text(encoding="utf-8")
    assert not any(0xAC00 <= ord(c) <= 0xD7AF or 0x1F000 <= ord(c) <= 0x1FAFF or 0x2600 <= ord(c) <= 0x27BF for c in text)


# ---------------------------------------------------------------- model parity
#
# These run tools/export_onnx.py --verify-only in a fresh interpreter: tests/test_app.py replaces torch with a
# light stand-in inside this process, and the parity check needs the real PyTorch and onnxruntime.

@pytest.fixture(scope="module")
def verification():
    pytest.importorskip("onnxruntime")
    if not MODEL.is_file():
        pytest.fail("freshguard.onnx is missing; run: python tools/export_onnx.py")
    proc = subprocess.run(
        [sys.executable, str(ROOT / "tools" / "export_onnx.py"), "--verify-only"],
        capture_output=True, text=True, cwd=ROOT, timeout=600,
    )
    assert proc.returncode == 0, proc.stdout[-2000:] + proc.stderr[-2000:]
    return json.loads(proc.stdout.strip().splitlines()[-1])


def test_onnx_matches_pytorch_on_real_and_derived_images(verification):
    assert verification["images"] >= 20
    assert verification["worst_abs_logit_diff"] < 1e-3


def test_onnx_io_contract():
    ort = pytest.importorskip("onnxruntime")
    sess = ort.InferenceSession(str(MODEL), providers=["CPUExecutionProvider"])
    assert [(i.name, list(i.shape)) for i in sess.get_inputs()] == [("input", [1, 3, 224, 224])]
    assert [o.name for o in sess.get_outputs()] == ["fruit_logits", "fresh_logits"]


def test_meta_matches_checkpoint_and_model_file(verification):
    meta = json.loads(META.read_text(encoding="utf-8"))
    assert meta["fruit_names"] == verification["fruit_names"]
    assert meta["fresh_labels"] == verification["fresh_labels"]
    assert meta["fresh_index"] == verification["fresh_labels"].index("fresh")
    assert meta["checkpoint_sha256"] == _sha256(CHECKPOINT), "checkpoint changed; re-run tools/export_onnx.py"
    assert meta["model_sha256"] == _sha256(MODEL), "freshguard.onnx does not match its meta file"
    assert meta["model_bytes"] == MODEL.stat().st_size
    assert meta["input"]["shape"] == [1, 3, 224, 224]
    pre = meta["preprocess"]
    assert (pre["resize_shorter_side"], pre["center_crop"]) == (256, 224)
    assert pre["mean"] == [0.485, 0.456, 0.406] and pre["std"] == [0.229, 0.224, 0.225]
    # every class the model can emit has knowledge-base entries
    info = json.loads(KNOWLEDGE_JSON.read_text(encoding="utf-8"))["fruits"]
    assert set(meta["fruit_names"]) <= set(info)


def test_only_one_copy_of_the_model_is_committed():
    copies = [p for p in ROOT.rglob("*.onnx") if "node_modules" not in p.parts and "dist" not in p.parts and "detector" not in p.parts]  # detector weights are a separate, git-ignored download
    assert copies == [MODEL], copies
