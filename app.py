import os
import sys
import io
import time
import uuid
import sqlite3
import base64
from pathlib import Path
from PIL import Image

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

import torch
import torch.nn as nn
from torchvision.models import efficientnet_b0
from torchvision import transforms
from flask import Flask, request, jsonify, render_template, send_from_directory
from flask_cors import CORS

# --- App Configuration ---
BASE_DIR = Path(__file__).resolve().parent
MODELS_DIR = BASE_DIR / "models"
MODEL_PATH = MODELS_DIR / "efficientnet_b0_freshguard_multitask.pt"
UPLOAD_FOLDER = BASE_DIR / "static" / "uploads"
UPLOAD_FOLDER.mkdir(parents=True, exist_ok=True)
DB_PATH = BASE_DIR / "freshguard.db"

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

# --- Fruit Knowledge Base ---
FRUIT_INFO = {
    "apple": {
        "kr": "사과",
        "emoji": "🍎",
        "shelf_life_days": {"fresh": 14, "normal": 4, "rotten": 0},
        "storage": "냉장 보관(0~4°C). 에틸렌 가스를 방출하므로 다른 과일과 분리하여 비닐팩에 밀봉 보관하세요.",
        "cooking_fresh": "생과일 섭취, 샐러드, 생과일 주스",
        "cooking_normal": "사과잼, 사과조림, 애플파이, 스무디",
        "cooking_rotten": "섭취 불가 (음식물 쓰레기로 폐기)"
    },
    "banana": {
        "kr": "바나나",
        "emoji": "🍌",
        "shelf_life_days": {"fresh": 5, "normal": 2, "rotten": 0},
        "storage": "상온 보관(13~16°C). 꼭지 부분을 랩으로 감싸면 에틸렌 방출을 억제해 보관 기간을 늘릴 수 있습니다.",
        "cooking_fresh": "생과일 섭취, 요거트 토핑",
        "cooking_normal": "바나나 팬케이크, 바나나 브레드, 냉동 후 스무디",
        "cooking_rotten": "섭취 불가 (과육 변색 및 부패 시 폐기)"
    },
    "bell_pepper": {
        "kr": "파프리카/피망",
        "emoji": "🫑",
        "shelf_life_days": {"fresh": 10, "normal": 3, "rotten": 0},
        "storage": "물기를 닦고 키친타월로 감싸 지퍼백에 넣어 냉장 채소칸(4~7°C)에 보관하세요.",
        "cooking_fresh": "신선 샐러드, 생채, 쌈채소",
        "cooking_normal": "파프리카 볶음, 파스타 토핑, 볶음밥",
        "cooking_rotten": "섭취 불가 (무름병 발생 시 폐기)"
    },
    "carrot": {
        "kr": "당근",
        "emoji": "🥕",
        "shelf_life_days": {"fresh": 21, "normal": 5, "rotten": 0},
        "storage": "흙을 털고 키친타월로 싼 후 비닐백에 담아 세워서 냉장 보관하세요.",
        "cooking_fresh": "당근 라페, 생당근 스틱, 주스",
        "cooking_normal": "카레, 찌개 고명, 조림, 당근전",
        "cooking_rotten": "섭취 불가 (검은 반점 및 악취 시 폐기)"
    },
    "cucumber": {
        "kr": "오이",
        "emoji": "🥒",
        "shelf_life_days": {"fresh": 7, "normal": 2, "rotten": 0},
        "storage": "물기를 제거하고 키친타월로 하나씩 감싼 후 비닐백에 넣어 냉장(7~10°C) 보관하세요.",
        "cooking_fresh": "오이 샐러드, 냉국, 생오이 무침",
        "cooking_normal": "오이 볶음, 피클, 비빔국수 토핑",
        "cooking_rotten": "섭취 불가 (표면 진물림 시 폐기)"
    },
    "mango": {
        "kr": "망고",
        "emoji": "🥭",
        "shelf_life_days": {"fresh": 6, "normal": 2, "rotten": 0},
        "storage": "후숙 전에는 상온 보관, 완숙 후에는 신문지에 싸서 냉장 보관하세요.",
        "cooking_fresh": "생망고 디저트, 망고 빙수",
        "cooking_normal": "망고 라씨, 망고 퓨레, 스무디",
        "cooking_rotten": "섭취 불가 (알코올 냄새 또는 곰팡이 발생 시 폐기)"
    },
    "orange": {
        "kr": "오렌지",
        "emoji": "🍊",
        "shelf_life_days": {"fresh": 14, "normal": 4, "rotten": 0},
        "storage": "통풍이 잘되는 서늘한 곳에 보관하거나, 개별 랩핑하여 냉장 보관하세요.",
        "cooking_fresh": "생과일 섭취, 착즙 주스",
        "cooking_normal": "오렌지 마멀레이드 잼, 과일청, 샹그리아",
        "cooking_rotten": "섭취 불가 (곰팡이 발생 시 즉시 폐기)"
    },
    "potato": {
        "kr": "감자",
        "emoji": "🥔",
        "shelf_life_days": {"fresh": 28, "normal": 7, "rotten": 0},
        "storage": "햇빛이 들지 않는 통풍 잘되는 어둡고 서늘한 상온 보관. 사과를 한 개 같이 두면 싹이 트는 것을 방지합니다.",
        "cooking_fresh": "감자 샐러드, 구운 감자, 웨지 감자",
        "cooking_normal": "감자 조림, 감자전, 찌개",
        "cooking_rotten": "섭취 불가 (초록색 변색 부위는 솔라닌 독성 주의)"
    },
    "strawberry": {
        "kr": "딸기",
        "emoji": "🍓",
        "shelf_life_days": {"fresh": 4, "normal": 1, "rotten": 0},
        "storage": "씻지 않은 상태로 키친타월을 깐 밀폐용기에 꼭지를 아래로 하여 냉장 보관하세요.",
        "cooking_fresh": "생딸기 섭취, 생과일 케이크 토핑",
        "cooking_normal": "딸기청, 수제 딸기잼, 딸기 스무디",
        "cooking_rotten": "섭취 불가 (흰 곰팡이 발생 시 즉시 폐기)"
    },
    "tomato": {
        "kr": "토마토",
        "emoji": "🍅",
        "shelf_life_days": {"fresh": 8, "normal": 3, "rotten": 0},
        "storage": "꼭지를 아래로 하여 상온 그늘진 곳에 보관. 완숙된 토마토는 냉장 보관하세요.",
        "cooking_fresh": "토마토 카프레제, 생과일 샐러드",
        "cooking_normal": "토마토 파스타 소스, 토마토 수프, 에그인헬",
        "cooking_rotten": "섭취 불가 (시큼한 악취 또는 무름 시 폐기)"
    }
}

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

def evaluate_freshness(p_fresh: float):
    # FreshGuard rule:
    # p_fresh >= 0.7 -> fresh
    # p_fresh <= 0.3 -> rotten
    # otherwise      -> normal
    if p_fresh >= 0.7:
        return {
            "status": "fresh",
            "status_kr": "신선함 (Fresh)",
            "badge_color": "emerald",
            "message": "식재료가 매우 신선한 최상의 상태입니다."
        }
    elif p_fresh <= 0.3:
        return {
            "status": "rotten",
            "status_kr": "상함/부패 (Rotten)",
            "badge_color": "rose",
            "message": "부패가 진행되었거나 상한 상태입니다. 섭취를 삼가고 폐기하세요."
        }
    else:
        return {
            "status": "normal",
            "status_kr": "보통 (Normal)",
            "badge_color": "amber",
            "message": "소비 적정기입니다. 빠른 시일 내에 조리하여 섭취하세요."
        }

def run_inference(image: Image.Image):
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
            "emoji": FRUIT_INFO.get(fname, {}).get("emoji", "🍏"),
            "probability": round(float(prob) * 100, 1)
        })
    all_fruits.sort(key=lambda x: x["probability"], reverse=True)

    status_data = evaluate_freshness(p_fresh)
    fruit_meta = FRUIT_INFO.get(fruit_code, {})
    status_key = status_data["status"]

    shelf_days = fruit_meta.get("shelf_life_days", {}).get(status_key, 3)
    cooking_guide = fruit_meta.get(f"cooking_{status_key}", "조리 후 섭취 권장")

    return {
        "fruit": fruit_code,
        "fruit_kr": fruit_meta.get("kr", fruit_code),
        "emoji": fruit_meta.get("emoji", "🍎"),
        "confidence": round(confidence * 100, 1),
        "p_fresh": round(p_fresh * 100, 1),
        "freshness_status": status_key,
        "freshness_kr": status_data["status_kr"],
        "badge_color": status_data["badge_color"],
        "status_message": status_data["message"],
        "shelf_life_days": shelf_days,
        "storage_tips": fruit_meta.get("storage", "서늘한 곳에 보관하세요."),
        "cooking_tips": cooking_guide,
        "top_candidates": all_fruits[:4]
    }

# --- Routes ---
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/predict", methods=["POST"])
def predict():
    try:
        image_data = None
        saved_filename = None

        if "file" in request.files and request.files["file"].filename != "":
            file = request.files["file"]
            ext = os.path.splitext(file.filename)[1] or ".jpg"
            saved_filename = f"{uuid.uuid4().hex}{ext}"
            file_path = UPLOAD_FOLDER / saved_filename
            file.save(file_path)
            image = Image.open(file_path)
            image_url = f"/static/uploads/{saved_filename}"

        elif request.is_json and "image" in request.json:
            raw_b64 = request.json["image"]
            if "," in raw_b64:
                raw_b64 = raw_b64.split(",")[1]
            img_bytes = base64.b64decode(raw_b64)
            image = Image.open(io.BytesIO(img_bytes))
            saved_filename = f"{uuid.uuid4().hex}.jpg"
            file_path = UPLOAD_FOLDER / saved_filename
            image.save(file_path, "JPEG")
            image_url = f"/static/uploads/{saved_filename}"

        elif "sample" in request.args or (request.is_json and "sample" in request.json):
            sample_name = request.args.get("sample") or request.json.get("sample")
            sample_path = BASE_DIR / "static" / "samples" / sample_name
            if not sample_path.exists():
                return jsonify({"error": "Sample image not found"}), 404
            image = Image.open(sample_path)
            image_url = f"/static/samples/{sample_name}"

        else:
            return jsonify({"error": "No image provided. Upload a file, send base64, or specify sample."}), 400

        result = run_inference(image)
        result["image_url"] = image_url

        # Save to scan history
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("""
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
        conn.close()

        return jsonify(result)

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/inventory", methods=["GET", "POST"])
def inventory():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    if request.method == "POST":
        data = request.json or {}
        name = data.get("name") or data.get("fruit_kr") or "식재료"
        fruit_type = data.get("fruit", "apple")
        freshness = data.get("freshness_status", "fresh")
        p_fresh = data.get("p_fresh", 90.0)
        confidence = data.get("confidence", 95.0)
        image_url = data.get("image_url", "")
        days_left = data.get("shelf_life_days", 5)
        storage_tip = data.get("storage_tips", "")
        expiry_date = data.get("expiry_date", "")

        cursor.execute("""
            INSERT INTO inventory (name, fruit_type, freshness, p_fresh, confidence, image_url, expiry_date, days_left, storage_tip)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (name, fruit_type, freshness, p_fresh, confidence, image_url, expiry_date, days_left, storage_tip))
        conn.commit()
        new_id = cursor.lastrowid
        conn.close()
        return jsonify({"success": True, "id": new_id})

    # GET inventory
    cursor.execute("SELECT * FROM inventory ORDER BY id DESC")
    rows = cursor.fetchall()
    items = [dict(row) for row in rows]
    conn.close()
    return jsonify(items)

@app.route("/api/inventory/<int:item_id>", methods=["DELETE"])
def delete_inventory_item(item_id):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM inventory WHERE id = ?", (item_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})

@app.route("/api/history", methods=["GET", "DELETE"])
def history():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    if request.method == "DELETE":
        cursor.execute("DELETE FROM scan_history")
        conn.commit()
        conn.close()
        return jsonify({"success": True})

    cursor.execute("SELECT * FROM scan_history ORDER BY id DESC LIMIT 50")
    rows = cursor.fetchall()
    items = [dict(row) for row in rows]
    conn.close()
    return jsonify(items)

@app.route("/api/fruits", methods=["GET"])
def get_fruits():
    result = []
    for code, info in FRUIT_INFO.items():
        result.append({
            "code": code,
            "name_kr": info["kr"],
            "emoji": info["emoji"],
            "storage": info["storage"],
            "shelf_life_days": info["shelf_life_days"]
        })
    return jsonify(result)

@app.route("/api/samples", methods=["GET"])
def get_samples():
    samples_dir = BASE_DIR / "static" / "samples"
    files = []
    if samples_dir.exists():
        for f in samples_dir.glob("*.jpg"):
            fruit_key = f.stem.split("_")[0]
            info = FRUIT_INFO.get(fruit_key, {})
            files.append({
                "filename": f.name,
                "label": f"{info.get('emoji', '🍎')} {info.get('kr', f.stem).capitalize()}",
                "url": f"/static/samples/{f.name}"
            })
    return jsonify(files)

if __name__ == "__main__":
    print("\n" + "="*50)
    print(" FreshGuard (식재료 신선도 판별 AI 서비스)")
    print(" Running on http://127.0.0.1:5000")
    print("="*50 + "\n")
    app.run(host="0.0.0.0", port=5000, debug=False)
