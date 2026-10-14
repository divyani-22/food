// Synchronous SQL helper for the e2e scripts.
// - DATABASE_URL=mysql://user:pass@host:port/db -> uses the `mysql` CLI.
// - otherwise (unset, file:, sqlite:)            -> reads/writes the SQLite file (SQLITE_PATH or the app default)
//   through python3's built-in sqlite3 module (no extra dependencies).
// Output mimics `mysql -N`: tab-separated columns, one row per line, NULL for null, trimmed.
// Keep the queries portable: plain SQL, no backtick quoting, no dialect-specific functions.
import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "IngreScan-AI");

export function dbTarget(env = process.env) {
  const url = (env.DATABASE_URL ?? "").trim();
  if (/^mysql(2)?:/i.test(url)) {
    const u = new URL(url);
    return {
      dialect: "mysql",
      host: u.hostname || "127.0.0.1",
      port: u.port || "3306",
      user: decodeURIComponent(u.username || "root"),
      password: decodeURIComponent(u.password || ""),
      database: u.pathname.replace(/^\//, ""),
    };
  }
  let file;
  if (url) {
    let rest = url.replace(/^(file|sqlite):/i, "");
    if (rest.startsWith("//")) rest = rest.slice(2);
    file = rest;
  } else {
    file = (env.SQLITE_PATH ?? "").trim() || path.join("data", "ingrescan.db");
  }
  return { dialect: "sqlite", file: path.resolve(appDir, file) };
}

const PY = `
import sqlite3, sys
con = sqlite3.connect(sys.argv[1], timeout=30)
con.execute("PRAGMA foreign_keys = ON")
cur = con.execute(sys.argv[2])
rows = cur.fetchall()
con.commit()
con.close()
sys.stdout.write("\\n".join("\\t".join("NULL" if v is None else str(v) for v in r) for r in rows))
`;

export function sql(query, env = process.env) {
  const t = dbTarget(env);
  if (t.dialect === "mysql") {
    const args = ["-N", "-h", t.host, "-P", t.port, "-u", t.user, t.database, "-e", query];
    return execFileSync("mysql", args, {
      env: { ...process.env, ...(t.password ? { MYSQL_PWD: t.password } : {}) },
      encoding: "utf8",
    }).trim();
  }
  return execFileSync("python3", ["-c", PY, t.file, query], { encoding: "utf8" }).trim();
}
