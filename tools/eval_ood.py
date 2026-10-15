#!/usr/bin/env python3
"""Evaluate the non-produce (out-of-distribution) score of the FreshGuard classifier. Reproducible, offline.

    python3 tools/eval_ood.py [--json out.json] [--no-onnx]

Positives: the 5 bundled sample photos x ~16 synthetic variants (tools/eval_sets.py).
Negatives: non-produce photos shipped inside scikit-image / scikit-learn / matplotlib / this repo's e2e
fixtures, plus procedural images (solid colours, gradients, noise, text, flat shapes).

READ THIS BEFORE QUOTING NUMBERS: positives come from only FIVE real photos (one per class, 5 of the 10
classes), so variants are not independent; there is no real held-out produce set; the negatives are
arbitrary and several are deliberately adversarial (abstract textures, fruit-coloured solids). Bootstrap
intervals below resample SOURCES (groups), which is the honest unit, and are still wide.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))

import eval_sets as es  # noqa: E402
import export_onnx as ex  # noqa: E402
import ood  # noqa: E402


def auroc(y: np.ndarray, s: np.ndarray) -> float:
    """Rank-based AUROC (ties count half). y: 1 = produce."""
    pos, neg = s[y == 1], s[y == 0]
    gt = (pos[:, None] > neg[None, :]).sum()
    eq = (pos[:, None] == neg[None, :]).sum()
    return float((gt + 0.5 * eq) / (len(pos) * len(neg)))


def boot_ci(y, s, groups, n=500, seed=0):
    rng = np.random.default_rng(seed)
    ug = sorted(set(groups))
    idx = {g: np.flatnonzero(groups == g) for g in ug}
    vals = []
    for _ in range(n):
        ids = np.concatenate([idx[ug[i]] for i in rng.integers(0, len(ug), len(ug))])
        if y[ids].min() == y[ids].max():
            continue
        vals.append(auroc(y[ids], s[ids]))
    return [round(float(v), 3) for v in np.percentile(vals, [2.5, 97.5])]


def lse(l):
    m = l.max(1, keepdims=True)
    return (np.log(np.exp(l - m).sum(1, keepdims=True)) + m)[:, 0]


def collect(model):
    import torch
    from torchvision import transforms
    tf = transforms.Compose([transforms.Resize(256), transforms.CenterCrop(224), transforms.ToTensor(),
                             transforms.Normalize(ex.MEAN, ex.STD)])
    rows = []
    for label, items in ((1, es.positives()), (0, es.negatives())):
        for g, n, im in items:
            x = tf(im.convert("RGB")).unsqueeze(0)
            with torch.no_grad():
                f, r = model(x)
            rows.append({"y": label, "g": g, "n": n, "lf": f[0].numpy(), "x": x.numpy()})
    return rows


def onnx_parity(rows, onnx_path):
    import onnxruntime as ort
    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    worst = 0.0
    for r in rows:
        of = sess.run(None, {"input": r["x"]})[0][0]
        worst = max(worst, abs(ood.energy_score(of) - ood.energy_score(r["lf"])))
    return worst


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json")
    ap.add_argument("--no-onnx", action="store_true")
    args = ap.parse_args()

    model, ck = ex.load_torch_model()
    rows = collect(model)
    y = np.array([r["y"] for r in rows])
    g = np.array([r["g"] for r in rows])
    names = np.array([r["n"] for r in rows])
    LF = np.stack([r["lf"] for r in rows])
    e = lse(LF)
    sm = np.exp(LF - LF.max(1, keepdims=True))
    msp = (sm / sm.sum(1, keepdims=True)).max(1)
    scores = {"energy (shipped)": e, "max-logit": LF.max(1), "max-softmax": msp}

    out = {"n_pos": int((y == 1).sum()), "n_neg": int((y == 0).sum()),
           "sources_pos": len(set(g[y == 1])), "sources_neg": len(set(g[y == 0])), "auroc": {}}
    print(f"positives: {out['n_pos']} images from {out['sources_pos']} source photos; "
          f"negatives: {out['n_neg']} images from {out['sources_neg']} sources")
    for k, s in scores.items():
        a = auroc(y, s)
        ci = boot_ci(y, s, g)
        out["auroc"][k] = {"auroc": round(a, 3), "ci95_by_source": ci}
        print(f"  AUROC {k:18s} {a:.3f}  (95% bootstrap over sources {ci[0]}..{ci[1]})")

    thr_p = ood.min_likelihood({})
    thr_e = ood.energy_from_likelihood(thr_p)
    flagged = e < thr_e
    tpr = float((~flagged[y == 1]).mean())   # positives kept as produce
    frr = 1 - tpr                              # real produce wrongly flagged
    fpr = float((~flagged[y == 0]).mean())   # non-produce wrongly accepted
    out["chosen"] = {"min_likelihood": thr_p, "energy_threshold": round(thr_e, 3), "true_accept_rate": round(tpr, 3),
                     "false_reject_rate_on_positives": round(frr, 3), "false_accept_rate_on_negatives": round(fpr, 3)}
    print(f"\nchosen threshold: likelihood >= {thr_p} (energy >= {thr_e:.2f})  [in-sample: the threshold was picked on these sets]")
    print(f"  positives accepted as produce (TPR) {tpr:.3f}   false 'not produce' on real produce {frr:.3f}")
    print(f"  negatives wrongly accepted as produce (FPR) {fpr:.3f}  ({int((~flagged[y == 0]).sum())} of {int((y == 0).sum())})")

    # per source breakdown (positives) and the accepted negatives
    print("\n  per positive source (accepted / total):")
    for s_ in sorted(set(g[y == 1])):
        m = (g == s_) & (y == 1)
        print(f"    {s_:11s} {int((~flagged[m]).sum())}/{int(m.sum())}   rejected variants: "
              f"{[n.split(':')[1] for n in names[m & flagged]]}")
    acc = (y == 0) & ~flagged
    print("  negatives wrongly accepted:", sorted({n.split(':')[0] for n in names[acc]}))

    # honest hold-out: pick the energy threshold from skimage+fixture negatives only (FPR <= 10%), test on the rest
    dev = np.array([gg.startswith(("skimage", "fixture")) for gg in g]) & (y == 0)
    test_neg = (y == 0) & ~dev
    thr_dev = float(np.quantile(e[dev], 0.90))
    hold = {"energy_threshold_from_dev_negatives": round(thr_dev, 2),
            "holdout_negatives": int(test_neg.sum()),
            "holdout_false_accept_rate": round(float((e[test_neg] >= thr_dev).mean()), 3),
            "positive_accept_rate_at_that_threshold": round(float((e[y == 1] >= thr_dev).mean()), 3)}
    out["holdout_negatives_check"] = hold
    print("\nhold-out check (threshold chosen on skimage+fixture negatives for 10% FPR, evaluated on sklearn/matplotlib/procedural negatives):")
    print("  ", hold)

    print("\n  TPR at fixed false-accept rates (energy): ", end="")
    pts = {}
    for f in (0.0, 0.05, 0.10, 0.20):
        t = np.quantile(e[y == 0], 1 - f)
        pts[str(f)] = {"energy_thr": round(float(t), 2), "tpr": round(float((e[y == 1] > t).mean()), 3)}
    out["tpr_at_fpr"] = pts
    print(pts)

    onnx_path = ex.MODEL_OUT
    if not args.no_onnx and onnx_path.is_file():
        worst = onnx_parity(rows, onnx_path)
        out["onnx_energy_parity_max_abs_diff"] = worst
        print(f"\nenergy computed from the ONNX fruit_logits vs PyTorch: max |diff| = {worst:.2e} over {len(rows)} images")

    if args.json:
        Path(args.json).write_text(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
