#!/usr/bin/env python3
"""One-time import of legacy FreshGuard data (freshguard.db, SQLite) into MySQL for ONE user.

The old Flask service kept a single shared pantry and history. The web app now stores both per
user in MySQL (tables produce_inventory / produce_scans). This script prints SQL that assigns the
legacy rows to the user id you choose; legacy Korean labels and emoji are translated to English.

    python tools/import_freshguard_data.py --user-id 1 > import.sql
    mysql -u ingrescan -p ingrescan < import.sql

Run it once. Re-running inserts the rows again.
"""
import argparse
import sqlite3
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from fruit_info import FRUIT_INFO  # noqa: E402
from legacy_text import _HANGUL_RE, englishify  # noqa: E402


def q(value):
    """Quote a value as a MySQL literal."""
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return repr(float(value)) if isinstance(value, float) else str(value)
    text = str(value).replace("\\", "\\\\").replace("'", "''").replace("\x00", "")
    return f"'{text}'"


def english_tip(tip, fruit_type):
    """Legacy tips are Korean sentences; use the English tip for that fruit instead."""
    if not tip:
        return None
    text = englishify(tip)
    if _HANGUL_RE.search(text):
        return FRUIT_INFO.get(fruit_type or "", {}).get("storage", "Store in a cool place.")
    return text


def clean_status(value):
    return value if value in ("fresh", "normal", "rotten") else "normal"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--user-id", type=int, required=True, help="users.id that will own the imported rows")
    ap.add_argument("--db", default=str(ROOT / "freshguard.db"), help="path to the legacy SQLite file")
    args = ap.parse_args()

    if not Path(args.db).is_file():
        sys.exit(f"SQLite file not found: {args.db}")
    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row

    out = ["-- FreshGuard legacy import", "START TRANSACTION;"]
    n_inv = n_hist = 0
    for r in conn.execute("SELECT * FROM inventory ORDER BY id"):
        expiry = (r["expiry_date"] or "")[:10] or date.today().isoformat()
        out.append(
            "INSERT INTO produce_inventory (user_id, name, fruit_type, freshness, p_fresh, confidence, image_url, expiry_date, storage_tip, created_at) VALUES ("
            + ", ".join([
                str(args.user_id), q(englishify(r["name"]) or "Produce"), q(r["fruit_type"]), q(clean_status(r["freshness"])),
                q(float(r["p_fresh"])), q(float(r["confidence"])), q(r["image_url"] or None), q(expiry),
                q(english_tip(r["storage_tip"], r["fruit_type"])), q(r["created_at"]),
            ]) + ");"
        )
        n_inv += 1
    for r in conn.execute("SELECT * FROM scan_history ORDER BY id"):
        out.append(
            "INSERT INTO produce_scans (user_id, fruit_type, fruit_name, freshness, freshness_label, p_fresh, confidence, image_url, created_at) VALUES ("
            + ", ".join([
                str(args.user_id), q(r["fruit_type"]), q(englishify(r["fruit_name_kr"]) or r["fruit_type"]), q(clean_status(r["freshness"])),
                q(englishify(r["freshness_kr"]) or "Normal"), q(float(r["p_fresh"])), q(float(r["confidence"])),
                q(r["image_url"] or None), q(r["created_at"]),
            ]) + ");"
        )
        n_hist += 1
    out.append("COMMIT;")
    print("\n".join(out))
    print(f"-- {n_inv} pantry items, {n_hist} history rows for user {args.user_id}", file=sys.stderr)


if __name__ == "__main__":
    main()
