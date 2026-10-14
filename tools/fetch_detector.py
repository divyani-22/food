"""Download the YOLOX-S COCO detector (Apache-2.0) used by /api/detect into models/detector/.

    python tools/fetch_detector.py

Needs only the Python standard library. The file is verified against a pinned SHA-256 and is NOT
committed to git (models/detector/ is ignored).
"""
import hashlib
import sys
import urllib.request
from pathlib import Path

URL = "https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_s.onnx"
SHA256 = "c5c2d13e59ae883e6af3b45daea64af4833a4951c92d116ec270d9ddbe998063"
DEST = Path(__file__).resolve().parent.parent / "models" / "detector" / "yolox_s.onnx"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    DEST.parent.mkdir(parents=True, exist_ok=True)
    if DEST.is_file() and sha256(DEST) == SHA256:
        print(f"Already installed and verified: {DEST}")
        return 0
    tmp = DEST.with_suffix(".part")
    print(f"Downloading {URL}")
    urllib.request.urlretrieve(URL, tmp)
    if sha256(tmp) != SHA256:
        tmp.unlink(missing_ok=True)
        print("Checksum mismatch; download discarded.", file=sys.stderr)
        return 1
    tmp.replace(DEST)
    print(f"Installed {DEST} ({DEST.stat().st_size / 1e6:.1f} MB, Apache-2.0, YOLOX by Megvii)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
