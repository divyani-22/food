"""Small, offline image sets shared by tools/eval_ood.py and tools/eval_shelf.py.

Everything is either bundled in the repo, bundled in a pip package (scikit-image, scikit-learn,
matplotlib) or generated procedurally with fixed seeds. There is NO real labelled produce dataset
here: the positives are the 5 bundled sample photos (apple, banana, orange, strawberry, tomato)
plus synthetic variants of them. All results computed from these sets are therefore indicative only.

Each item is (group, name, PIL.Image). `group` is the source photo/recipe, so that confidence
intervals can be bootstrapped over independent sources instead of over near-duplicate variants.
"""
from __future__ import annotations

import io
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "static" / "samples"
FIXTURES = ROOT / "e2e" / "fixtures"
SAMPLE_NAMES = ("apple", "banana", "orange", "strawberry", "tomato")

BACKGROUNDS = {"grey": (200, 200, 200), "white": (250, 250, 250), "wood": (150, 110, 70), "green": (70, 120, 70)}


def load_sample(name: str) -> Image.Image:
    return Image.open(SAMPLES / f"{name}.jpg").convert("RGB")


def _jpeg(im: Image.Image, q: int) -> Image.Image:
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=q)
    buf.seek(0)
    return Image.open(buf).convert("RGB")


def positive_variants(name: str, im: Image.Image) -> list[tuple[str, Image.Image]]:
    """Synthetic variants of one real produce photo (still the same underlying picture)."""
    w, h = im.size
    out = [("orig", im), ("hflip", im.transpose(Image.FLIP_LEFT_RIGHT)), ("rot90", im.rotate(90, expand=True)),
           ("crop70", im.crop((int(w * .15), int(h * .15), int(w * .85), int(h * .85)))),
           ("cropL", im.crop((0, 0, int(w * .7), int(h * .7)))),
           ("small", im.resize((max(64, w // 3), max(64, h // 3)), Image.BICUBIC)),
           ("jpeg35", _jpeg(im, 35)),
           ("dark", ImageEnhance.Brightness(im).enhance(0.55)),
           ("bright", ImageEnhance.Brightness(im).enhance(1.35)),
           ("blur2", im.filter(ImageFilter.GaussianBlur(2))),
           ("tilt15", im.rotate(15, expand=True, fillcolor=(128, 128, 128)))]
    for bg, rgb in BACKGROUNDS.items():
        canvas = Image.new("RGB", (int(w * 1.8), int(h * 1.8)), rgb)
        canvas.paste(im, ((canvas.width - w) // 2, (canvas.height - h) // 2))
        out.append((f"on_{bg}", canvas))
    return out


def positives() -> list[tuple[str, str, Image.Image]]:
    items = []
    for n in SAMPLE_NAMES:
        for v, im in positive_variants(n, load_sample(n)):
            items.append((n, f"{n}:{v}", im))
    return items


def _to_rgb(a: np.ndarray) -> Image.Image:
    if a.ndim == 2:
        a = np.stack([a] * 3, -1)
    if a.dtype != np.uint8:
        a = (255 * a / max(float(a.max()), 1e-9)).astype(np.uint8)
    return Image.fromarray(a[..., :3])


def natural_negatives() -> list[tuple[str, Image.Image]]:
    """Non-produce photos bundled in pip packages / the repo. Missing packages are skipped."""
    out: list[tuple[str, Image.Image]] = []
    try:
        import skimage.data as sd
        for n in ("astronaut", "camera", "chelsea", "coffee", "coins", "rocket", "page", "text", "brick", "grass",
                  "gravel", "horse", "moon", "retina", "immunohistochemistry", "hubble_deep_field", "colorwheel",
                  "cell", "clock", "logo", "checkerboard"):
            try:
                out.append((f"skimage_{n}", _to_rgb(getattr(sd, n)())))
            except Exception:
                pass
    except ImportError:
        pass
    try:
        import sklearn
        d = Path(sklearn.__file__).parent / "datasets" / "images"
        for n in ("flower", "china"):
            if (d / f"{n}.jpg").is_file():
                out.append((f"sklearn_{n}", Image.open(d / f"{n}.jpg").convert("RGB")))
    except ImportError:
        pass
    try:
        import matplotlib
        p = Path(matplotlib.get_data_path()) / "sample_data" / "grace_hopper.jpg"
        if p.is_file():
            out.append(("mpl_grace_hopper", Image.open(p).convert("RGB")))
    except ImportError:
        pass
    for p in sorted(FIXTURES.glob("*.png")):  # barcode / packaged-product images
        out.append((f"fixture_{p.stem}", Image.open(p).convert("RGB")))
    return out


def procedural_negatives(seed: int = 7) -> list[tuple[str, Image.Image]]:
    rng = np.random.default_rng(seed)
    out: list[tuple[str, Image.Image]] = []
    for i, c in enumerate([(255, 140, 0), (220, 20, 20), (250, 220, 40), (60, 160, 60), (200, 120, 60),
                           (128, 128, 128), (255, 255, 255), (0, 0, 0), (120, 70, 30), (230, 190, 150)]):
        out.append((f"solid_{i}", Image.new("RGB", (320, 320), c)))
    for i in range(6):  # gradients
        a, b = rng.integers(0, 256, 3), rng.integers(0, 256, 3)
        t = np.linspace(0, 1, 320)[None, :, None]
        g = (a[None, None] * (1 - t) + b[None, None] * t) * np.ones((320, 1, 1))
        im = Image.fromarray(g.astype(np.uint8))
        out.append((f"gradient_{i}", im if i % 2 == 0 else im.rotate(90)))
    for i in range(6):  # noise (white, and smooth blobs)
        if i % 2 == 0:
            arr = rng.integers(0, 256, (320, 320, 3), dtype=np.uint8)
        else:
            small = rng.integers(0, 256, (8, 8, 3), dtype=np.uint8)
            arr = np.asarray(Image.fromarray(small).resize((320, 320), Image.BICUBIC))
        out.append((f"noise_{i}", Image.fromarray(arr)))
    font = ImageFont.load_default()
    for i, txt in enumerate(["Nutrition Facts", "SALE 2 for 1", "Invoice #4821", "Lorem ipsum dolor sit amet"]):
        im = Image.new("RGB", (400, 300), [(255, 255, 255), (255, 230, 120), (230, 240, 255), (30, 30, 30)][i])
        dr = ImageDraw.Draw(im)
        for k in range(8):
            dr.text((10, 10 + k * 34), txt, fill=(0, 0, 0) if i < 3 else (255, 255, 255), font=font)
        out.append((f"text_{i}", im.resize((800, 600))))
    for i in range(4):  # stripes / flat circles (hard: fruit colours and round shapes, but not produce photos)
        im = Image.new("RGB", (320, 320), (240, 240, 240))
        dr = ImageDraw.Draw(im)
        if i % 2 == 0:
            for k in range(0, 320, 40):
                dr.rectangle((k, 0, k + 20, 320), fill=(200, 60 + 30 * i, 30))
        else:
            dr.ellipse((60, 60, 260, 260), fill=[(255, 140, 0), (210, 30, 30)][i // 2])
        out.append((f"shape_{i}", im))
    return out


def negatives(include_crops: bool = True) -> list[tuple[str, str, Image.Image]]:
    """(group, name, image); large natural images also contribute a center crop and a corner crop."""
    items = []
    for g, im in natural_negatives() + procedural_negatives():
        items.append((g, g, im))
        if include_crops and min(im.size) >= 200 and g.split("_")[0] in ("skimage", "sklearn", "mpl"):
            w, h = im.size
            items.append((g, g + ":crop60", im.crop((int(w * .2), int(h * .2), int(w * .8), int(h * .8)))))
            items.append((g, g + ":corner", im.crop((0, 0, int(w * .5), int(h * .5)))))
    return items


def distractor_images(n: int = 12, seed: int = 3) -> list[Image.Image]:
    """Square-ish non-produce tiles for shelf composites (natural crops first, then procedural)."""
    pool = [im for _, im in natural_negatives() if min(im.size) >= 150 and not _is_fixture(im)] + \
           [im for _, im in procedural_negatives()]
    r = random.Random(seed)
    r.shuffle(pool)
    return pool[:n]


def _is_fixture(im: Image.Image) -> bool:
    return False
