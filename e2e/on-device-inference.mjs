// Real end-to-end check of on-device (ONNX Runtime Web) produce inspection. No mocks.
//
// Needs a running stack (see docs/on-device-inference.md):
//   Flask   FRESHGUARD_PORT=5102 python3 app.py
//   Web     DATABASE_URL=... PORT=3102 FRESHGUARD_URL=http://127.0.0.1:5102 JWT_SECRET=dev-only-secret VITE_APP_ID=e2e-app \
//           NODE_ENV=development npx tsx server/_core/index.ts      (or the production build)
// Run from the repo root:  node e2e/on-device-inference.mjs
//
// Env: BASE_URL (default http://localhost:3102), FLASK_URL (default http://127.0.0.1:5102), JWT_SECRET, VITE_APP_ID,
//      E2E_WEBGPU=1 (expose a software WebGPU adapter), E2E_DB (MariaDB database holding the web app users, default ingrescan_b), MAX_P_FRESH_DIFF (default 1.5)
import { chromium } from "playwright";
import { createRequire } from "module";
import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const require = createRequire(new URL("../IngreScan-AI/package.json", import.meta.url));
const { SignJWT } = require("jose");

const BASE = process.env.BASE_URL ?? "http://localhost:3102";
const FLASK = process.env.FLASK_URL ?? "http://127.0.0.1:5102";
const DB = process.env.E2E_DB ?? "ingrescan_b";
const TOL = Number(process.env.MAX_P_FRESH_DIFF ?? 1.5);
const SECRET = new TextEncoder().encode(process.env.JWT_SECRET ?? "dev-only-secret");
const APP_ID = process.env.VITE_APP_ID ?? "e2e-app";
const ROOT = new URL("..", import.meta.url).pathname;
const sql = (q) => execSync(`mysql -N ${DB} -e "${q.replace(/"/g, '\\"')}"`).toString().trim();

const results = [];
const check = (name, ok, detail = "") => results.push([ok ? "PASS" : "FAIL", name, detail]);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

// ---------- user + session cookie ----------
sql("delete from produce_scans where user_id in (select id from users where openId='ondevice-e2e')");
sql("delete from users where openId='ondevice-e2e'");
sql("insert into users (openId,name,role,loginMethod) values ('ondevice-e2e','On Device E2E','user','local')");
const token = await new SignJWT({ openId: "ondevice-e2e", appId: APP_ID, name: "On Device E2E" })
  .setProtectedHeader({ alg: "HS256", typ: "JWT" })
  .setExpirationTime(Math.floor((Date.now() + 3600_000) / 1000))
  .sign(SECRET);

// ---------- test images: 5 bundled samples + derived variants (incl. EXIF-rotated copies) ----------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ondevice-e2e-"));
execSync("python3 -", {
  input: `
import sys, io, random
from pathlib import Path
from PIL import Image, ImageOps, ImageEnhance
root = Path(${JSON.stringify(ROOT)}); out = Path(${JSON.stringify(dir)})
random.seed(7)
samples = sorted((root / "static" / "samples").glob("*.jpg"))
for p in samples:
    (out / ("sample_" + p.name)).write_bytes(p.read_bytes())
n = 0
def save(im, name, **kw):
    global n
    im.save(out / name, **kw); n += 1
for p in samples:
    im = Image.open(p).convert("RGB"); w, h = im.size; s = p.stem
    save(im.crop((w//5, h//6, w - w//7, h - h//4)), f"{s}_crop.jpg", quality=92)
    save(im.rotate(90, expand=True), f"{s}_rot90.jpg", quality=92)
    save(im.resize((max(96, w//4), max(96, h//4)), Image.BICUBIC), f"{s}_small.jpg", quality=90)
    save(im, f"{s}_q30.jpg", quality=30)
    save(ImageEnhance.Brightness(im).enhance(0.6), f"{s}_dark.jpg", quality=90)
    ex = im.getexif(); ex[0x0112] = 6                      # EXIF: rotate 90 CW when displayed
    save(im, f"{s}_exif6.jpg", quality=92, exif=ex)
    ex = im.getexif(); ex[0x0112] = 3                      # EXIF: rotate 180
    save(im.crop((0, 0, w*3//4, h)), f"{s}_exif3.jpg", quality=92, exif=ex)
# format and size variants
im = Image.open(samples[0]).convert("RGB")
save(im, "fmt_png.png"); save(im, "fmt_webp.webp", quality=90)
save(im.convert("L"), "fmt_gray.jpg", quality=92)
big = Image.open(samples[3]).convert("RGB"); w, h = big.size
save(big.resize((w*4, h*4), Image.LANCZOS), "big_12mp.jpg", quality=85)   # large photo, downscale path
save(Image.open(samples[1]).convert("RGB").resize((200, 150), Image.BILINEAR), "tiny_200x150.jpg", quality=92)
print(n)
`,
  stdio: ["pipe", "inherit", "inherit"],
});
const imageFiles = fs.readdirSync(dir).sort().map((f) => path.join(dir, f));

async function serverResult(file) {
  const b64 = fs.readFileSync(file).toString("base64");
  const r = await fetch(`${FLASK}/api/predict?persist=0`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: b64 }),
  });
  if (!r.ok) throw new Error(`Flask ${r.status} for ${file}`);
  return await r.json();
}

const launchArgs = ["--ignore-certificate-errors"];
if (process.env.HTTPS_PROXY) launchArgs.push(`--proxy-server=${process.env.HTTPS_PROXY}`, "--proxy-bypass-list=localhost;127.0.0.1");
// E2E_WEBGPU=1 exposes Chromium's software (SwiftShader) WebGPU adapter. That exercises the WebGPU code path, but it is
// NOT a real GPU: it proves the wiring and parity, not GPU performance.
if (process.env.E2E_WEBGPU === "1") launchArgs.push("--enable-unsafe-webgpu");
const browser = await chromium.launch({ args: launchArgs });

async function newSession() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([{ name: "app_session_id", value: token, url: BASE }]);
  const page = await ctx.newPage();
  const log = { predict: [], modelGets: [], console: [], pageErrors: [] };
  page.on("request", (r) => {
    const u = r.url();
    if (u.includes("/api/freshguard/predict")) log.predict.push(u);
    if (/\/models\/freshguard\.onnx|\/ort\/.*\.wasm/.test(u)) log.modelGets.push(u);
  });
  page.on("console", (m) => { if (m.type() === "error") log.console.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => log.pageErrors.push(e.message));
  return { ctx, page, log };
}
const statusText = (page) => page.getByTestId("engine-status-text").innerText();
async function waitStatus(page, re, timeout = 120000) {
  await page.waitForFunction(
    ([sel, src]) => new RegExp(src).test(document.querySelector(sel)?.textContent ?? ""),
    ['[data-testid="engine-status-text"]', re.source], { timeout });
}
/** Inspect a file through the real UI and return what the page saved (the exact result it displayed). */
async function inspectFile(page, file) {
  const t0 = Date.now();
  const saved = page.waitForRequest((r) => r.url().includes("produce.recordScan"), { timeout: 90000 });
  await page.setInputFiles('input[type="file"]:not([capture])', file);
  const req = await saved;
  const ms = Date.now() - t0;
  const body = JSON.parse(req.postData());
  const input = (body["0"] ?? body).json;
  return { ...input, ms };
}

const gotoProduce = async (page) => page.goto(`${BASE}/produce`, { waitUntil: "domcontentloaded" });

// =====================================================================================
// 1. Cold start on an empty browser profile, then parity vs the Flask/PyTorch service
// =====================================================================================
const A = await newSession();
let providerText = "";
{
  const t0 = Date.now();
  await gotoProduce(A.page);
  await waitStatus(A.page, /Runs on this device/);
  const coldLoadMs = Date.now() - t0;
  providerText = await statusText(A.page);
  check("Cold model load completes (empty cache)", true, `${coldLoadMs} ms to "${providerText}"; model requests: ${A.log.modelGets.length}`);
  check("Model + wasm fetched over the network on first load", A.log.modelGets.some((u) => u.includes("freshguard.onnx")) && A.log.modelGets.some((u) => u.includes(".wasm")), A.log.modelGets.map((u) => u.split("/").pop().split("?")[0]).join(", "));
}

const rows = [];
for (const f of imageFiles) {
  const dev = await inspectFile(A.page, f);
  const srv = await serverResult(f);
  rows.push({ file: path.basename(f), dev, srv });
}
{
  const diffs = rows.map((r) => Math.abs(r.dev.pFresh - r.srv.p_fresh));
  const confDiffs = rows.map((r) => Math.abs(r.dev.confidence - r.srv.confidence));
  const maxDiff = Math.max(...diffs);
  const top1 = rows.filter((r) => r.dev.fruit === r.srv.fruit).length;
  const status = rows.filter((r) => r.dev.freshness === r.srv.freshness_status).length;
  for (const r of rows) {
    const d = Math.abs(r.dev.pFresh - r.srv.p_fresh).toFixed(1);
    console.log(`  ${r.file.padEnd(26)} device ${r.dev.fruit.padEnd(11)} ${r.dev.freshness.padEnd(6)} pf=${String(r.dev.pFresh).padStart(5)}  server ${r.srv.fruit.padEnd(11)} ${r.srv.freshness_status.padEnd(6)} pf=${String(r.srv.p_fresh).padStart(5)}  |d|=${d}  ${r.dev.ms} ms`);
  }
  check(`Parity: ${rows.length} images, same top-1 fruit`, top1 === rows.length, `${top1}/${rows.length}`);
  check(`Parity: ${rows.length} images, same freshness status`, status === rows.length, `${status}/${rows.length}`);
  check(`Parity: max |p_fresh diff| <= ${TOL} points`, maxDiff <= TOL, `max ${maxDiff.toFixed(1)} (mean ${(diffs.reduce((a, b) => a + b, 0) / diffs.length).toFixed(2)}); max confidence diff ${Math.max(...confDiffs).toFixed(1)}`);
  check("Parity set has >= 25 images (5 samples + >= 20 derived)", rows.length >= 25, String(rows.length));
  const warm = rows.slice(1).map((r) => r.dev.ms);
  check("Warm latency reported", true, `UI file-select -> result saved: median ${median(warm)} ms, min ${Math.min(...warm)} ms, max ${Math.max(...warm)} ms (includes React + tRPC)`);
  const help = await A.page.getByTestId("engine-status").innerText();
  check("Status line reports engine-measured latency", /Last inspection took \d+ ms/.test(help), help.replace(/\n/g, " | "));
}
check("No request to /api/freshguard/predict during on-device inspections", A.log.predict.length === 0, `${A.log.predict.length} predict requests`);

// Quick-test sample buttons also run on-device
{
  const before = A.log.predict.length;
  const saved = A.page.waitForRequest((r) => r.url().includes("produce.recordScan"), { timeout: 60000 });
  await A.page.getByRole("button", { name: /apple/i }).first().click();
  const req = await saved;
  const input = (JSON.parse(req.postData())["0"] ?? {}).json;
  check("Sample button runs on-device (no predict request)", A.log.predict.length === before && input?.fruit === "apple", `fruit=${input?.fruit} imageUrl=${input?.imageUrl}`);
  check("Sample result keeps the static image URL for history", /\/static\/samples\/apple\.jpg$/.test(input?.imageUrl ?? ""));
}

// =====================================================================================
// 2. Offline: network cut after the model is loaded
// =====================================================================================
{
  await A.ctx.setOffline(true);
  // While offline the per-user history save (tRPC) is paused by React Query and resumes on reconnect, so read the
  // verdict from the page instead of waiting for that request.
  const t0 = Date.now();
  await A.page.setInputFiles('input[type="file"]:not([capture])', imageFiles.find((f) => f.includes("banana_crop")));
  await A.page.getByRole("heading", { level: 2, name: "Banana" }).waitFor({ timeout: 30000 });
  const ms = Date.now() - t0;
  const verdict = await A.page.getByText("AI Assessment Verdict:").isVisible();
  check("Offline: inspection still works with the network disabled", verdict, `Banana verdict shown in ${ms} ms with the network off`);
  const resumed = A.page.waitForRequest((r) => r.url().includes("produce.recordScan"), { timeout: 30000 }).catch(() => null);
  await A.ctx.setOffline(false);
  check("Offline: the history save resumes after reconnecting", (await resumed) !== null);
}
check("Offline: still no predict requests", A.log.predict.length === 0);

// Reload with the model/wasm requests blocked: they must come from the Cache API.
{
  const attempts = [];
  await A.page.route(/\/(models\/freshguard\.onnx|ort\/[^/]+\.wasm)/, (route) => { attempts.push(route.request().url()); route.abort(); });
  await A.page.reload({ waitUntil: "domcontentloaded" });
  await waitStatus(A.page, /Runs on this device/, 60000);
  check("Reload with model downloads blocked loads from the Cache API", attempts.length === 0, `${attempts.length} blocked download attempts`);
  const r = await inspectFile(A.page, imageFiles.find((f) => f.includes("tomato.jpg")));
  check("Inspection works after a cache-only reload", r.fruit === "tomato", `${r.fruit} ${r.freshness}`);
  await A.page.unroute(/\/(models\/freshguard\.onnx|ort\/[^/]+\.wasm)/);
}
{
  // While the network is cut, the app's own tRPC queries (auth, history) legitimately fail to fetch; those are not
  // part of the inspection, so they are excluded. Anything else counts.
  const offlineNoise = /API Query Error\] TRPCClientError: Failed to fetch|ERR_INTERNET_DISCONNECTED/;
  const errs = [...A.log.console.filter((m) => !offlineNoise.test(m)), ...A.log.pageErrors];
  check("No unexpected console/page errors in the on-device session", errs.length === 0, errs.join(" | ").slice(0, 300));
}

// =====================================================================================
// 3. Manual switch to the server and persistence of the preference
// =====================================================================================
{
  await A.page.getByTestId("engine-server").click();
  await waitStatus(A.page, /Using server/, 5000);
  const before = A.log.predict.length;
  const r = await inspectFile(A.page, imageFiles.find((f) => f.includes("orange.jpg")));
  check("Server mode uses /api/freshguard/predict", A.log.predict.length === before + 1 && r.fruit === "orange", `${A.log.predict.length - before} request(s); ${r.ms} ms`);
  await A.page.reload({ waitUntil: "domcontentloaded" });
  await waitStatus(A.page, /Using server/, 15000);
  const pref = await A.page.evaluate(() => localStorage.getItem("ingrescan.produce.engine"));
  check("Engine preference persists in localStorage", pref === "server", `value=${pref}`);
  await A.page.getByTestId("engine-device").click();
  await waitStatus(A.page, /Runs on this device/, 60000);
}
await A.ctx.close();

// =====================================================================================
// 4. Fallback: model download aborted -> server path + toast
// =====================================================================================
{
  const B = await newSession();
  await B.page.route(/\/models\/freshguard\.onnx/, (route) => route.abort());
  await gotoProduce(B.page);
  await B.page.getByTestId("engine-status").waitFor();
  await B.page.waitForTimeout(1500);
  const r = await inspectFile(B.page, imageFiles.find((f) => f.includes("strawberry.jpg")));
  const toast = await B.page.locator("[data-sonner-toast]").allInnerTexts();
  check("Fallback: result still appears via the server when the model request fails", r.fruit === "strawberry" && B.log.predict.length === 1, `${r.fruit} ${r.freshness}; predict requests=${B.log.predict.length}`);
  check("Fallback: a toast explains the switch", toast.some((t) => /On-device inspection is unavailable/.test(t) && /server/i.test(t)), toast.join(" || ").slice(0, 200));
  await waitStatus(B.page, /Using server \(on-device unavailable\)/, 5000);
  check("Fallback: status line says the server is in use", true, await statusText(B.page));
  await B.ctx.close();
}

await browser.close();
fs.rmSync(dir, { recursive: true, force: true });

console.log("");
let failed = 0;
for (const [s, n, d] of results) { if (s === "FAIL") failed++; console.log(`${s}  ${n}${d ? "  -- " + d : ""}`); }
console.log(`\n${results.length - failed}/${results.length} checks passed. Provider: ${providerText}`);
process.exit(failed ? 1 : 0);
