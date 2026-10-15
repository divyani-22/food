// Real-server verification of the production-hardening work (docs/production-hardening.md). No mocks.
//   - builds nothing: run `pnpm build` in IngreScan-AI first (uses dist/index.js, NODE_ENV=production, zero-config SQLite)
//   - starts the server itself in a throwaway cwd (so uploads/ is isolated) with a throwaway JWT_SECRET and SQLite file
//   - plain fetch for HTTP behaviour, Playwright Chromium for CSP / page / barcode / on-device-worker checks
//
//   node e2e/hardening.mjs
// Env: PORT (3460), CSP_MODE (report-only|enforce, default enforce here so violations are real), SKIP_BROWSER=1, ONNX_CHECK=0
import { chromium } from "playwright";
import { spawn } from "child_process";
import { createRequire } from "module";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { sql } from "./lib/db.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.join(HERE, "..", "IngreScan-AI");
const require = createRequire(path.join(APP_DIR, "package.json"));
const { SignJWT } = require("jose");

const PORT = Number(process.env.PORT || 3460);
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = "hardening-e2e-secret-" + Math.random().toString(16).slice(2);
const APP_ID = "hard-e2e-app";
const DB_FILE = `/tmp/hard-e2e-${process.pid}.db`;
const CWD = fs.mkdtempSync(path.join(os.tmpdir(), "hard-e2e-cwd-"));
const UPLOADS = path.join(CWD, "uploads");
fs.mkdirSync(UPLOADS, { recursive: true });
process.env.SQLITE_PATH = DB_FILE;

const results = [];
const check = (name, ok, detail = "") => { results.push([ok ? "PASS" : "FAIL", name, detail]); console.log(ok ? "PASS" : "FAIL", name, detail); };

// ---------------------------------------------------------------- server
const logFile = path.join(CWD, "server.log");
const logFd = fs.openSync(logFile, "w");
function startServer(extraEnv = {}) {
  const env = { ...process.env, NODE_ENV: "production", PORT: String(PORT), JWT_SECRET: SECRET, VITE_APP_ID: APP_ID, SQLITE_PATH: DB_FILE, CSP_MODE: process.env.CSP_MODE || "enforce", RATE_LIMIT_API_PER_MIN: "100000", ...extraEnv };
  delete env.DATABASE_URL;
  return spawn("node", [path.join(APP_DIR, "dist", "index.js")], { cwd: CWD, env, stdio: ["ignore", logFd, logFd] });
}
// Open Food Facts stub (the sandbox has no internet): "product not found" for every barcode.
const STUB_PORT = PORT + 1;
const stub = http.createServer((req, res) => { res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ status: 0, status_verbose: "product not found" })); });
await new Promise((r) => stub.listen(STUB_PORT, "127.0.0.1", r));
process.env.OPENFOODFACTS_BASE_URL = `http://127.0.0.1:${STUB_PORT}`;
let app = startServer();
const exited = new Promise((resolve) => app.on("exit", (code, sig) => resolve({ code, sig })));
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(BASE + "/healthz")).ok) break; } catch { /* not yet */ }
  await new Promise((r) => setTimeout(r, 500));
}

// ---------------------------------------------------------------- helpers
const rawGet = (p, headers = {}, method = "GET") => new Promise((resolve, reject) => {
  const req = http.request({ host: "127.0.0.1", port: PORT, path: p, method, headers }, (res) => {
    const chunks = []; res.on("data", (c) => chunks.push(c));
    res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  });
  req.on("error", reject); req.end();
});
async function session(openId, name) {
  sql(`insert or ignore into users (openId, name, role, loginMethod) values ('${openId}', '${name}', 'user', 'local')`);
  const token = await new SignJWT({ openId, appId: APP_ID, name })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(Math.floor((Date.now() + 3600_000) / 1000)).sign(new TextEncoder().encode(SECRET));
  return `app_session_id=${token}`;
}
const trpc = async (cookie, proc, input, extraHeaders = {}) => {
  const r = await fetch(`${BASE}/api/trpc/${proc}`, { method: "POST", headers: { "content-type": "application/json", cookie, ...extraHeaders }, body: JSON.stringify({ json: input }) });
  const b = await r.json().catch(() => null);
  return { status: r.status, data: b?.result?.data?.json, error: b?.error?.json?.message };
};
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64");

// ---------------------------------------------------------------- 1. health + request id + headers
{
  const h = await fetch(BASE + "/healthz"); const hb = await h.json();
  check("healthz 200 minimal body", h.status === 200 && JSON.stringify(hb) === '{"status":"ok"}', JSON.stringify(hb));
  const r = await fetch(BASE + "/readyz"); const rb = await r.json();
  check("readyz 200, DB up, no details leaked", r.status === 200 && rb.database === "up" && !JSON.stringify(rb).includes("/tmp"), JSON.stringify(rb));
  const p = await fetch(BASE + "/");
  const need = { "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "strict-origin-when-cross-origin" };
  check("page security headers", Object.entries(need).every(([k, v]) => p.headers.get(k) === v) && !p.headers.get("x-powered-by"), "x-powered-by=" + p.headers.get("x-powered-by"));
  check("permissions-policy keeps camera=(self)", (p.headers.get("permissions-policy") || "").includes("camera=(self)"));
  check("CSP present", !!(p.headers.get("content-security-policy") || "").includes("script-src"), (p.headers.get("content-security-policy") || "").slice(0, 80) + "...");
  check("no HSTS over plain http", !p.headers.get("strict-transport-security"));
  const hs = await fetch(BASE + "/", { headers: { "x-forwarded-proto": "https" } });
  check("no HSTS from spoofed X-Forwarded-Proto when TRUST_PROXY is unset", !hs.headers.get("strict-transport-security"));
  check("x-request-id on every response", /^[0-9a-f-]{36}$/.test(p.headers.get("x-request-id") || ""));
  const anonApi = await fetch(BASE + "/api/trpc/auth.me");
  check("anonymous production session is not a fallback user", anonApi.status === 200 && (await anonApi.json()).result?.data?.json == null);
}

// ---------------------------------------------------------------- 2. authenticated uploads
const cookieA = await session("hard-user-a", "Hard A");
const cookieB = await session("hard-user-b", "Hard B");
const up = await trpc(cookieA, "scanner.uploadImage", { fileName: "label.png", fileData: PNG.toString("base64"), mimeType: "image/png" });
check("upload via tRPC returns /uploads/<name> (client contract unchanged)", up.status === 200 && /^\/uploads\/scans_\d+_[\w.-]+$/.test(up.data?.url || ""), up.data?.url || up.error);
const url = up.data?.url;
{
  const anon = await rawGet(url);
  const a = await fetch(BASE + url, { headers: { cookie: cookieA } });
  const abody = Buffer.from(await a.arrayBuffer());
  const b = await fetch(BASE + url, { headers: { cookie: cookieB } });
  check("anonymous -> 401", anon.status === 401);
  check("owner -> 200 identical bytes", a.status === 200 && abody.equals(PNG));
  check("owner response headers", a.headers.get("content-type") === "image/png" && a.headers.get("x-content-type-options") === "nosniff" && a.headers.get("content-disposition") === "inline" && /private/.test(a.headers.get("cache-control") || ""), `${a.headers.get("content-type")} | ${a.headers.get("cache-control")}`);
  check("other user -> 404 (not 403)", b.status === 404);
  const bad = ["/uploads/..%2f..%2fetc%2fpasswd", "/uploads/%2e%2e%2f..%2fpackage.json", "/uploads/..%5c..%5cx", "/uploads/" + (url.split("/").pop()) + "%00.png", "/uploads/%00", "/uploads/../package.json", "/uploads/", "/uploads"];
  let allSafe = true; const seen = [];
  for (const p of bad) { const r = await rawGet(p, { cookie: cookieA }); seen.push(`${r.status}`); if (![400, 404].includes(r.status) || /root:|"name"/.test(r.body.toString())) allSafe = false; }
  check("traversal / NUL / encoded separators / listing all rejected", allSafe, seen.join(","));
  // symlink escaping the uploads dir
  fs.writeFileSync(path.join(CWD, "secret.txt"), "TOP SECRET");
  const owner = url.split("/").pop().match(/^scans_(\d+)_/)[1];
  fs.symlinkSync(path.join(CWD, "secret.txt"), path.join(UPLOADS, `scans_${owner}_1-x-link.png`));
  const sl = await rawGet(`/uploads/scans_${owner}_1-x-link.png`, { cookie: cookieA });
  check("symlink escaping uploads dir -> 404", sl.status === 404 && !sl.body.toString().includes("TOP SECRET"));
  // legacy file (no owner prefix) is served only to the owner of a scan that references it
  fs.writeFileSync(path.join(UPLOADS, "legacy-old.png"), PNG);
  const legacyBefore = await rawGet("/uploads/legacy-old.png", { cookie: cookieA });
  const mk = await trpc(cookieA, "scanner.createScan", { inputType: "image", imageUrl: "/uploads/legacy-old.png", imageKey: "scans/1/legacy-old.png", productName: "Legacy" });
  const legacyA = await rawGet("/uploads/legacy-old.png", { cookie: cookieA });
  const legacyB = await rawGet("/uploads/legacy-old.png", { cookie: cookieB });
  check("legacy upload: 404 until referenced, then owner 200, other user 404", legacyBefore.status === 404 && mk.status === 200 && legacyA.status === 200 && legacyB.status === 404, `${legacyBefore.status}/${legacyA.status}/${legacyB.status}`);
  const staticListing = await rawGet("/uploads/legacy-old.png", {});
  check("directory not exposed anonymously", staticListing.status === 401);
}

// ---------------------------------------------------------------- 3. body limits, CSRF guard, errors
{
  const big = await fetch(BASE + "/api/trpc/scanner.uploadImage", { method: "POST", headers: { "content-type": "application/json", cookie: cookieA }, body: JSON.stringify({ json: { fileName: "x.png", fileData: "A".repeat(26 * 1024 * 1024), mimeType: "image/png" } }) });
  check("26 MB tRPC body -> 413 JSON", big.status === 413 && (await big.json()).error, String(big.status));
  const mid = await trpc(cookieA, "scanner.uploadImage", { fileName: "m.png", fileData: Buffer.alloc(3 * 1024 * 1024, 1).toString("base64"), mimeType: "image/png" });
  check("3 MB photo still uploads (limits are not too tight)", mid.status === 200);
  const small = await fetch(BASE + "/api/oauth/callback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ a: "x".repeat(2 * 1024 * 1024) }) });
  check("2 MB JSON to a generic route -> 413 (1 MB default)", small.status === 413, String(small.status));
  const xo = await trpc(cookieA, "scanner.createScan", { inputType: "text", rawIngredients: "sugar" }, { origin: "https://evil.example" });
  check("cross-origin mutation with valid cookie -> 403", xo.status === 403);
  const so = await trpc(cookieA, "scanner.createScan", { inputType: "text", rawIngredients: "sugar" }, { origin: BASE });
  check("same-origin mutation allowed", so.status === 200);
  const cors = await fetch(BASE + "/api/trpc/auth.me", { headers: { origin: "https://evil.example" } });
  check("no CORS allow-origin header", !cors.headers.get("access-control-allow-origin"));
  const bad = await fetch(BASE + "/api/trpc/scanner.createScan", { method: "POST", headers: { "content-type": "application/json", cookie: cookieA }, body: "{nope" });
  const bt = await bad.text();
  check("malformed JSON -> safe 400, no stack", bad.status === 400 && !/at \w+|node_modules|\.js:\d+/.test(bt), bt.slice(0, 80));
}

// ---------------------------------------------------------------- 4. logs
{
  await new Promise((r) => setTimeout(r, 300));
  const text = fs.readFileSync(logFile, "utf8");
  const lines = text.split("\n").filter((l) => l.startsWith("{"));
  const reqLines = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((j) => j?.msg === "request");
  const secrets = cookieA.split("=")[1];
  check("access log is JSON with reqId/method/path/status/durationMs", reqLines.length > 10 && reqLines.every((j) => j.reqId && j.method && j.path && j.status && typeof j.durationMs === "number"), `${reqLines.length} request lines`);
  check("logs contain no session token, cookie, or query string", !text.includes(secrets) && !/cookie|authorization/i.test(lines.join("\n")) && reqLines.every((j) => !j.path.includes("?")));
}

// ---------------------------------------------------------------- 5. browser: CSP, pages, upload image render, barcode (zxing), on-device worker
if (process.env.SKIP_BROWSER !== "1") {
  const args = ["--ignore-certificate-errors"];
  if (process.env.HTTPS_PROXY) args.push(`--proxy-server=${process.env.HTTPS_PROXY}`, "--proxy-bypass-list=localhost;127.0.0.1");
  const browser = await chromium.launch({ args });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([{ name: "app_session_id", value: cookieA.split("=")[1], url: BASE }]);
  const page = await ctx.newPage();
  const csp = []; const errs = [];
  page.on("console", (m) => {
    const t = m.text();
    if (/Content Security Policy|Content-Security-Policy|violates the following/i.test(t)) csp.push(t.slice(0, 220));
    else if (m.type() === "error" && !/fonts\.g|ERR_|Failed to load resource|ERR_PROXY|Open Food Facts is unreachable/.test(t)) errs.push(t.slice(0, 200));
  });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  const pages = ["/", "/scanner", "/produce", "/fridge", "/qc", "/history", "/profile", "/dashboard", "/receipt", "/openfoodfacts", "/chat", "/about", "/privacy", "/terms"];
  for (const p of pages) {
    const resp = await page.goto(BASE + p, { waitUntil: "load", timeout: 45000 }).catch((e) => ({ status: () => 0, err: e }));
    await page.waitForTimeout(1500);
    const body = (await page.locator("body").innerText().catch(() => "")).length;
    check(`page ${p} renders`, resp.status() === 200 && body > 50, `status ${resp.status()} text ${body}`);
  }
  // scan result page shows the protected image
  const scanId = sql("select id from food_scans where image_url like '/uploads/scans_%' order by id desc limit 1");
  await trpc(cookieA, "scanner.createScan", { inputType: "image", imageUrl: url, imageKey: "k", productName: "Photo scan" }).then(async (r) => {
    await page.goto(`${BASE}/scan/${r.data?.scanId}`, { waitUntil: "networkidle" });
    const ok = await page.evaluate(async () => { const i = document.querySelector('img[alt="Product label"]'); if (!i) return "no-img"; if (!i.complete) await new Promise((r) => (i.onload = i.onerror = r)); return i.naturalWidth > 0 ? "loaded" : "broken"; });
    check("scan page <img src=/uploads/...> loads with session cookie", ok === "loaded", ok);
  });
  // anonymous browser context cannot load it
  const anonCtx = await browser.newContext();
  const anonResp = await anonCtx.request.get(BASE + url);
  check("anonymous browser context -> 401 on the same URL", anonResp.status() === 401);
  await anonCtx.close();
  // barcode photo decoded by lazily loaded ZXing under the CSP
  await page.goto(BASE + "/scanner", { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: /Barcode/ }).click();
  await page.setInputFiles('[data-testid="barcode-photo-input"]', path.join(HERE, "fixtures", "ean13-valid.png"));
  let decoded = "";
  for (let i = 0; i < 40 && !decoded; i++) {
    await page.waitForTimeout(500);
    decoded = await page.evaluate(() => { const t = document.body.innerText + " " + Array.from(document.querySelectorAll("input")).map((i) => i.value).join(" "); const m = t.match(/\b\d{13}\b/); return m ? m[0] : ""; });
  }
  check("barcode photo decodes (ZXing chunk loads under CSP)", /^\d{13}$/.test(decoded), decoded);
  // camera permission policy is allowed for this origin
  const camAllowed = await page.evaluate(() => (document.featurePolicy || document.permissionsPolicy)?.allowsFeature?.("camera") ?? null);
  check("camera allowed by Permissions-Policy for the page", camAllowed === true || camAllowed === null, String(camAllowed));
  // Real on-device ONNX inference (ORT wasm + module worker) under the headers, as in e2e/on-device-inference.mjs.
  if (process.env.ONNX_CHECK !== "0") {
    const p2 = await ctx.newPage();
    p2.on("console", (m) => { if (/Content Security Policy|violates the following/i.test(m.text())) csp.push("[produce] " + m.text().slice(0, 220)); });
    let predictCalls = 0; p2.on("request", (r) => { if (r.url().includes("/api/freshguard/predict")) predictCalls++; });
    await p2.goto(BASE + "/produce", { waitUntil: "domcontentloaded" });
    let status = "";
    try {
      await p2.waitForFunction(() => /Runs on this device/.test(document.querySelector('[data-testid="engine-status-text"]')?.textContent ?? ""), null, { timeout: 120000 });
      status = await p2.getByTestId("engine-status-text").innerText();
      const saved = p2.waitForRequest((r) => r.url().includes("produce.recordScan"), { timeout: 90000 });
      await p2.setInputFiles('input[type="file"]:not([capture])', path.join(HERE, "..", "static", "samples", "apple.jpg"));
      const req = await saved; const body = JSON.parse(req.postData()); const input = (body["0"] ?? body).json;
      check("on-device ONNX inference runs under the headers", !!input?.fruit && input.pFresh >= 0 && predictCalls === 0, `${status} -> ${input?.fruit} ${input?.freshness} pFresh=${input?.pFresh}; server predict calls=${predictCalls}`);
    } catch (e) { check("on-device ONNX inference runs under the headers", false, String(e.message).split("\n")[0] + " | status=" + status); }
    await p2.close();
  }
  check(`console CSP violations (${process.env.CSP_MODE || "enforce"} mode)`, csp.length === 0, csp.slice(0, 5).join(" || "));
  check("no unexpected console errors", errs.length === 0, errs.slice(0, 5).join(" || "));
  await browser.close();
}

// ---------------------------------------------------------------- 6. rate limit + graceful shutdown (restarts the server)
{
  app.kill("SIGTERM"); await exited;
  fs.writeFileSync(logFile, "");
  app = startServer({ RATE_LIMIT_API_PER_MIN: "40", RATE_LIMIT_UPLOADS_PER_MIN: "40" });
  const exited2 = new Promise((resolve) => app.on("exit", (code, sig) => resolve({ code, sig })));
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + "/healthz")).ok) break; } catch { /* */ } await new Promise((r) => setTimeout(r, 500)); }
  let limited = 0; let first429 = null;
  for (let i = 0; i < 60; i++) { const r = await fetch(BASE + "/api/trpc/auth.me"); if (r.status === 429) { limited++; first429 ??= r.headers.get("retry-after"); } }
  check("API rate limit returns 429 + Retry-After", limited > 0 && !!first429, `${limited} limited, retry-after=${first429}`);
  let u429 = 0; for (let i = 0; i < 60; i++) { const r = await rawGet(url, { cookie: cookieA }); if (r.status === 429) u429++; }
  check("uploads route rate limited", u429 > 0, `${u429} limited`);
  const t0 = Date.now();
  app.kill("SIGTERM");
  const ex = await Promise.race([exited2, new Promise((r) => setTimeout(() => r({ code: "timeout" }), 12000))]);
  const log = fs.readFileSync(logFile, "utf8");
  check("SIGTERM: graceful exit code 0 with shutdown logs", ex.code === 0 && /shutdown_started/.test(log) && /shutdown_complete/.test(log), `code=${ex.code} in ${Date.now() - t0}ms`);
}

// ---------------------------------------------------------------- summary
const failed = results.filter((r) => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
for (const f of failed) console.log("FAILED:", f[1], f[2]);
try { app.kill("SIGKILL"); } catch { /* gone */ }
stub.close();
fs.rmSync(CWD, { recursive: true, force: true });
for (const f of [DB_FILE, DB_FILE + "-wal", DB_FILE + "-shm"]) fs.rmSync(f, { force: true });
process.exit(failed.length ? 1 : 0);
