#!/usr/bin/env python3
"""Export the FreshGuard multitask EfficientNet-B0 checkpoint to ONNX for in-browser inference.

Writes (single copy of the model, served by the web app as a static asset):
  IngreScan-AI/client/public/models/freshguard.onnx
  IngreScan-AI/client/public/models/freshguard.meta.json
  IngreScan-AI/client/src/lib/fruitInfo.json   (generated from fruit_info.py)

The export is verified with onnxruntime against PyTorch on the real sample images in
static/samples (PIL preprocessing identical to app.py); a mismatch above --tolerance aborts
with a non-zero exit status and removes nothing that was previously valid.

Usage:  python tools/export_onnx.py [--tolerance 1e-3] [--knowledge-only]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

CHECKPOINT = ROOT / "models" / "efficientnet_b0_freshguard_multitask.pt"
WEB = ROOT / "IngreScan-AI"
MODEL_OUT = WEB / "client" / "public" / "models" / "freshguard.onnx"
META_OUT = WEB / "client" / "public" / "models" / "freshguard.meta.json"
KNOWLEDGE_OUT = WEB / "client" / "src" / "lib" / "fruitInfo.json"
SAMPLES = ROOT / "static" / "samples"

INPUT_SIZE = 224
RESIZE = 256
MEAN = [0.485, 0.456, 0.406]
STD = [0.229, 0.224, 0.225]
OPSET = 17


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def knowledge_json_text() -> str:
    from fruit_info import build_client_knowledge

    return json.dumps(build_client_knowledge(), indent=2, ensure_ascii=False, sort_keys=False) + "\n"


def write_knowledge() -> None:
    KNOWLEDGE_OUT.parent.mkdir(parents=True, exist_ok=True)
    KNOWLEDGE_OUT.write_text(knowledge_json_text(), encoding="utf-8")
    print(f"[+] wrote {KNOWLEDGE_OUT.relative_to(ROOT)}")


def load_torch_model():
    import torch
    import torch.nn as nn
    from torchvision.models import efficientnet_b0

    class MultiTaskEffB0(nn.Module):  # identical to app.py
        def __init__(self, n_fruit: int, n_fresh: int):
            super().__init__()
            backbone = efficientnet_b0(weights=None)
            in_ch = backbone.classifier[1].in_features
            backbone.classifier[1] = nn.Identity()
            self.backbone = backbone
            self.dropout = nn.Dropout(0.2)
            self.head_fruit = nn.Linear(in_ch, n_fruit)
            self.head_fresh = nn.Linear(in_ch, n_fresh)

        def forward(self, x):
            feat = self.dropout(self.backbone(x))
            return self.head_fruit(feat), self.head_fresh(feat)

    try:
        ckpt = torch.load(CHECKPOINT, map_location="cpu", weights_only=True)
    except Exception:
        ckpt = torch.load(CHECKPOINT, map_location="cpu", weights_only=False)
    model = MultiTaskEffB0(len(ckpt["fruit_names"]), len(ckpt["fresh_labels"]))
    model.load_state_dict(ckpt["model_state"])
    model.eval()
    return model, ckpt


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tolerance", type=float, default=1e-3, help="max abs logit difference allowed")
    ap.add_argument("--knowledge-only", action="store_true", help="only regenerate fruitInfo.json")
    args = ap.parse_args()

    write_knowledge()
    if args.knowledge_only:
        return 0

    import numpy as np
    import onnx
    import onnxruntime as ort
    import torch
    from PIL import Image, ImageOps
    from torchvision import transforms

    model, ckpt = load_torch_model()
    fruit_names = list(ckpt["fruit_names"])
    fresh_labels = list(ckpt["fresh_labels"])

    MODEL_OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = MODEL_OUT.with_suffix(".onnx.tmp")
    dummy = torch.randn(1, 3, INPUT_SIZE, INPUT_SIZE)
    with torch.no_grad():
        torch.onnx.export(
            model,
            dummy,
            str(tmp),
            input_names=["input"],
            output_names=["fruit_logits", "fresh_logits"],
            opset_version=OPSET,
            do_constant_folding=True,
            dynamo=False,
        )
    # Fold everything into a single self-contained file (no external .data sidecar).
    onnx_model = onnx.load(str(tmp), load_external_data=True)
    onnx.checker.check_model(onnx_model)
    onnx.save_model(onnx_model, str(tmp), save_as_external_data=False)
    data_sidecar = Path(str(tmp) + ".data")
    if data_sidecar.exists():
        data_sidecar.unlink()

    # ---- verification on real images (PIL pipeline identical to app.py) ----
    transform = transforms.Compose([
        transforms.Resize(RESIZE),
        transforms.CenterCrop(INPUT_SIZE),
        transforms.ToTensor(),
        transforms.Normalize(mean=MEAN, std=STD),
    ])
    sess = ort.InferenceSession(str(tmp), providers=["CPUExecutionProvider"])
    images = sorted(SAMPLES.glob("*.jpg"))
    if not images:
        print(f"[!] no sample images in {SAMPLES}; refusing to export an unverified model", file=sys.stderr)
        tmp.unlink(missing_ok=True)
        return 2
    worst = 0.0
    for p in images:
        with Image.open(p) as im:
            im = ImageOps.exif_transpose(im).convert("RGB")
            x = transform(im).unsqueeze(0)
        with torch.no_grad():
            tf, tr = model(x)
        of, orr = sess.run(None, {"input": x.numpy()})
        d = max(float(np.abs(tf.numpy() - of).max()), float(np.abs(tr.numpy() - orr).max()))
        same_top = int(tf.argmax()) == int(np.argmax(of)) and int(tr.argmax()) == int(np.argmax(orr))
        print(f"    {p.name:<16} max|logit diff| = {d:.2e}  same argmax = {same_top}")
        worst = max(worst, d)
        if not same_top:
            print(f"[x] argmax mismatch on {p.name}", file=sys.stderr)
            tmp.unlink(missing_ok=True)
            return 1
    if worst > args.tolerance:
        print(f"[x] ONNX export mismatch: {worst:.3e} > {args.tolerance:.1e}", file=sys.stderr)
        tmp.unlink(missing_ok=True)
        return 1
    tmp.replace(MODEL_OUT)
    print(f"[+] wrote {MODEL_OUT.relative_to(ROOT)} ({MODEL_OUT.stat().st_size / 1e6:.1f} MB), worst diff {worst:.2e}")

    meta = {
        "name": "freshguard",
        "architecture": "EfficientNet-B0 multitask (fruit + fresh/rotten)",
        "model_file": "freshguard.onnx",
        "model_bytes": MODEL_OUT.stat().st_size,
        "model_sha256": sha256(MODEL_OUT),
        "input": {"name": "input", "shape": [1, 3, INPUT_SIZE, INPUT_SIZE], "layout": "NCHW", "dtype": "float32"},
        "outputs": {"fruit": "fruit_logits", "fresh": "fresh_logits"},
        "fruit_names": fruit_names,
        "fresh_labels": fresh_labels,
        "fresh_index": fresh_labels.index("fresh"),
        "preprocess": {
            "resize_shorter_side": RESIZE,
            "interpolation": "bilinear (antialiased, PIL/torchvision semantics)",
            "center_crop": INPUT_SIZE,
            "mean": MEAN,
            "std": STD,
            "exif_orientation": "applied",
            "color": "RGB",
        },
        "opset": OPSET,
        "checkpoint_file": CHECKPOINT.name,
        "checkpoint_sha256": sha256(CHECKPOINT),
        "export_verification": {
            "images": [p.name for p in images],
            "max_abs_logit_diff": worst,
            "tolerance": args.tolerance,
        },
        "exported_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "versions": {"torch": torch.__version__, "onnx": onnx.__version__, "onnxruntime": ort.__version__},
    }
    META_OUT.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(f"[+] wrote {META_OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
