import os
import sys
import io
import time
import uuid
import sqlite3
import base64
import re
from contextlib import closing
from datetime import date, datetime, timedelta
from pathlib import Path
from PIL import Image, ImageOps

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

import torch
import torch.nn as nn
from torchvision.models import efficientnet_b0
from torchvision import transforms
from flask import Flask, request, jsonify, render_template, send_from_directory
from werkzeug.exceptions import HTTPException
from flask_cors import CORS

# --- App Configuration ---
BASE_DIR = Path(__file__).resolve().parent
MODELS_DIR = BASE_DIR / "models"
MODEL_PATH = MODELS_DIR / "efficientnet_b0_freshguard_multitask.pt"
UPLOAD_FOLDER = BASE_DIR / "static" / "uploads"
UPLOAD_FOLDER.mkdir(parents=True, exist_ok=True)
DB_PATH = BASE_DIR / "freshguard.db"
SAMPLES_DIR = BASE_DIR / "static" / "samples"
ALLOWED_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"}

app = Flask(__name__, static_folder="static", template_folder="templates")
CORS(app)
app.config["UPLOAD_FOLDER"] = str(UPLOAD_FOLDER)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # 16 MB max

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# --- Database Initialization ---
def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS inventory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            fruit_type TEXT NOT NULL,
            freshness TEXT NOT NULL,
            p_fresh REAL NOT NULL,
            confidence REAL NOT NULL,
            image_url TEXT,
            expiry_date TEXT,
            days_left INTEGER,
            storage_tip TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS scan_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fruit_type TEXT NOT NULL,
            fruit_name_kr TEXT NOT NULL,
            freshness TEXT NOT NULL,
            freshness_kr TEXT NOT NULL,
            p_fresh REAL NOT NULL,
            confidence REAL NOT NULL,
            image_url TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()

init_db()

UPLOAD_MAX_AGE_DAYS = 7
FRESHGUARD_PORT = int(os.environ.get("FRESHGUARD_PORT", "5000"))

def prune_uploads(max_age_days: int = UPLOAD_MAX_AGE_DAYS):
    """Delete old uploaded scan images that no inventory item or history row references."""
    try:
        with closing(sqlite3.connect(DB_PATH)) as conn:
            referenced = set()
            for table in ("inventory", "scan_history"):
                for (url,) in conn.execute(f"SELECT image_url FROM {table} WHERE image_url IS NOT NULL"):
                    referenced.add(os.path.basename(str(url)))
        cutoff = time.time() - max_age_days * 86400
        removed = 0
        for f in UPLOAD_FOLDER.iterdir():
            if f.is_file() and f.name != ".gitkeep" and f.name not in referenced and f.stat().st_mtime < cutoff:
                f.unlink()
                removed += 1
        return removed
    except Exception as e:
        print(f"[!] Upload cleanup skipped: {e}")
        return 0

prune_uploads()

# --- Fruit Knowledge Base (see fruit_info.py) ---
from fruit_info import (  # noqa: E402
    FRUIT_INFO,
    DEFAULT_COOKING_TIP,
    DEFAULT_SHELF_LIFE_DAYS,
    DEFAULT_STORAGE_TIP,
    evaluate_freshness,
)

# --- PyTorch MultiTask Architecture ---
class MultiTaskEffB0(nn.Module):
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
        feat = self.backbone(x)
        feat = self.dropout(feat)
        return self.head_fruit(feat), self.head_fresh(feat)

# --- Model Loader ---
print(f"[*] Loading FreshGuard model on device: {DEVICE}...")
try:
    checkpoint = torch.load(MODEL_PATH, map_location=DEVICE, weights_only=True)
except Exception:
    # Fallback for checkpoints that pickle non-tensor objects (trusted local file)
    checkpoint = torch.load(MODEL_PATH, map_location=DEVICE, weights_only=False)
FRUIT_NAMES = checkpoint["fruit_names"]
FRESH_LABELS = checkpoint["fresh_labels"]
FRESH_IDX = FRESH_LABELS.index("fresh")

model = MultiTaskEffB0(len(FRUIT_NAMES), len(FRESH_LABELS))
model.load_state_dict(checkpoint["model_state"])
model.to(DEVICE)
model.eval()
print(f"[+] FreshGuard model loaded! Fruits: {FRUIT_NAMES}")

# --- Image Preprocessing ---
inference_transform = transforms.Compose([
    transforms.Resize(256),
    transforms.CenterCrop(224),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
])

# evaluate_freshness lives in fruit_info.py (shared with the in-browser inference).

def run_inference(image: Image.Image):
    image = ImageOps.exif_transpose(image)
    image = image.convert("RGB")
    tensor = inference_transform(image).unsqueeze(0).to(DEVICE)

    with torch.no_grad():
        pf, pb = model(tensor)
        fruit_probs = torch.softmax(pf, dim=1)[0].cpu().numpy()
        fresh_probs = torch.softmax(pb, dim=1)[0].cpu().numpy()

    best_idx = int(fruit_probs.argmax())
    fruit_code = FRUIT_NAMES[best_idx]
    confidence = float(fruit_probs[best_idx])
    p_fresh = float(fresh_probs[FRESH_IDX])

    all_fruits = []
    for idx, prob in enumerate(fruit_probs):
        fname = FRUIT_NAMES[idx]
        all_fruits.append({
            "code": fname,
            "name_kr": FRUIT_INFO.get(fname, {}).get("kr", fname),
            "probability": round(float(prob) * 100, 1)
        })
    all_fruits.sort(key=lambda x: x["probability"], reverse=True)

    status_data = evaluate_freshness(p_fresh)
    fruit_meta = FRUIT_INFO.get(fruit_code, {})
    status_key = status_data["status"]

    shelf_days = fruit_meta.get("shelf_life_days", {}).get(status_key, DEFAULT_SHELF_LIFE_DAYS)
    cooking_guide = fruit_meta.get(f"cooking_{status_key}", DEFAULT_COOKING_TIP)

    return {
        "fruit": fruit_code,
        "fruit_kr": fruit_meta.get("kr", fruit_code),
        "confidence": round(confidence * 100, 1),
        "p_fresh": round(p_fresh * 100, 1),
        "freshness_status": status_key,
        "freshness_kr": status_data["status_kr"],
        "badge_color": status_data["badge_color"],
        "status_message": status_data["message"],
        "shelf_life_days": shelf_days,
        "storage_tips": fruit_meta.get("storage", DEFAULT_STORAGE_TIP),
        "cooking_tips": cooking_guide,
        "top_candidates": all_fruits[:4]
    }


# --- English-only display helpers (see legacy_text.py) ---
from legacy_text import LEGACY_KO_TO_EN, englishify, _HANGUL_RE  # noqa: F401


def _englishify_row(row):
    for key in ("name", "fruit_name_kr", "freshness_kr"):
        if key in row:
            row[key] = englishify(row[key])
    if "storage_tip" in row and isinstance(row["storage_tip"], str) and _HANGUL_RE.search(row["storage_tip"]):
        info = FRUIT_INFO.get(row.get("fruit_type") or "", {})
        row["storage_tip"] = info.get("storage", "Store in a cool place.")
    return row

# --- Routes ---
@app.route("/")
def index():
    return render_template("index.html")

def _bad_request(msg, code=400):
    return jsonify({"error": msg}), code

@app.errorhandler(HTTPException)
def handle_http_exception(e):
    # Always answer with JSON so the frontend can show e.error (e.g. 413 too large)
    return jsonify({"error": e.description or e.name}), e.code

@app.route("/api/predict", methods=["POST"])
def predict():
    saved_path = None
    try:
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            body = {}

        if "file" in request.files and request.files["file"].filename != "":
            file = request.files["file"]
            ext = os.path.splitext(file.filename)[1].lower()
            if ext not in ALLOWED_EXTS:
                ext = ".jpg"
            saved_filename = f"{uuid.uuid4().hex}{ext}"
            saved_path = UPLOAD_FOLDER / saved_filename
            file.save(saved_path)
            try:
                with Image.open(saved_path) as img:
                    img.load()
                    image = img.copy()
            except Exception:
                saved_path.unlink(missing_ok=True)
                return _bad_request("Invalid or unsupported image file.")
            image_url = f"/static/uploads/{saved_filename}"

        elif isinstance(body.get("image"), str) and body["image"]:
            raw_b64 = body["image"]
            if raw_b64.startswith("data:") and "," in raw_b64:
                raw_b64 = raw_b64.split(",", 1)[1]
            try:
                img_bytes = base64.b64decode(raw_b64, validate=False)
                with Image.open(io.BytesIO(img_bytes)) as img:
                    img.load()
                    image = img.copy()
            except Exception:
                return _bad_request("Invalid base64 image data.")
            saved_filename = f"{uuid.uuid4().hex}.jpg"
            saved_path = UPLOAD_FOLDER / saved_filename
            ImageOps.exif_transpose(image).convert("RGB").save(saved_path, "JPEG")
            image_url = f"/static/uploads/{saved_filename}"

        elif request.args.get("sample") or body.get("sample"):
            sample_name = request.args.get("sample") or body.get("sample")
            if not isinstance(sample_name, str):
                return _bad_request("Invalid sample name.")
            # Only plain file names inside static/samples are allowed (no traversal)
            sample_name = os.path.basename(sample_name.replace("\\", "/"))
            sample_path = SAMPLES_DIR / sample_name
            if not sample_name or not sample_path.is_file():
                return jsonify({"error": "Sample image not found"}), 404
            try:
                with Image.open(sample_path) as img:
                    img.load()
                    image = img.copy()
            except Exception:
                return _bad_request("Invalid sample image.")
            image_url = f"/static/samples/{sample_name}"

        else:
            return _bad_request("No image provided. Upload a file, send base64, or specify sample.")

        result = run_inference(image)
        result["image_url"] = image_url

        # Save to this service's own scan history, used only by the standalone page.
        # The IngreScan web app sends persist=0 and stores history per user in MySQL instead.
        if request.args.get("persist", "1") != "0":
            with closing(sqlite3.connect(DB_PATH)) as conn:
                conn.execute("""
                    INSERT INTO scan_history (fruit_type, fruit_name_kr, freshness, freshness_kr, p_fresh, confidence, image_url)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (
                    result["fruit"],
                    result["fruit_kr"],
                    result["freshness_status"],
                    result["freshness_kr"],
                    result["p_fresh"],
                    result["confidence"],
                    result["image_url"]
                ))
                conn.commit()

        return jsonify(result)

    except HTTPException:
        raise  # e.g. 413; handled by the JSON error handler
    except Exception as e:
        if saved_path is not None:
            saved_path.unlink(missing_ok=True)
        return jsonify({"error": str(e)}), 500

def _to_float(value, default):
    try:
        f = float(value)
    except (TypeError, ValueError):
        return default
    return f if f == f and f not in (float("inf"), float("-inf")) else default

def _days_until(expiry_date):
    """Whole days from today until expiry_date (YYYY-MM-DD); None if unparsable."""
    try:
        return (datetime.strptime(str(expiry_date)[:10], "%Y-%m-%d").date() - date.today()).days
    except ValueError:
        return None

@app.route("/api/inventory", methods=["GET", "POST"])
def inventory():
    if request.method == "POST":
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return _bad_request("JSON object body required.")
        name = englishify(str(data.get("name") or data.get("fruit_kr") or "Produce"))
        fruit_type = str(data.get("fruit") or "apple")
        freshness = data.get("freshness_status", "fresh")
        if freshness not in ("fresh", "normal", "rotten"):
            return _bad_request("freshness_status must be fresh, normal or rotten.")
        p_fresh = min(max(_to_float(data.get("p_fresh"), 90.0), 0.0), 100.0)
        confidence = min(max(_to_float(data.get("confidence"), 95.0), 0.0), 100.0)
        image_url = str(data.get("image_url") or "")
        storage_tip = str(data.get("storage_tips") or "")

        expiry_date = str(data.get("expiry_date") or "")[:10]
        days_left = _days_until(expiry_date) if expiry_date else None
        if days_left is None:
            days_left = int(_to_float(data.get("shelf_life_days"), 5))
            expiry_date = (date.today() + timedelta(days=max(days_left, 0))).isoformat()
        days_left = max(days_left, 0)

        with closing(sqlite3.connect(DB_PATH)) as conn:
            cursor = conn.execute("""
                INSERT INTO inventory (name, fruit_type, freshness, p_fresh, confidence, image_url, expiry_date, days_left, storage_tip)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (name, fruit_type, freshness, p_fresh, confidence, image_url, expiry_date, days_left, storage_tip))
            conn.commit()
            new_id = cursor.lastrowid
        return jsonify({"success": True, "id": new_id})

    # GET inventory
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT * FROM inventory ORDER BY id DESC").fetchall()
    items = [_englishify_row(dict(row)) for row in rows]
    for item in items:
        # days_left was a snapshot at save time; recompute from the expiry date
        remaining = _days_until(item["expiry_date"]) if item.get("expiry_date") else None
        if remaining is not None:
            item["days_left"] = max(remaining, 0)
    return jsonify(items)

@app.route("/api/inventory/<int:item_id>", methods=["DELETE"])
def delete_inventory_item(item_id):
    with closing(sqlite3.connect(DB_PATH)) as conn:
        cur = conn.execute("DELETE FROM inventory WHERE id = ?", (item_id,))
        conn.commit()
        deleted = cur.rowcount
    if not deleted:
        return jsonify({"error": "Item not found"}), 404
    return jsonify({"success": True})

@app.route("/api/history", methods=["GET", "DELETE"])
def history():
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.row_factory = sqlite3.Row
        if request.method == "DELETE":
            conn.execute("DELETE FROM scan_history")
            conn.commit()
            return jsonify({"success": True})
        rows = conn.execute("SELECT * FROM scan_history ORDER BY id DESC LIMIT 50").fetchall()
    return jsonify([_englishify_row(dict(row)) for row in rows])

@app.route("/api/fruits", methods=["GET"])
def get_fruits():
    result = []
    for code, info in FRUIT_INFO.items():
        result.append({
            "code": code,
            "name_kr": info["kr"],
            "storage": info["storage"],
            "shelf_life_days": info["shelf_life_days"]
        })
    return jsonify(result)

@app.route("/api/samples", methods=["GET"])
def get_samples():
    samples_dir = BASE_DIR / "static" / "samples"
    files = []
    if samples_dir.exists():
        for f in sorted(samples_dir.glob("*.jpg")):
            fruit_key = f.stem.split("_")[0]
            info = FRUIT_INFO.get(fruit_key, {})
            files.append({
                "filename": f.name,
                "label": info.get("kr", f.stem.replace("_", " ").title()),
                "url": f"/static/samples/{f.name}"
            })
    return jsonify(files)

if __name__ == "__main__":
    print("\n" + "="*50)
    print(" FreshGuard (produce freshness AI service)")
    print(f" Running on http://127.0.0.1:{FRESHGUARD_PORT}")
    print("="*50 + "\n")
    app.run(host="127.0.0.1", port=FRESHGUARD_PORT, debug=False)
