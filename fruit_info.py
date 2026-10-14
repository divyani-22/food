"""Produce knowledge base: names, shelf life, storage and cooking tips (English)."""

FRUIT_INFO = {
    "apple": {
        "kr": "Apple",
        "shelf_life_days": {"fresh": 14, "normal": 4, "rotten": 0},
        "storage": "Refrigerate at 0–4°C. Apples release ethylene gas, so seal them in a bag away from other fruit.",
        "cooking_fresh": "Eat fresh, in salads or as fresh juice",
        "cooking_normal": "Apple jam, stewed apples, apple pie, smoothies",
        "cooking_rotten": "Not safe to eat (discard as food waste)"
    },
    "banana": {
        "kr": "Banana",
        "shelf_life_days": {"fresh": 5, "normal": 2, "rotten": 0},
        "storage": "Keep at room temperature (13–16°C). Wrapping the stem in cling film slows ethylene release and extends shelf life.",
        "cooking_fresh": "Eat fresh or as a yogurt topping",
        "cooking_normal": "Banana pancakes, banana bread, freeze for smoothies",
        "cooking_rotten": "Not safe to eat (discard if the flesh is discoloured or rotting)"
    },
    "bell_pepper": {
        "kr": "Bell Pepper",
        "shelf_life_days": {"fresh": 10, "normal": 3, "rotten": 0},
        "storage": "Pat dry, wrap in a paper towel, seal in a zip bag and keep in the fridge crisper (4–7°C).",
        "cooking_fresh": "Fresh salads, crudités, lettuce wraps",
        "cooking_normal": "Stir-fries, pasta topping, fried rice",
        "cooking_rotten": "Not safe to eat (discard if soft rot appears)"
    },
    "carrot": {
        "kr": "Carrot",
        "shelf_life_days": {"fresh": 21, "normal": 5, "rotten": 0},
        "storage": "Brush off soil, wrap in a paper towel, place in a bag and store upright in the fridge.",
        "cooking_fresh": "Carrot salad, raw carrot sticks, juice",
        "cooking_normal": "Curry, soup garnish, braised carrots, carrot fritters",
        "cooking_rotten": "Not safe to eat (discard if black spots or a bad smell appear)"
    },
    "cucumber": {
        "kr": "Cucumber",
        "shelf_life_days": {"fresh": 7, "normal": 2, "rotten": 0},
        "storage": "Dry well, wrap each one in a paper towel, bag and refrigerate at 7–10°C.",
        "cooking_fresh": "Cucumber salad, chilled soup, quick pickled salad",
        "cooking_normal": "Stir-fried cucumber, pickles, cold noodle topping",
        "cooking_rotten": "Not safe to eat (discard if the skin turns slimy)"
    },
    "mango": {
        "kr": "Mango",
        "shelf_life_days": {"fresh": 6, "normal": 2, "rotten": 0},
        "storage": "Ripen at room temperature, then wrap in paper and refrigerate once fully ripe.",
        "cooking_fresh": "Fresh mango desserts, mango shaved ice",
        "cooking_normal": "Mango lassi, mango purée, smoothies",
        "cooking_rotten": "Not safe to eat (discard if it smells alcoholic or shows mould)"
    },
    "orange": {
        "kr": "Orange",
        "shelf_life_days": {"fresh": 14, "normal": 4, "rotten": 0},
        "storage": "Store in a cool, well-ventilated place, or wrap individually and refrigerate.",
        "cooking_fresh": "Eat fresh or as fresh-squeezed juice",
        "cooking_normal": "Orange marmalade, fruit syrup, sangria",
        "cooking_rotten": "Not safe to eat (discard immediately if mould appears)"
    },
    "potato": {
        "kr": "Potato",
        "shelf_life_days": {"fresh": 28, "normal": 7, "rotten": 0},
        "storage": "Store in a dark, cool, well-ventilated place at room temperature. Keeping an apple with them helps stop sprouting.",
        "cooking_fresh": "Potato salad, baked potatoes, potato wedges",
        "cooking_normal": "Braised potatoes, potato pancakes, stews",
        "cooking_rotten": "Not safe to eat (green patches contain toxic solanine)"
    },
    "strawberry": {
        "kr": "Strawberry",
        "shelf_life_days": {"fresh": 4, "normal": 1, "rotten": 0},
        "storage": "Do not wash. Place stem-side down on a paper towel in a sealed container and refrigerate.",
        "cooking_fresh": "Eat fresh or as a cake topping",
        "cooking_normal": "Strawberry syrup, homemade jam, smoothies",
        "cooking_rotten": "Not safe to eat (discard immediately if white mould appears)"
    },
    "tomato": {
        "kr": "Tomato",
        "shelf_life_days": {"fresh": 8, "normal": 3, "rotten": 0},
        "storage": "Store stem-side down in a shaded spot at room temperature. Refrigerate once fully ripe.",
        "cooking_fresh": "Caprese salad, fresh salads",
        "cooking_normal": "Tomato pasta sauce, tomato soup, shakshuka",
        "cooking_rotten": "Not safe to eat (discard if sour-smelling or mushy)"
    }
}


# ---------------------------------------------------------------------------
# Freshness rules and result defaults.
#
# Single source of truth shared by the Flask service (app.py) and the in-browser
# ONNX inference (IngreScan-AI/client/src/lib/fruitInfo.json, generated from this
# module by tools/export_onnx.py; tests/test_onnx_export.py fails when it is stale).
# ---------------------------------------------------------------------------

FRESH_THRESHOLD = 0.7   # p_fresh >= 0.7 -> fresh
ROTTEN_THRESHOLD = 0.3  # p_fresh <= 0.3 -> rotten, anything in between -> normal

FRESHNESS_STATUSES = {
    "fresh": {
        "status_kr": "Fresh",
        "badge_color": "emerald",
        "message": "This produce is in excellent, fresh condition.",
    },
    "rotten": {
        "status_kr": "Rotten",
        "badge_color": "rose",
        "message": "Spoilage has set in. Do not eat it; discard it.",
    },
    "normal": {
        "status_kr": "Normal",
        "badge_color": "amber",
        "message": "Good to eat now. Cook and use it soon.",
    },
}

DEFAULT_SHELF_LIFE_DAYS = 3
DEFAULT_STORAGE_TIP = "Store in a cool place."
DEFAULT_COOKING_TIP = "Best eaten cooked"


def freshness_status_for(p_fresh: float) -> str:
    """Map the model's fresh probability (0..1) to fresh / normal / rotten."""
    if p_fresh >= FRESH_THRESHOLD:
        return "fresh"
    if p_fresh <= ROTTEN_THRESHOLD:
        return "rotten"
    return "normal"


def evaluate_freshness(p_fresh: float) -> dict:
    status = freshness_status_for(p_fresh)
    meta = FRESHNESS_STATUSES[status]
    return {
        "status": status,
        "status_kr": meta["status_kr"],
        "badge_color": meta["badge_color"],
        "message": meta["message"],
    }


def build_client_knowledge() -> dict:
    """The JSON document consumed by the browser (client/src/lib/fruitInfo.json)."""
    return {
        "_generated_from": "fruit_info.py (run `python tools/export_onnx.py` to regenerate)",
        "fruits": FRUIT_INFO,
        "freshness": {
            "fresh_threshold": FRESH_THRESHOLD,
            "rotten_threshold": ROTTEN_THRESHOLD,
            "statuses": FRESHNESS_STATUSES,
        },
        "defaults": {
            "shelf_life_days": DEFAULT_SHELF_LIFE_DAYS,
            "storage": DEFAULT_STORAGE_TIP,
            "cooking": DEFAULT_COOKING_TIP,
        },
    }
