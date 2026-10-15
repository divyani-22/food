#!/usr/bin/env node
/**
 * Safety net for the MySQL migrations that delete rows (0003: duplicate user_profiles, orphan
 * scan_ingredients / alternatives; 0004: orphan chat_messages).
 *
 *   node scripts/backup-before-migrate.mjs --check    dry run: print how many rows would be deleted
 *   node scripts/backup-before-migrate.mjs            same, and write those rows to backups/<timestamp>.json
 *
 * Needs DATABASE_URL. Tables that do not exist yet are skipped (fresh database = nothing to lose).
 * This is not a full backup; take a mysqldump for that.
 */
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const checkOnly = process.argv.includes("--check");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Nothing to check (the embedded SQLite database never deletes rows during migration).");
  process.exit(0);
}

const QUERIES = {
  duplicate_user_profiles:
    "SELECT p1.* FROM user_profiles p1 INNER JOIN user_profiles p2 ON p1.user_id = p2.user_id AND p1.id < p2.id",
  orphan_scan_ingredients: "SELECT * FROM scan_ingredients WHERE scan_id NOT IN (SELECT id FROM food_scans)",
  orphan_alternatives: "SELECT * FROM alternatives WHERE scan_id NOT IN (SELECT id FROM food_scans)",
  orphan_chat_messages:
    "SELECT * FROM chat_messages WHERE scan_id IS NOT NULL AND scan_id NOT IN (SELECT id FROM food_scans)",
};

const conn = await mysql.createConnection(url);
const found = {};
try {
  for (const [name, sql] of Object.entries(QUERIES)) {
    try {
      const [rows] = await conn.query(sql);
      found[name] = rows;
    } catch (err) {
      if (err?.code === "ER_NO_SUCH_TABLE") found[name] = [];
      else throw err;
    }
  }
} finally {
  await conn.end();
}

let total = 0;
for (const [name, rows] of Object.entries(found)) {
  console.log(`${name}: ${rows.length}`);
  total += rows.length;
}
if (total === 0) {
  console.log("No rows would be deleted by the migrations.");
} else if (checkOnly) {
  console.log(`${total} row(s) would be deleted. Run without --check to save them to backups/ first.`);
} else {
  const dir = path.resolve("backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `pre-migrate-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(found, null, 2));
  console.log(`Saved ${total} row(s) to ${file}`);
}
