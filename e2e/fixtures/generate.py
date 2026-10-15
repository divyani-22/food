#!/usr/bin/env python3
"""
Throwaway generator for the barcode e2e fixtures. NOT part of the app's dependencies.

  python3 -m venv /tmp/barcode-fixtures-venv
  /tmp/barcode-fixtures-venv/bin/pip install python-barcode pillow numpy
  /tmp/barcode-fixtures-venv/bin/python e2e/fixtures/generate.py

Writes PNGs next to this file. The output is deterministic (seeded noise).
Barcodes are rendered by python-barcode (an independent implementation from the zxing decoder under test).
"""
import io
import pathlib
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import barcode
from barcode.writer import ImageWriter

OUT = pathlib.Path(__file__).resolve().parent
rng = np.random.default_rng(42)


def render(kind, code, no_checksum=False, module_width=0.42):
    cls = barcode.get_barcode_class(kind)
    kwargs = {"writer": ImageWriter()}
    if no_checksum:
        kwargs["no_checksum"] = True
    obj = cls(code, **kwargs)
    buf = io.BytesIO()
    obj.write(buf, options={"module_width": module_width, "module_height": 22.0, "quiet_zone": 6.5, "font_size": 10, "text_distance": 4.0, "dpi": 300})
    buf.seek(0)
    return Image.open(buf).convert("RGB")


def save(img, name):
    img.save(OUT / name, optimize=True)
    print("wrote", name, img.size)


def font(size):
    for path in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default()


# 1. clean codes
ean = render("ean13", "400638133393")  # check digit 1 appended -> 4006381333931
save(ean, "ean13-valid.png")
save(render("upca", "03600029145"), "upca-valid.png")  # -> 036000291452
save(render("ean13", "301762042200"), "ean13-unknown.png")  # 3017620422003 (not in the stub)
save(render("ean13", "890103089547"), "ean13-no-ingredients.png")  # 8901030895470
save(render("ean13", "544900000099"), "ean13-outage.png")  # 5449000000996 (stub answers 503, later recovers)
save(render("ean13", "501234567890"), "ean13-outage-hybrid.png")  # 5012345678900 (stub answers 503, never cached)

# 2. wrong check digit (4006381333932 instead of ...931)
save(render("ean13", "4006381333932", no_checksum=True), "ean13-bad-checksum.png")

# 3. rotated 90 degrees
save(ean.rotate(90, expand=True, fillcolor="white"), "ean13-rotated-90.png")

# 4. noisy + blurred
blurred = ean.filter(ImageFilter.GaussianBlur(1.3))
arr = np.asarray(blurred).astype(np.float32)
arr += rng.normal(0, 14, arr.shape)
save(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)), "ean13-noisy-blurred.png")


# 5. product photo: label text + a barcode in the lower right corner
def label(with_barcode):
    W, H = 1200, 1600
    img = Image.new("RGB", (W, H), (244, 238, 224))
    d = ImageDraw.Draw(img)
    d.rectangle([40, 40, W - 40, 260], fill=(214, 84, 30))
    d.text((80, 100), "TEST BISCUITS", font=font(90), fill="white")
    d.text((80, 300), "Crunchy butter biscuits", font=font(44), fill=(40, 40, 40))
    y = 420
    d.text((80, y), "INGREDIENTS:", font=font(46), fill=(20, 20, 20))
    lines = [
        "Wheat flour (62%), sugar, palm oil, invert sugar syrup,",
        "salt, raising agents (E500, E503), emulsifier (soy lecithin),",
        "artificial flavour (vanilla). Contains gluten and soy.",
    ]
    for i, line in enumerate(lines):
        d.text((80, y + 80 + i * 56), line, font=font(38), fill=(30, 30, 30))
    d.text((80, 760), "Net weight 200 g   Best before: see back", font=font(36), fill=(60, 60, 60))
    if with_barcode:
        bc = render("ean13", "400638133393", module_width=0.38)
        bc = bc.resize((int(bc.width * 0.62), int(bc.height * 0.62)), Image.LANCZOS)
        img.paste(bc, (W - bc.width - 70, H - bc.height - 90))
    return img


save(label(True), "product-photo-with-barcode.png")
save(label(False), "label-no-barcode.png")
