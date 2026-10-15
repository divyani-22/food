// Real end-to-end check of multi-item ("Scan a whole shelf") detection. No mocks.
//
// Stack (see docs/multi-item-detection.md):
//   python3 tools/fetch_detector.py                       # one-time: downloads the Apache-2.0 YOLOX-S ONNX
//   FRESHGUARD_PORT=5410 python3 app.py
//   cd IngreScan-AI && SQLITE_PATH=/tmp/e2e.db PORT=3410 FRESHGUARD_URL=http://127.0.0.1:5410 JWT_SECRET=dev-only-secret \
//     VITE_APP_ID=e2e-app NODE_ENV=development npx tsx server/_core/index.ts
// Non-produce rejection (docs/non-produce-rejection.md) is checked with the server engine: the single-item page is
// forced onto /api/freshguard/predict via localStorage because the on-device ONNX path has no OOD flag yet.
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
const nonProduce = path.join(OUT, "not-produce.jpg");
const appleSample = path.join(ROOT, "static", "samples", "apple.jpg");
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
# a non-produce tile (barcode product photo from the repo fixtures) next to the produce, to see that it is not listed as fruit
dis = Image.open(root + "/e2e/fixtures/product-photo-with-barcode.png").convert("RGB")
dis.thumbnail((380, 300))
canvas.paste(dis, (850, 330))
canvas.save(out, quality=92)
Image.new("RGB", (800, 600), (200, 200, 200)).save(blank, quality=90)
Image.open(root + "/e2e/fixtures/product-photo-with-barcode.png").convert("RGB").save(sys.argv[4], quality=92)
`, ROOT, composite, blank, nonProduce]);

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
  check("Every item carries needs_check, check_reasons and an OOD likelihood",
    d.items?.every((i) => typeof i.needs_check === "boolean" && Array.isArray(i.check_reasons) && typeof i.produce_likelihood === "number" && typeof i.is_produce === "boolean"));
  check("Items flagged needs_check always give at least one reason", d.items?.every((i) => !i.needs_check || i.check_reasons.length > 0));
  const disTile = { x1: 850, y1: 330, x2: 1230, y2: 630 };
  const inDis = d.items?.filter((i) => i.box.x >= disTile.x1 - 20 && i.box.y >= disTile.y1 - 20 && i.box.x + i.box.w <= disTile.x2 + 20 && i.box.y + i.box.h <= disTile.y2 + 20);
  check("The non-produce product tile is not listed as an item", inDis?.length === 0, `${inDis?.length} items inside it`);
  check("Response reports OOD settings", d.ood?.method === "energy" && typeof d.ood?.min_likelihood === "number" && typeof d.second_pass?.enabled === "boolean");
  const NON_ENGLISH = /[ᄀ-ᇿ぀-ヿ㄰-㆏㐀-䶿一-鿿가-힯\u{1F000}-\u{1FAFF}☀-➿]/u;
  check("Response is English with no emoji", !NON_ENGLISH.test(JSON.stringify(d)));

  // single-photo /api/predict through the proxy: non-produce is flagged (200), produce is not
  {
    const post = (file) => fetch(`${BASE}/api/freshguard/predict`, {
      method: "POST", headers: { "content-type": "application/json", cookie: `app_session_id=${alice}` },
      body: JSON.stringify({ image: b64(file) }),
    });
    const np = await post(nonProduce);
    const npj = await np.json();
    check("Proxy: /predict flags a non-produce photo (HTTP 200, is_produce=false)", np.status === 200 && npj.is_produce === false && npj.produce_likelihood < 0.5, `status ${np.status} likelihood ${npj.produce_likelihood}`);
    check("Proxy: flagged response keeps every legacy field", ["fruit", "fruit_kr", "confidence", "p_fresh", "freshness_status", "shelf_life_days", "storage_tips", "top_candidates", "image_url"].every((k) => k in npj));
    const ap = await post(appleSample);
    const apj = await ap.json();
    check("Proxy: /predict keeps a real apple photo (is_produce=true, apple)", ap.status === 200 && apj.is_produce === true && apj.fruit === "apple", `${apj.fruit} ${apj.produce_likelihood}`);
  }

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
  const checkTags = await page.locator('[data-testid^="shelf-item-check-tag-"]').count();
  const tickedAtStart = await page.locator('[data-testid^="shelf-item-check-"][role="checkbox"][data-state="checked"]').count();
  check("UI: items marked 'Check this item' start unticked", tickedAtStart === count - checkTags, `${count} rows, ${checkTags} to check, ${tickedAtStart} ticked`);
  if (checkTags > 0) {
    const reason = await page.locator('[data-testid^="shelf-item-check-reason-"]').first().innerText();
    check("UI: a checked item explains why", reason.length > 10, reason);
  }
  console.log(`  shelf rows ${count}, to check ${checkTags}`);
  const boxes = await page.locator('[data-testid="shelf-overlay"] rect[stroke]').count();
  check("UI: review list shows the detected items", count >= 3, `${count} rows`);
  check("UI: one overlay box per item on the preview", boxes === count, `${boxes} boxes`);
  const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check("UI: no horizontal scroll at 390px", noScroll);
  await page.screenshot({ path: path.join(OUT, "shelf-390.png"), fullPage: true });

  // untick the first ticked row and rename the second ticked row
  const tickedIdx = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="shelf-item-check-"][role="checkbox"]')]
    .filter((el) => el.getAttribute("data-state") === "checked").map((el) => Number(el.getAttribute("data-testid").split("-").pop())));
  if (tickedIdx.length < 2) throw new Error(`need >= 2 ticked rows, got ${tickedIdx.length}`);
  await page.getByTestId(`shelf-item-check-${tickedIdx[0]}`).click();
  await page.getByTestId(`shelf-item-type-${tickedIdx[1]}`).click();
  await page.getByRole("option", { name: "Mango" }).click();
  const expectedAdded = tickedIdx.length - 1;
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

  // single-item page, server engine: a non-produce photo gets the warning state, "Use anyway" shows the verdict
  const sctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await sctx.addCookies([{ name: "app_session_id", value: alice, url: BASE }]);
  await sctx.addInitScript(() => { try { localStorage.setItem("ingrescan.produce.engine", "server"); } catch {} });
  const sp = await sctx.newPage();
  const serrors = [];
  sp.on("pageerror", (e) => serrors.push(e.message));
  await sp.goto(`${BASE}/produce`, { waitUntil: "domcontentloaded" });
  const scansBefore = Number(sql(`select count(*) from produce_scans where user_id=${aliceId}`));
  await sp.setInputFiles('input[type="file"][accept="image/*"]:not([capture])', nonProduce);
  await sp.getByTestId("not-produce-card").waitFor({ timeout: 60000 });
  const npText = await sp.getByTestId("not-produce-card").innerText();
  check("UI single: non-produce shows 'This does not look like fresh produce'", /This does not look like fresh produce/.test(npText), npText.slice(0, 80));
  check("UI single: no confident verdict while flagged (no pantry button, no freshness probability)",
    (await sp.getByRole("button", { name: /Save to Fridge Pantry/ }).count()) === 0 && !/Freshness Probability/.test(await sp.locator("body").innerText()));
  check("UI single: flagged state offers 'Try another photo' and 'Use anyway'",
    (await sp.getByTestId("not-produce-retry").isVisible()) && (await sp.getByTestId("not-produce-use-anyway").isVisible()));
  check("UI single: no horizontal scroll at 390px in the flagged state", await sp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await sp.waitForTimeout(800);
  check("DB: a flagged photo is not saved to history", Number(sql(`select count(*) from produce_scans where user_id=${aliceId}`)) === scansBefore);
  await sp.screenshot({ path: path.join(OUT, "not-produce-390.png"), fullPage: true });
  await sp.getByTestId("not-produce-use-anyway").click();
  await sp.getByRole("button", { name: /Save to Fridge Pantry/ }).waitFor({ timeout: 15000 });
  check("UI single: 'Use anyway' reveals the usual verdict", true);
  await sp.waitForTimeout(1200);
  check("DB: 'Use anyway' saves the scan to history", Number(sql(`select count(*) from produce_scans where user_id=${aliceId}`)) === scansBefore + 1);
  await sp.setInputFiles('input[type="file"][accept="image/*"]:not([capture])', appleSample);
  // The previous (Use anyway) result still shows a Save button for an instant, so wait for the new verdict heading.
  await sp.getByRole("heading", { level: 2, name: /apple/i }).first().waitFor({ timeout: 60000 });
  const h2s = await sp.locator("h2").allInnerTexts();
  check("UI single: a real apple photo goes straight to the verdict (no warning)", (await sp.getByTestId("not-produce-card").count()) === 0 && /apple/i.test(await sp.locator("h2").first().innerText()), JSON.stringify(h2s));
  check("UI single: no uncaught page errors", serrors.length === 0, serrors.join(" | "));
  await sp.screenshot({ path: path.join(OUT, "apple-verdict-390.png"), fullPage: true });
  const sd = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await sd.addCookies([{ name: "app_session_id", value: alice, url: BASE }]);
  await sd.addInitScript(() => { try { localStorage.setItem("ingrescan.produce.engine", "server"); } catch {} });
  const sdp = await sd.newPage();
  await sdp.goto(`${BASE}/produce`, { waitUntil: "domcontentloaded" });
  await sdp.setInputFiles('input[type="file"][accept="image/*"]:not([capture])', nonProduce);
  await sdp.getByTestId("not-produce-card").waitFor({ timeout: 60000 });
  await sdp.screenshot({ path: path.join(OUT, "not-produce-1280.png"), fullPage: true });
  check("UI desktop: flagged state renders", true);

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
