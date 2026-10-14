// Real end-to-end check of multi-item ("Scan a whole shelf") detection. No mocks.
//
// Stack (see docs/multi-item-detection.md):
//   python3 tools/fetch_detector.py                       # one-time: downloads the Apache-2.0 YOLOX-S ONNX
//   FRESHGUARD_PORT=5410 python3 app.py
//   cd IngreScan-AI && SQLITE_PATH=/tmp/e2e.db PORT=3410 FRESHGUARD_URL=http://127.0.0.1:5410 JWT_SECRET=dev-only-secret \
//     VITE_APP_ID=e2e-app NODE_ENV=development npx tsx server/_core/index.ts
// Optional second stack whose Flask has no detector (FRESHGUARD_DETECTOR_PATH=/nonexistent.onnx) to check the
// "not installed" UI:  BASE_NODET_URL=http://localhost:3411 FLASK_NODET_URL=http://127.0.0.1:5411
// Run from the repo root (same SQLITE_PATH as the web app):  node e2e/multi-item.mjs
import { chromium } from "playwright";
import { createRequire } from "module";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { sql } from "./lib/db.mjs";

const require = createRequire(new URL("../IngreScan-AI/package.json", import.meta.url));
const { SignJWT } = require("jose");
const superjson = require("superjson");

const BASE = process.env.BASE_URL ?? "http://localhost:3410";
const BASE_NODET = process.env.BASE_NODET_URL ?? "";
const FLASK_NODET = process.env.FLASK_NODET_URL ?? "";
const SECRET = new TextEncoder().encode(process.env.JWT_SECRET ?? "dev-only-secret");
const APP_ID = process.env.VITE_APP_ID ?? "e2e-app";
const ROOT = new URL("..", import.meta.url).pathname;
const OUT = process.env.E2E_SHOTS ?? fs.mkdtempSync(path.join(os.tmpdir(), "multi-item-"));

const results = [];
const check = (name, ok, detail = "") => { results.push([ok ? "PASS" : "FAIL", name, detail]); };

// ---------- composite test image: five bundled sample photos pasted onto one canvas ----------
const composite = path.join(OUT, "composite.jpg");
const blank = path.join(OUT, "blank.jpg");
execFileSync("python3", ["-I", "-c", `
import sys
from PIL import Image
root, out, blank = sys.argv[1], sys.argv[2], sys.argv[3]
canvas = Image.new("RGB", (1200, 900), (235, 235, 230))
pos = {"apple": (20, 20), "banana": (430, 20), "orange": (850, 20), "strawberry": (20, 330), "tomato": (430, 330)}
for n, xy in pos.items():
    im = Image.open(root + "/static/samples/" + n + ".jpg").convert("RGB")
    im.thumbnail((380, 300))
    canvas.paste(im, xy)
canvas.save(out, quality=92)
Image.new("RGB", (800, 600), (200, 200, 200)).save(blank, quality=90)
`, ROOT, composite, blank]);

// ---------- two real users ----------
const OPEN_IDS = "('multi-alice','multi-bob')";
const cleanup = () => {
  sql(`delete from produce_inventory where user_id in (select id from users where openId in ${OPEN_IDS})`);
  sql(`delete from produce_scans where user_id in (select id from users where openId in ${OPEN_IDS})`);
  sql(`delete from users where openId in ${OPEN_IDS}`);
};
cleanup();
sql("insert into users (openId,name,role,loginMethod) values ('multi-alice','Alice','user','local'),('multi-bob','Bob','user','local')");
const aliceId = sql("select id from users where openId='multi-alice'");
const bobId = sql("select id from users where openId='multi-bob'");
const session = (openId, name) =>
  new SignJWT({ openId, appId: APP_ID, name }).setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(Math.floor((Date.now() + 3600_000) / 1000)).sign(SECRET);
const alice = await session("multi-alice", "Alice");
const bob = await session("multi-bob", "Bob");

async function trpcList(cookie) {
  const url = `${BASE}/api/trpc/produce.listInventory?input=${encodeURIComponent(JSON.stringify(superjson.serialize(undefined)))}`;
  const r = await fetch(url, { headers: { cookie: `app_session_id=${cookie}` } });
  return (await r.json())?.result?.data?.json ?? [];
}
const b64 = (f) => fs.readFileSync(f).toString("base64");
const detect = (cookie, body, extra = {}) =>
  fetch(`${BASE}/api/freshguard/detect`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie: `app_session_id=${cookie}` } : {}) },
    body: JSON.stringify(body), ...extra,
  });

// ---------- 1. API through the real proxy ----------
{
  const res = await detect(alice, { image: b64(composite) });
  const d = await res.json();
  check("Proxy: /detect works for a signed-in user", res.status === 200 && Array.isArray(d.items), `status ${res.status}`);
  console.log("  composite detections:", d.items?.map((i) => `${i.detector_label}->${i.fruit}(${i.confidence}%,${i.freshness_status})`).join(", "), `| dropped ${d.rejected?.length}`);
  check("Composite yields >= 3 items (each classified by the FreshGuard model)", d.items?.length >= 3, `${d.items?.length} items`);
  check("Each item has box, fruit, freshness, shelf life and a thumbnail",
    d.items?.every((i) => i.box?.w > 0 && i.fruit && i.freshness_status && i.shelf_life_days >= 0 && /^\/static\/uploads\//.test(i.image_url)));
  check("Every kept item meets the classifier confidence minimum", d.items?.every((i) => i.confidence >= d.min_confidence), `min ${d.min_confidence}`);
  check("At most 20 items", d.items?.length <= 20);
  const NON_ENGLISH = /[ᄀ-ᇿ぀-ヿ㄰-㆏㐀-䶿一-鿿가-힯\u{1F000}-\u{1FAFF}☀-➿]/u;
  check("Response is English with no emoji", !NON_ENGLISH.test(JSON.stringify(d)));

  const blankRes = await (await detect(alice, { image: b64(blank) })).json();
  check("A blank photo returns zero items, not invented ones", blankRes.items?.length === 0, `${blankRes.items?.length} items`);

  const anon = await fetch(`${BASE}/api/freshguard/detect`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: b64(blank) }) });
  if (process.env.EXPECT_PROD === "1") check("Anonymous /detect is rejected (401)", anon.status === 401, `status ${anon.status}`);
  const get = await fetch(`${BASE}/api/freshguard/detect`, { headers: { cookie: `app_session_id=${alice}` } });
  check("GET /detect is not allowed (404)", get.status === 404, `status ${get.status}`);

  const big = "A".repeat(11 * 1024 * 1024);
  const bigRes = await fetch(`${BASE}/api/freshguard/detect`, { method: "POST", headers: { "content-type": "application/json", cookie: `app_session_id=${alice}` }, body: JSON.stringify({ image: big }) });
  check("Bodies over 10 MB are refused (413)", bigRes.status === 413, `status ${bigRes.status}`);
  const bad = await detect(alice, { image: "not-an-image" });
  check("Garbage image gives a 400 JSON error", bad.status === 400 && !!(await bad.json()).error, `status ${bad.status}`);
}

// ---------- 2. UI at phone width: review, untick, rename, add ----------
const launchArgs = ["--ignore-certificate-errors"];
if (process.env.HTTPS_PROXY) launchArgs.push(`--proxy-server=${process.env.HTTPS_PROXY}`, "--proxy-bypass-list=localhost;127.0.0.1");
const browser = await chromium.launch({ args: launchArgs });
let added = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addCookies([{ name: "app_session_id", value: alice, url: BASE }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/produce`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("scan-mode-shelf").click();
  await page.setInputFiles('[data-testid="shelf-file-input"]', composite);
  await page.getByTestId("shelf-review").waitFor({ timeout: 120000 });
  const count = await page.locator('[data-testid^="shelf-item-"]:not([data-testid*="-check-"]):not([data-testid*="-type-"])').count();
  const boxes = await page.locator('[data-testid="shelf-overlay"] rect[stroke]').count();
  check("UI: review list shows the detected items", count >= 3, `${count} rows`);
  check("UI: one overlay box per item on the preview", boxes === count, `${boxes} boxes`);
  const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check("UI: no horizontal scroll at 390px", noScroll);
  await page.screenshot({ path: path.join(OUT, "shelf-390.png"), fullPage: true });

  // untick item 0 and rename item 1
  await page.getByTestId("shelf-item-check-0").click();
  await page.getByTestId("shelf-item-type-1").click();
  await page.getByRole("option", { name: "Mango" }).click();
  const expectedAdded = count - 1;
  const label = await page.getByTestId("shelf-selected-count").innerText();
  check("UI: unticking updates the selected count", label.startsWith(`${expectedAdded} of ${count}`), label);
  const namesBefore = await page.locator('[data-testid^="shelf-item-"] p.truncate').allInnerTexts();
  await page.getByTestId("shelf-add-selected").click();
  await page.waitForFunction(() => /Fridge\s*Pantry/.test(document.body.innerText) && document.querySelector('[role="tab"][data-state="active"]')?.textContent?.includes("Pantry"), null, { timeout: 60000 });
  await page.waitForTimeout(500);
  added = expectedAdded;

  const rows = sql(`select name, fruit_type, freshness, expiry_date, image_url from produce_inventory where user_id=${aliceId} order by id`).split("\n").filter(Boolean).map((l) => l.split("\t"));
  check("DB: only the ticked items were added for Alice", rows.length === expectedAdded, `${rows.length} rows (expected ${expectedAdded})`);
  check("DB: the renamed item is stored as Mango", rows.some((r) => r[0] === "Mango" && r[1] === "mango"), rows.map((r) => r[0]).join(", "));
  check("DB: items keep their crop thumbnails under /static/uploads", rows.every((r) => /^\/static\/uploads\/[\w.-]+$/.test(r[4])));
  check("UI: pantry tab lists the added count", (await page.locator("body").innerText()).includes(`Pantry (${expectedAdded})`));
  await page.screenshot({ path: path.join(OUT, "pantry-390.png"), fullPage: true });
  check("UI: no uncaught page errors", errors.length === 0, errors.join(" | "));
  console.log("  review rows:", namesBefore.join(" | "));

  // desktop layout
  const d = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await d.addCookies([{ name: "app_session_id", value: alice, url: BASE }]);
  const dp = await d.newPage();
  await dp.goto(`${BASE}/produce`, { waitUntil: "domcontentloaded" });
  await dp.getByTestId("scan-mode-shelf").click();
  await dp.setInputFiles('[data-testid="shelf-file-input"]', composite);
  await dp.getByTestId("shelf-review").waitFor({ timeout: 120000 });
  await dp.screenshot({ path: path.join(OUT, "shelf-1280.png"), fullPage: true });
  check("UI desktop: review renders", true);
  const blankCount = (await fetch(`${BASE}/api/trpc/produce.listInventory`)).status; // dev auto sign-in, just touches the API
  void blankCount;

  // zero-result path shows the honest recall message and the single-item fallback
  await dp.setInputFiles('[data-testid="shelf-file-input"]', blank);
  await dp.getByTestId("shelf-few-items").waitFor({ timeout: 60000 });
  const few = await dp.getByTestId("shelf-few-items").innerText();
  check("UI: zero items explains the recall limit and offers single-item scan", /apples, bananas, oranges and carrots/.test(few) && /single item/i.test(few), few.slice(0, 80));
  await dp.getByRole("button", { name: /Scan a single item instead/ }).first().click();
  check("UI: fallback switches to the single-item inspector", await dp.getByText("Quick Test Samples").isVisible());

  // detector not installed
  if (BASE_NODET) {
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx2.addCookies([{ name: "app_session_id", value: alice, url: BASE_NODET }]);
    const p2 = await ctx2.newPage();
    await p2.goto(`${BASE_NODET}/produce`, { waitUntil: "domcontentloaded" });
    await p2.getByTestId("scan-mode-shelf").click();
    await p2.setInputFiles('[data-testid="shelf-file-input"]', composite);
    await p2.getByTestId("shelf-error").waitFor({ timeout: 60000 });
    const msg = await p2.getByTestId("shelf-error").innerText();
    check("UI: missing detector shows a clear message and the single-item fallback", /not set up/.test(msg) && /fetch_detector/.test(msg) && /single item/i.test(msg), msg.replace(/\n/g, " | ").slice(0, 160));
    await p2.screenshot({ path: path.join(OUT, "detector-missing-390.png"), fullPage: true });
  }
} finally {
  await browser.close();
}
if (FLASK_NODET) {
  const r = await fetch(`${FLASK_NODET}/api/detect`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: b64(blank) }) });
  const j = await r.json();
  check("Flask without the model answers 503 detector_not_installed", r.status === 503 && j.code === "detector_not_installed", `status ${r.status}: ${j.error}`);
}

// ---------- 3. isolation ----------
{
  const aliceInv = await trpcList(alice);
  const bobInv = await trpcList(bob);
  check("Isolation: Alice sees her added items via the API", aliceInv.length === added, `${aliceInv.length}`);
  check("Isolation: Bob sees none of them", bobInv.length === 0 && sql(`select count(*) from produce_inventory where user_id=${bobId}`) === "0");
}

cleanup();
for (const r of results) console.log(r.join(" | "));
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} passed. Screenshots: ${OUT}`);
process.exit(failed ? 1 : 0);
