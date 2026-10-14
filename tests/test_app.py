import base64
import io
import sys
import types
from datetime import date, timedelta

import numpy as np
import pytest
from PIL import Image

ROOT = __file__.rsplit("/tests/", 1)[0]
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


class FakeT:
    def __init__(self, a):
        self.a = np.asarray(a, dtype=float)

    def __getitem__(self, i):
        return FakeT(self.a[i])

    def cpu(self):
        return self

    def numpy(self):
        return self.a

    def unsqueeze(self, _):
        return self

    def to(self, _):
        return self


def _install_fake_torch():
    """Lightweight stand-ins so app.py imports without torch/torchvision."""
    torch = types.ModuleType("torch")
    torch.cuda = types.SimpleNamespace(is_available=lambda: False)

    class NoGrad:
        def __enter__(self): return self
        def __exit__(self, *a): return False
    torch.no_grad = NoGrad

    def softmax(x, dim=1):
        e = np.exp(x.a - x.a.max(axis=dim, keepdims=True))
        return FakeT(e / e.sum(axis=dim, keepdims=True))
    torch.softmax = softmax
    names = ["apple", "banana", "bell_pepper", "carrot", "cucumber",
             "mango", "orange", "potato", "strawberry", "tomato"]
    torch.load = lambda *a, **k: {"fruit_names": names, "fresh_labels": ["rotten", "fresh"],
                                  "model_state": {}}

    nn = types.ModuleType("torch.nn")

    class Module:
        def __call__(self, *a): return self.forward(*a)
        def load_state_dict(self, *_): pass
        def to(self, *_): return self
        def eval(self): return self
    nn.Module = Module
    nn.Identity = lambda: None
    nn.Dropout = lambda p: None
    nn.Linear = lambda a, b: None
    torch.nn = nn

    tv = types.ModuleType("torchvision")
    models = types.ModuleType("torchvision.models")
    models.efficientnet_b0 = lambda weights=None: types.SimpleNamespace(
        classifier=[None, types.SimpleNamespace(in_features=4)])
    tr = types.ModuleType("torchvision.transforms")
    tr.Compose = lambda ts: (lambda img: FakeT(np.zeros((3, 224, 224))))
    tr.Resize = tr.CenterCrop = tr.ToTensor = lambda *a, **k: None
    tr.Normalize = lambda **k: None
    tv.models, tv.transforms = models, tr
    sys.modules.update({"torch": torch, "torch.nn": nn, "torchvision": tv,
                        "torchvision.models": models, "torchvision.transforms": tr})


try:
    import torch  # noqa: F401
    import torchvision  # noqa: F401
    import torch as _t
    HAVE_TORCH = True
except ImportError:
    HAVE_TORCH = False
    _install_fake_torch()


@pytest.fixture(scope="module")
def appmod(tmp_path_factory):
    if HAVE_TORCH:
        pytest.skip("real torch present; tests target the stubbed model path")
    import app as m
    return m


@pytest.fixture
def client(appmod, tmp_path, monkeypatch):
    monkeypatch.setattr(appmod, "DB_PATH", tmp_path / "t.db")
    monkeypatch.setattr(appmod, "UPLOAD_FOLDER", tmp_path / "up")
    (tmp_path / "up").mkdir()
    appmod.init_db()
    # logits: apple strongly, p_fresh ~ 0.9 ("fresh" is index 1)
    monkeypatch.setattr(appmod, "model", lambda t: (FakeT([[5, 0, 0, 0, 0, 0, 0, 0, 0, 0]]),
                                                    FakeT([[0.0, 2.2]])))
    appmod.app.config["TESTING"] = True
    c = appmod.app.test_client()
    c.up = tmp_path / "up"
    return c


def png_bytes(mode="RGB"):
    buf = io.BytesIO()
    Image.new(mode, (40, 30), "red").save(buf, "PNG")
    return buf.getvalue()


# ---- predict ----
def test_predict_no_input(client):
    r = client.post("/api/predict")
    assert r.status_code == 400 and "error" in r.get_json()


def test_predict_malformed_and_non_dict_json(client):
    assert client.post("/api/predict", data="{bad", content_type="application/json").status_code == 400
    assert client.post("/api/predict", json=[1, 2]).status_code == 400


def test_predict_upload_ok_and_unsafe_ext_sanitized(client):
    r = client.post("/api/predict", data={"file": (io.BytesIO(png_bytes()), "x.html")})
    assert r.status_code == 200, r.get_json()
    d = r.get_json()
    assert d["fruit"] == "apple" and d["freshness_status"] == "fresh"
    assert d["image_url"].endswith(".jpg")
    assert len(list(client.up.iterdir())) == 1


def test_predict_bad_image_is_400_and_file_removed(client):
    r = client.post("/api/predict", data={"file": (io.BytesIO(b"not an image"), "a.png")})
    assert r.status_code == 400
    assert list(client.up.iterdir()) == []


def test_predict_base64(client):
    b64 = "data:image/png;base64," + base64.b64encode(png_bytes("RGBA")).decode()
    r = client.post("/api/predict", json={"image": b64})
    assert r.status_code == 200, r.get_json()


def test_predict_bad_base64_and_non_string(client):
    assert client.post("/api/predict", json={"image": "!!!"}).status_code == 400
    assert client.post("/api/predict", json={"image": 123}).status_code == 400


@pytest.mark.parametrize("name", ["../../app.py", "..\\app.py", "/etc/passwd", "nope.jpg", "."])
def test_predict_sample_traversal_rejected(client, name):
    r = client.post("/api/predict", json={"sample": name})
    assert r.status_code == 404


def test_predict_sample_ok(client):
    r = client.post("/api/predict?sample=apple.jpg")
    assert r.status_code == 200
    assert r.get_json()["image_url"] == "/static/samples/apple.jpg"


def test_too_large_returns_json(client, appmod, monkeypatch):
    monkeypatch.setitem(appmod.app.config, "MAX_CONTENT_LENGTH", 100)
    r = client.post("/api/predict", data={"file": (io.BytesIO(b"x" * 1000), "a.jpg")})
    assert r.status_code == 413 and "error" in r.get_json()


def test_freshness_thresholds(appmod):
    assert appmod.evaluate_freshness(0.7)["status"] == "fresh"
    assert appmod.evaluate_freshness(0.69)["status"] == "normal"
    assert appmod.evaluate_freshness(0.3)["status"] == "rotten"


# ---- inventory ----
def test_inventory_rejects_non_json_and_bad_status(client):
    assert client.post("/api/inventory", data="x").status_code == 400
    assert client.post("/api/inventory", json={"freshness_status": "weird"}).status_code == 400


def test_inventory_non_numeric_and_expiry_computed(client):
    r = client.post("/api/inventory", json={"name": "A", "p_fresh": "abc", "confidence": None,
                                            "shelf_life_days": "x", "freshness_status": "normal"})
    assert r.status_code == 200
    item = client.get("/api/inventory").get_json()[0]
    assert item["p_fresh"] == 90.0 and item["days_left"] == 5
    assert item["expiry_date"] == (date.today() + timedelta(days=5)).isoformat()


def test_inventory_days_left_recomputed_from_expiry(client):
    exp = (date.today() + timedelta(days=3)).isoformat()
    client.post("/api/inventory", json={"name": "B", "expiry_date": exp, "shelf_life_days": 99})
    assert client.get("/api/inventory").get_json()[0]["days_left"] == 3
    past = (date.today() - timedelta(days=2)).isoformat()
    client.post("/api/inventory", json={"name": "C", "expiry_date": past})
    assert client.get("/api/inventory").get_json()[0]["days_left"] == 0


def test_inventory_bad_expiry_falls_back(client):
    client.post("/api/inventory", json={"name": "D", "expiry_date": "garbage", "shelf_life_days": 2})
    assert client.get("/api/inventory").get_json()[0]["days_left"] == 2


def test_inventory_negative_days_clamped(client):
    client.post("/api/inventory", json={"shelf_life_days": -4})
    assert client.get("/api/inventory").get_json()[0]["days_left"] == 0


def test_delete_missing_item_404(client):
    assert client.delete("/api/inventory/9999").status_code == 404
    iid = client.post("/api/inventory", json={"name": "E"}).get_json()["id"]
    assert client.delete(f"/api/inventory/{iid}").status_code == 200


# ---- history / misc ----
def test_history_roundtrip(client):
    client.post("/api/predict?sample=apple.jpg")
    assert len(client.get("/api/history").get_json()) == 1
    assert client.delete("/api/history").get_json()["success"]
    assert client.get("/api/history").get_json() == []


def test_samples_and_fruits(client):
    assert client.get("/api/fruits").status_code == 200
    files = [s["filename"] for s in client.get("/api/samples").get_json()]
    assert files == sorted(files)
    assert client.get("/").status_code == 200


def test_prune_uploads_removes_only_old_unreferenced(client, appmod):
    import os, sqlite3, time
    up = appmod.UPLOAD_FOLDER
    up.mkdir(exist_ok=True)
    old_free, old_kept, fresh_new = up / "a.jpg", up / "b.jpg", up / "c.jpg"
    for f in (old_free, old_kept, fresh_new):
        f.write_bytes(b"x")
    old = time.time() - 30 * 86400
    os.utime(old_free, (old, old))
    os.utime(old_kept, (old, old))
    with sqlite3.connect(appmod.DB_PATH) as conn:
        conn.execute(
            "INSERT INTO inventory (name, fruit_type, freshness, p_fresh, confidence, image_url, expiry_date, days_left, storage_tip)"
            " VALUES ('n','apple','fresh',90,90,'/static/uploads/b.jpg','2099-01-01',10,'')"
        )
    assert appmod.prune_uploads(7) == 1
    assert not old_free.exists() and old_kept.exists() and fresh_new.exists()
