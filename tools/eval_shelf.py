#!/usr/bin/env python3
"""Reproducible before/after evaluation of shelf mode (POST /api/detect) on synthetic composites.

    python3 tools/eval_shelf.py [--per-layout 6] [--json out.json] [--configs baseline,default,second_pass,second_pass_loose]

Composite shelf images are built from the 5 bundled sample photos (apple, banana, orange, strawberry, tomato)
pasted at several layouts/scales on plain backgrounds, together with NON-produce distractor tiles from
tools/eval_sets.py. Ground-truth boxes are the pasted tiles.

Configurations (all run through the real Flask route with the real classifier and YOLOX detector):
  baseline     PRODUCE_MIN_LIKELIHOOD=0 SHELF_CHECKS=0 SHELF_SECOND_PASS=0  (behaviour before this change)
  default      shipped defaults (OOD gate + consistency checks)
  second_pass  default + SHELF_SECOND_PASS=1 (extra windows need produce likelihood >= 0.9 and confidence >= 90%)
  second_pass_loose  same with the extra-window likelihood bar lowered to 0.5

Metrics. A prediction is a TRUE POSITIVE if >= 60% of its box lies inside a ground-truth tile of the same class that has no
TP yet. Everything else is a false positive (wrong label on a real tile / on a distractor / spurious). "Accepted"
counts only items the web app would tick by default (needs_check == false); "all returned" counts every listed item.

LIMITS: only 5 distinct source photos (the classifier very likely saw similar images in training), pasted tiles
with clean backgrounds are far easier than a real shelf, and the tiles carry their own photo background. These
numbers show relative effects of the changes, not real-world accuracy.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))

import eval_sets as es  # noqa: E402

CLASSES = list(es.SAMPLE_NAMES)
# The classifier can answer with any of its 10 fruits; counters cover all of them (only 5 occur as ground truth).
ALL_FRUITS = ["apple", "banana", "bell_pepper", "carrot", "cucumber", "mango", "orange", "potato", "strawberry", "tomato"]
CANVAS = (1400, 1000)
BACKGROUNDS = [(238, 238, 234), (214, 200, 180), (250, 250, 250), (120, 130, 140)]
LAYOUTS = ("row", "grid", "scatter", "small", "dense")

CONFIGS = {
    "baseline": {"PRODUCE_MIN_LIKELIHOOD": "0", "SHELF_CHECKS": "0", "SHELF_SECOND_PASS": "0"},
    "default": {"PRODUCE_MIN_LIKELIHOOD": "", "SHELF_CHECKS": "", "SHELF_SECOND_PASS": ""},
    "second_pass": {"PRODUCE_MIN_LIKELIHOOD": "", "SHELF_CHECKS": "", "SHELF_SECOND_PASS": "1"},
    # same, but extra proposals only need the normal 0.5 produce likelihood (to see what the strict bar is buying)
    "second_pass_loose": {"PRODUCE_MIN_LIKELIHOOD": "", "SHELF_CHECKS": "", "SHELF_SECOND_PASS": "1",
                          "SHELF_SECOND_PASS_MIN_LIKELIHOOD": "0.5"},
}


def _fit(im: Image.Image, side: int) -> Image.Image:
    im = im.convert("RGB").copy()
    im.thumbnail((side, side))
    return im


def _slots(layout: str, rnd: random.Random):
    W, H = CANVAS
    if layout == "row":
        n = rnd.choice([4, 5])
        s = (W - 80) // n - 20
        return [((40 + i * (s + 20), (H - s) // 2 + rnd.randint(-40, 40)), s) for i in range(n)]
    if layout == "grid":
        s = 300
        return [((60 + c * (s + 80), 70 + r * (s + 100)), s) for r in range(2) for c in range(4)]
    if layout == "small":
        s = 170
        return [((80 + c * 250 + rnd.randint(-15, 15), 120 + r * 280 + rnd.randint(-15, 15)), s) for r in range(3) for c in range(5)]
    if layout == "dense":
        s = 215
        return [((30 + c * 225, 40 + r * 235), s) for r in range(4) for c in range(6)][:20]
    slots, tries = [], 0   # scatter: random sizes without overlap
    while len(slots) < 8 and tries < 400:
        tries += 1
        s = rnd.choice([180, 240, 300, 360])
        x, y = rnd.randint(10, W - s - 10), rnd.randint(10, H - s - 10)
        if all(x + s + 15 <= ox or ox + os_ + 15 <= x or y + s + 15 <= oy or oy + os_ + 15 <= y
               for (ox, oy), os_ in slots):
            slots.append(((x, y), s))
    return slots


def make_composite(layout: str, seed: int, with_distractors: bool = True):
    """Returns (PIL image, [{'box': [x1,y1,x2,y2], 'kind': 'produce'|'distractor', 'label': class|None}])."""
    rnd = random.Random(f"{layout}-{seed}")
    canvas = Image.new("RGB", CANVAS, rnd.choice(BACKGROUNDS))
    slots = _slots(layout, rnd)
    distractors = es.distractor_images(n=40, seed=seed)
    n_dis = rnd.choice([2, 3]) if with_distractors else 0
    dis_slots = set(rnd.sample(range(len(slots)), min(n_dis, len(slots))))
    gts = []
    for i, ((x, y), side) in enumerate(slots):
        if i in dis_slots:
            tile, kind, label = _fit(rnd.choice(distractors), side), "distractor", None
        else:
            label = CLASSES[(i + seed) % len(CLASSES)]
            tile, kind = _fit(es.load_sample(label), side), "produce"
            if rnd.random() < 0.5:
                tile = tile.transpose(Image.FLIP_LEFT_RIGHT)
        canvas.paste(tile, (x, y))
        gts.append({"box": [x, y, x + tile.width, y + tile.height], "kind": kind, "label": label})
    return canvas, gts


def inside(pred, tile):
    """Fraction of the predicted box that lies inside the ground-truth tile."""
    ix = max(0, min(pred[2], tile[2]) - max(pred[0], tile[0]))
    iy = max(0, min(pred[3], tile[3]) - max(pred[1], tile[1]))
    area = (pred[2] - pred[0]) * (pred[3] - pred[1])
    return ix * iy / area if area > 0 else 0.0


def iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / ua if ua > 0 else 0.0


def score_image(preds, gts, thr=0.6):
    """preds: [{'box': xyxy, 'fruit': str}]. Returns counters per class + fp breakdown.

    A prediction belongs to the ground-truth tile that contains at least `thr` of its area (the sample photos are
    pasted whole, with their own background, so a tight fruit box is much smaller than the tile and IoU would
    unfairly punish it). Only the first prediction in a produce tile with the right label is a TP; further
    predictions in the same tile are spurious duplicates.
    """
    tp = {c: 0 for c in ALL_FRUITS}
    fp = {c: 0 for c in ALL_FRUITS}
    fn = {c: 0 for c in ALL_FRUITS}
    fp_kind = {"distractor": 0, "wrong_label": 0, "spurious": 0}
    got = set()
    for p in preds:
        best, bi = 0.0, -1
        for j, g in enumerate(gts):
            v = inside(p["box"], g["box"])
            if v > best:
                best, bi = v, j
        if bi < 0 or best < thr:
            fp[p["fruit"]] += 1
            fp_kind["spurious"] += 1
            continue
        g = gts[bi]
        if g["kind"] == "distractor":
            fp[p["fruit"]] += 1
            fp_kind["distractor"] += 1
        elif g["label"] != p["fruit"]:
            fp[p["fruit"]] += 1
            fp_kind["wrong_label"] += 1
        elif bi in got:
            fp[p["fruit"]] += 1
            fp_kind["spurious"] += 1
        else:
            tp[p["fruit"]] += 1
            got.add(bi)
    for j, g in enumerate(gts):
        if g["kind"] == "produce" and j not in got:
            fn[g["label"]] += 1
    return tp, fp, fn, fp_kind


def summarize(tp, fp, fn, fp_kind):
    per = {}
    for c in ALL_FRUITS:
        p = tp[c] / (tp[c] + fp[c]) if tp[c] + fp[c] else None
        r = tp[c] / (tp[c] + fn[c]) if tp[c] + fn[c] else None   # None: class never occurs as ground truth
        per[c] = {"tp": tp[c], "fp": fp[c], "fn": fn[c],
                  "precision": None if p is None else round(p, 3), "recall": None if r is None else round(r, 3)}
    T, F, N = sum(tp.values()), sum(fp.values()), sum(fn.values())
    return {"per_class": per, "tp": T, "fp": F, "fn": N, "fp_kinds": fp_kind,
            "precision": round(T / (T + F), 3) if T + F else None, "recall": round(T / (T + N), 3) if T + N else None}


def run(client, app_mod, cfg_env, composites):
    tmp = Path(tempfile.mkdtemp(prefix="evalshelf-"))
    old_up = app_mod.UPLOAD_FOLDER
    app_mod.UPLOAD_FOLDER = tmp
    saved_env = {k: os.environ.get(k) for k in cfg_env}
    for k, v in cfg_env.items():
        if v == "":
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    acc = {m: ({c: 0 for c in ALL_FRUITS}, {c: 0 for c in ALL_FRUITS}, {c: 0 for c in ALL_FRUITS},
               {"distractor": 0, "wrong_label": 0, "spurious": 0}) for m in ("accepted", "all")}
    extra = {"rejected_not_produce": 0, "rejected_low_conf": 0, "second_pass_items": 0, "needs_check": 0, "returned": 0}
    try:
        import io
        for img, gts in composites:
            buf = io.BytesIO()
            img.save(buf, "JPEG", quality=92)
            r = client.post("/api/detect", data={"file": (io.BytesIO(buf.getvalue()), "c.jpg")})
            d = r.get_json()
            if r.status_code != 200:
                raise SystemExit(f"/api/detect failed: {r.status_code} {d}")
            items = [{"box": [i["box"]["x"], i["box"]["y"], i["box"]["x"] + i["box"]["w"], i["box"]["y"] + i["box"]["h"]],
                      "fruit": i["fruit"], "check": i.get("needs_check", False), "src": i.get("source", "detector")}
                     for i in d["items"]]
            extra["returned"] += len(items)
            extra["needs_check"] += sum(i["check"] for i in items)
            extra["second_pass_items"] += sum(i["src"] == "second_pass" for i in items)
            extra["rejected_not_produce"] += sum(x.get("reason") == "not_produce" for x in d["rejected"])
            extra["rejected_low_conf"] += sum(x.get("reason") == "low_classifier_confidence" for x in d["rejected"])
            for mode, sel in (("accepted", [i for i in items if not i["check"]]), ("all", items)):
                tp, fp, fn, fk = score_image(sel, gts)
                for a, b in zip(acc[mode], (tp, fp, fn, fk)):
                    for k, v in b.items():
                        a[k] += v
    finally:
        app_mod.UPLOAD_FOLDER = old_up
        for k, v in saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        for f in tmp.iterdir():
            f.unlink()
        tmp.rmdir()
    return {m: summarize(*acc[m]) for m in acc} | {"extra": extra}


def fmt(v):
    return "  -  " if v is None else f"{v:.2f}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-layout", type=int, default=6)
    ap.add_argument("--configs", default="baseline,default,second_pass,second_pass_loose")
    ap.add_argument("--json")
    ap.add_argument("--save-dir", help="also write the composites (png) and ground truth (json) here")
    args = ap.parse_args()

    composites = [make_composite(l, s) for l in LAYOUTS for s in range(args.per_layout)]
    n_prod = sum(g["kind"] == "produce" for _, gts in composites for g in gts)
    n_dis = sum(g["kind"] == "distractor" for _, gts in composites for g in gts)
    print(f"{len(composites)} composites ({len(LAYOUTS)} layouts x {args.per_layout}), {n_prod} produce tiles, {n_dis} non-produce distractors")
    if args.save_dir:
        out = Path(args.save_dir)
        out.mkdir(parents=True, exist_ok=True)
        for i, (im, gts) in enumerate(composites):
            im.save(out / f"composite_{i:03d}.png")
            (out / f"composite_{i:03d}.json").write_text(json.dumps(gts))

    import app as app_mod
    app_mod.app.config["TESTING"] = True
    client = app_mod.app.test_client()
    results = {}
    for name in args.configs.split(","):
        print(f"\n== {name}: {CONFIGS[name]}")
        res = run(client, app_mod, CONFIGS[name], composites)
        results[name] = res
        for mode in ("accepted", "all"):
            r = res[mode]
            print(f"  [{mode}] precision {fmt(r['precision'])} recall {fmt(r['recall'])}  tp {r['tp']} fp {r['fp']} fn {r['fn']}  fp kinds {r['fp_kinds']}")
            print("    " + " ".join(f"{c[:7]:>7}" for c in ALL_FRUITS))
            print("  P " + " ".join(f"{fmt(r['per_class'][c]['precision']):>7}" for c in ALL_FRUITS))
            print("  R " + " ".join(f"{fmt(r['per_class'][c]['recall']):>7}" for c in ALL_FRUITS))
            print("  FP" + " ".join(f"{r['per_class'][c]['fp']:>7}" for c in ALL_FRUITS))
        print("  extra:", res["extra"])
    if args.json:
        Path(args.json).write_text(json.dumps({"produce_tiles": n_prod, "distractors": n_dis, "results": results}, indent=2))


if __name__ == "__main__":
    main()
