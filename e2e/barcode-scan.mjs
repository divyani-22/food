// Hybrid barcode + OCR end-to-end run: real Chromium, real Express/tRPC app, real MariaDB.
// Open Food Facts is replaced by a local node http stub (the sandbox has no internet); the app is started with
// OPENFOODFACTS_BASE_URL pointing at it, which also verifies the configurable base URL.
//
//   node e2e/barcode-scan.mjs
//
// Env: DATABASE_URL (default mysql://ingrescan:devpass@127.0.0.1:3306/ingrescan_c), PORT (3103), STUB_PORT (3193),
//      E2E_DB (mysql CLI database name, default ingrescan_c)
import { chromium } from "playwright";
import { execSync, spawn, spawnSync } from "child_process";
import http from "http";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, "fixtures");
const APP_DIR = path.join(HERE, "..", "IngreScan-AI");
const PORT = Number(process.env.PORT || 3103);
const STUB_PORT = Number(process.env.STUB_PORT || 3193);
const DB = process.env.E2E_DB || "ingrescan_c";
const DATABASE_URL = process.env.DATABASE_URL || `mysql://ingrescan:devpass@127.0.0.1:3306/${DB}`;
const BASE = `http://localhost:${PORT}`;
const sql = (q) => execSync(`mysql -N ${DB} -e "${q.replace(/"/g, '\\"')}"`).toString().trim();
const fx = (n) => path.join(FIX, n);

// ---------------------------------------------------------------- Open Food Facts stub
const PRODUCTS = {
  "4006381333931": {
    code: "4006381333931", product_name: "Test Biscuits", brands: "E2E Acme", categories: "en:snacks, en:biscuits",
    ingredients_text: "Wheat flour, sugar, palm oil, invert sugar syrup, salt, raising agents (E500), soy lecithin, artificial flavour",
    nutriscore_grade: "d", nova_group: 4, ecoscore_grade: "c", allergens: "en:gluten,en:soybeans",
    nutriments: { "energy-kcal_100g": 480, sugars_100g: 22, fat_100g: 18, "saturated-fat_100g": 8, salt_100g: 1.1, proteins_100g: 6, fiber_100g: 2 },
    image_front_url: `http://127.0.0.1:${STUB_PORT}/img/product.png`,
  },
  "0036000291452": {
    code: "0036000291452", product_name: "Test Cereal Flakes", brands: "E2E Mill", categories: "en:cereals",
    ingredients_text: "Corn, sugar, malt flavouring, salt, iron, vitamin B3", nutriscore_grade: "b", nova_group: 3, allergens: "",
    nutriments: { "energy-kcal_100g": 370 },
  },
  "8901030895470": { code: "8901030895470", product_name: "Test Noodles No Label Data", brands: "E2E Foods", categories: "en:noodles", ingredients_text: "", nutriscore_grade: "c", nova_group: 4, allergens: "en:gluten", nutriments: {} },
  "5449000000996": {
    code: "5449000000996", product_name: "Test Cola", brands: "E2E Fizz", categories: "en:beverages",
    ingredients_text: "Carbonated water, sugar, colour (caramel E150d), phosphoric acid, natural flavourings, caffeine", nutriscore_grade: "e", nova_group: 4, allergens: "", nutriments: {},
  },
};
const stub = { hits: {}, outage: true, searches: 0 };
const pngBytes = fs.readFileSync(fx("ean13-valid.png"));
const stubServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${STUB_PORT}`);
  const m = url.pathname.match(/^\/api\/v2\/product\/(\d+)\.json$/);
  if (m) {
    const code = m[1];
    stub.hits[code] = (stub.hits[code] || 0) + 1;
    // 5449000000996 recovers when stub.outage is switched off; 5012345678900 is always down (so it can never be cached)
    if (code === "5012345678900" || (code === "5449000000996" && stub.outage)) {
      res.writeHead(503, { "content-type": "text/plain" });
      return res.end("Service Unavailable");
    }
    const p = PRODUCTS[code];
    if (!p) {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end(JSON.stringify({ code, status: 0, status_verbose: "product not found" }));
    }
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ code, status: 1, status_verbose: "product found", product: p }));
  }
  if (url.pathname === "/cgi/search.pl") {
    stub.searches++;
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ count: 1, products: [PRODUCTS["4006381333931"]] }));
  }
  if (url.pathname === "/img/product.png") {
    res.writeHead(200, { "content-type": "image/png" });
    return res.end(pngBytes);
  }
  res.writeHead(404);
  res.end("not found");
});
await new Promise((r) => stubServer.listen(STUB_PORT, "127.0.0.1", r));

// ---------------------------------------------------------------- real app
const logFile = path.join(os.tmpdir(), `barcode-e2e-server-${process.pid}.log`);
const logFd = fs.openSync(logFile, "w");
const app = spawn("npx", ["tsx", "server/_core/index.ts"], {
  cwd: APP_DIR,
  env: { ...process.env, DATABASE_URL, PORT: String(PORT), JWT_SECRET: "dev-only-secret", NODE_ENV: "development", OPENFOODFACTS_BASE_URL: `http://127.0.0.1:${STUB_PORT}` },
  stdio: ["ignore", logFd, logFd],
  detached: true, // own process group so we can stop exactly what we started
});
const stopApp = () => { try { process.kill(-app.pid, "SIGTERM"); } catch { /* already gone */ } };
process.on("exit", stopApp);
async function waitForApp() {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(`${BASE}/api/trpc/openFoodFacts.getByBarcode?input=${encodeURIComponent(JSON.stringify({ json: { barcode: "1" } }))}`); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("app did not start; log: " + logFile);
}
await waitForApp();

// ---------------------------------------------------------------- harness
const launchArgs = (extra = []) => {
  const a = ["--ignore-certificate-errors", ...extra];
  if (process.env.HTTPS_PROXY) a.push(`--proxy-server=${process.env.HTTPS_PROXY}`, "--proxy-bypass-list=localhost;127.0.0.1;192.0.2.2");
  return a;
};
const results = [];
const consoleErrors = [];
let currentStep = "setup";
async function step(name, fn) {
  currentStep = name;
  const t = Date.now();
  try { await fn(); results.push(["PASS", name, Date.now() - t]); }
  catch (e) { results.push(["FAIL", name, Date.now() - t, String(e.message || e).split("\n")[0]]); }
}
const skip = (name, why) => results.push(["SKIP", name, 0, why]);
const expect = (c, msg) => { if (!c) throw new Error(msg); };

for (const q of [
  "delete from chat_messages where scan_id in (select id from food_scans where product_name like 'E2E %')",
  "delete from scan_ingredients where scan_id in (select id from food_scans where product_name like 'E2E %')",
  "delete from alternatives where scan_id in (select id from food_scans where product_name like 'E2E %')",
  "delete from food_scans where product_name like 'E2E %'",
]) sql(q);

const browser = await chromium.launch({ args: launchArgs() });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const trpcCalls = [];
page.on("request", (r) => { if (r.url().includes("/api/trpc/")) trpcCalls.push(decodeURIComponent(r.url())); });
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`[${currentStep}] ` + m.text().slice(0, 200)); });
page.on("pageerror", (e) => consoleErrors.push("PAGEERROR " + e.message));
const calls = (needle) => trpcCalls.filter((u) => u.includes(needle)).length;
const mark = () => trpcCalls.length;
const callsSince = (i, needle) => trpcCalls.slice(i).filter((u) => u.includes(needle)).length;

const openScanner = async (tab) => {
  await page.goto(`${BASE}/scanner`, { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: tab }).click();
};
const uploadBarcodePhoto = (name) => page.setInputFiles('[data-testid="barcode-photo-input"]', fx(name));
const analyzeBtn = () => page.getByRole("button", { name: /Analyze Ingredients/ });

// ---------------------------------------------------------------- 1. barcode mode, product with ingredients
let scanIdA;
await step("Barcode mode: EAN-13 photo -> product card, editable ingredients, scan saved, NO OCR/upload calls", async () => {
  await openScanner(/Barcode/);
  const m = mark();
  await uploadBarcodePhoto("ean13-valid.png");
  const card = page.locator('[data-testid="off-product-card"]');
  await card.waitFor({ timeout: 60000 });
  const cardText = await card.innerText();
  expect(cardText.includes("Test Biscuits"), "product name on card: " + cardText);
  expect(/Nutri-Score/.test(cardText) && /NOVA/.test(cardText), "Nutri-Score and NOVA shown");
  expect(/gluten/i.test(cardText), "allergens shown");
  expect(await card.locator("img").first().isVisible(), "product image shown");
  expect((await page.locator("#productName").inputValue()) === "E2E Acme Test Biscuits", "product name pre-filled: " + (await page.locator("#productName").inputValue()));
  expect((await page.locator("#barcodeIngredients").inputValue()).startsWith("Wheat flour"), "ingredients pre-filled");
  expect(await page.getByText("Source: Open Food Facts").isVisible(), "source note shown");
  await page.locator("#barcodeIngredients").fill("Wheat flour, sugar, palm oil, salt, cocoa powder");
  await analyzeBtn().click();
  await page.waitForURL(/\/scan\/\d+/, { timeout: 60000 });
  scanIdA = Number(page.url().split("/").pop());
  const raw = sql(`select raw_ingredients from food_scans where id=${scanIdA}`);
  expect(raw === "Wheat flour, sugar, palm oil, salt, cocoa powder", "edited ingredients stored: " + raw);
  expect(sql(`select input_type from food_scans where id=${scanIdA}`) === "text", "input_type text");
  expect(Number(sql(`select count(*) from scan_ingredients where scan_id=${scanIdA}`)) >= 4, "ingredient rows saved");
  expect(callsSince(m, "scanner.processOCR") === 0, "processOCR must not be called");
  expect(callsSince(m, "scanner.uploadImage") === 0, "uploadImage must not be called");
  expect(callsSince(m, "analysis.analyzeIngredients") === 1, "analysis ran once");
  expect(callsSince(m, "openFoodFacts.getByBarcode") >= 1, "OFF lookup happened");
});

// ---------------------------------------------------------------- 2. UPC-A, rotated, noisy
for (const [file, code, label] of [
  ["upca-valid.png", "0036000291452", "UPC-A photo is padded to EAN-13 for lookup"],
  ["ean13-rotated-90.png", "4006381333931", "rotated 90 degree photo decodes via preprocessing"],
  ["ean13-noisy-blurred.png", "4006381333931", "noisy + blurred photo decodes"],
]) {
  await step(`Barcode mode: ${label}`, async () => {
    await openScanner(/Barcode/);
    await uploadBarcodePhoto(file);
    await page.locator('[data-testid="off-product-card"]').waitFor({ timeout: 60000 });
    const t = await page.locator('[data-testid="barcode-result"]').innerText();
    expect(t.includes(code), `lookup code ${code} shown: ${t.slice(0, 200)}`);
    expect(!!stub.hits[code], "stub received a request for " + code);
  });
}

// ---------------------------------------------------------------- 3. unknown, no ingredients, outage
await step("Barcode mode: unknown barcode -> not-found message with OCR fallback action", async () => {
  await openScanner(/Barcode/);
  await uploadBarcodePhoto("ean13-unknown.png");
  const nf = page.locator('[data-testid="barcode-not-found"]');
  await nf.waitFor({ timeout: 60000 });
  expect(/not in Open Food Facts/.test(await nf.innerText()), "not-found wording");
  expect((await page.locator('[data-testid="barcode-outage"]').count()) === 0, "must not show the outage state");
  expect(await analyzeBtn().isDisabled(), "Analyze disabled without ingredients");
  await nf.getByRole("button", { name: /Image \(OCR\) mode/ }).click();
  await page.getByText("Upload Label Image").waitFor();
});
await step("Barcode mode: product without ingredients -> name prefilled, guidance to Image mode", async () => {
  await openScanner(/Barcode/);
  await uploadBarcodePhoto("ean13-no-ingredients.png");
  const n = page.locator('[data-testid="barcode-no-ingredients"]');
  await n.waitFor({ timeout: 60000 });
  expect((await page.locator("#productName").inputValue()) === "E2E Foods Test Noodles No Label Data", "name prefilled: " + (await page.locator("#productName").inputValue()));
  expect(await analyzeBtn().isDisabled(), "Analyze disabled");
  await n.getByRole("button", { name: /Image \(OCR\) mode/ }).click();
  await page.getByText("Upload Label Image").waitFor();
});
await step("Barcode mode: OFF outage is distinct from not-found and is not cached", async () => {
  stub.outage = true;
  await openScanner(/Barcode/);
  await uploadBarcodePhoto("ean13-outage.png");
  const o = page.locator('[data-testid="barcode-outage"]');
  await o.waitFor({ timeout: 60000 });
  const t = await o.innerText();
  expect(/unreachable/i.test(t) && /temporary/i.test(t), "outage wording: " + t);
  expect((await page.locator('[data-testid="barcode-not-found"]').count()) === 0, "must not claim not-found");
  const before = stub.hits["5449000000996"];
  stub.outage = false;
  await o.getByRole("button", { name: /Try again/ }).click();
  await page.locator('[data-testid="off-product-card"]').waitFor({ timeout: 30000 });
  expect(stub.hits["5449000000996"] > before, "retry reached OFF again (outage not cached)");
  expect((await page.locator('[data-testid="barcode-outage"]').count()) === 0, "outage state cleared");
});

// ---------------------------------------------------------------- 4. checksum handling
await step("Bad-checksum photo: zxing reports a detected-but-unreadable barcode instead of ignoring it; no lookup happens", async () => {
  await openScanner(/Barcode/);
  await uploadBarcodePhoto("ean13-bad-checksum.png");
  const m = page.locator('[data-testid="barcode-photo-message"]');
  await m.waitFor({ timeout: 90000 });
  const t = await m.innerText();
  expect(/barcode was detected/.test(t) && /check digit/.test(t), "warning wording: " + t);
  expect(!stub.hits["4006381333932"], "no OFF request for an unverified code");
  expect((await page.locator('[data-testid="barcode-result"]').count()) === 0, "no product result shown");
});
await step("Typed bad-checksum code: warning, then explicit 'Look up anyway' performs the lookup", async () => {
  await openScanner(/Barcode/);
  await page.locator('[data-testid="barcode-manual-input"]').fill("4006381333932");
  expect(!stub.hits["4006381333932"], "no lookup while typing");
  await page.locator('[data-testid="barcode-manual-submit"]').click();
  await page.locator('[data-testid="barcode-checksum-warning"]').waitFor({ timeout: 30000 });
  await page.locator('[data-testid="barcode-not-found"]').waitFor({ timeout: 30000 });
  expect(stub.hits["4006381333932"] === 1, "one OFF request after confirmation: " + stub.hits["4006381333932"]);
});
await step("Manual entry: live checksum feedback and explicit confirmation", async () => {
  await openScanner(/Barcode/);
  const input = page.locator('[data-testid="barcode-manual-input"]');
  const fb = page.locator('[data-testid="barcode-manual-feedback"]');
  const submit = page.locator('[data-testid="barcode-manual-submit"]');
  await input.fill("4006");
  expect(/Keep typing/.test(await fb.innerText()), "incomplete hint");
  expect(await submit.isDisabled(), "submit disabled while incomplete");
  await input.fill("40063813A3931");
  expect(/digits only/.test(await fb.innerText()), "non-numeric reason");
  expect(await submit.isDisabled(), "submit disabled for non-numeric");
  await input.fill("4006381333932");
  expect(/Check digit does not match \(expected 1\)/.test(await fb.innerText()), "checksum reason: " + (await fb.innerText()));
  expect((await submit.innerText()) === "Look up anyway", "button asks for explicit confirmation");
  await input.fill("4006381333931");
  expect(/Valid EAN-13/.test(await fb.innerText()), "valid feedback");
  expect((await submit.innerText()) === "Look up product", "normal button");
  await submit.click();
  await page.locator('[data-testid="off-product-card"]').waitFor({ timeout: 30000 });
});
await step("No barcode in photo: helpful message", async () => {
  await openScanner(/Barcode/);
  await uploadBarcodePhoto("label-no-barcode.png");
  const m = page.locator('[data-testid="barcode-photo-message"]');
  await m.waitFor({ timeout: 90000 });
  expect(/No barcode found/.test(await m.innerText()) && /glare/.test(await m.innerText()), "tips shown");
});

// ---------------------------------------------------------------- 5. hybrid image mode
await step("Hybrid: label photo with a barcode skips OCR and uses Open Food Facts ingredients", async () => {
  await openScanner(/Image/);
  const m = mark();
  await page.setInputFiles("#imageUpload", fx("product-photo-with-barcode.png"));
  await page.locator('[data-testid="hybrid-active"]').waitFor({ timeout: 90000 });
  expect(/skip OCR/.test(await page.locator('[data-testid="hybrid-active"]').innerText()), "banner explains OCR is skipped");
  expect(await page.getByRole("button", { name: /Read the label with OCR instead/ }).isVisible(), "force-OCR button visible");
  await analyzeBtn().click();
  await page.waitForURL(/\/scan\/\d+/, { timeout: 60000 });
  const id = Number(page.url().split("/").pop());
  expect(sql(`select raw_ingredients from food_scans where id=${id}`).startsWith("Wheat flour"), "OFF ingredients stored");
  expect(Number(sql(`select count(*) from scan_ingredients where scan_id=${id}`)) >= 5, "ingredient rows saved");
  expect(callsSince(m, "scanner.processOCR") === 0, "processOCR must not be called");
  expect(callsSince(m, "scanner.uploadImage") === 0, "uploadImage must not be called");
});
await step("Hybrid: 'Read the label with OCR instead' forces the OCR path", async () => {
  await openScanner(/Image/);
  await page.setInputFiles("#imageUpload", fx("product-photo-with-barcode.png"));
  await page.locator('[data-testid="hybrid-active"]').waitFor({ timeout: 90000 });
  await page.locator('[data-testid="force-ocr"]').click();
  await page.locator('[data-testid="hybrid-forced-ocr"]').waitFor();
  const m = mark();
  await analyzeBtn().click();
  await page.waitForFunction(() => /\/scan\/\d+/.test(location.pathname) || document.querySelector("[data-sonner-toast][data-type=error]"), null, { timeout: 60000 });
  expect(callsSince(m, "scanner.uploadImage") === 1, "label image uploaded for OCR");
  expect(callsSince(m, "scanner.processOCR") === 1, "processOCR called when forced");
});
await step("Hybrid: label photo WITHOUT a barcode proceeds with OCR exactly as before", async () => {
  await openScanner(/Image/);
  await page.setInputFiles("#imageUpload", fx("label-no-barcode.png"));
  await page.waitForFunction(() => !document.querySelector('[data-testid="hybrid-detecting"]'), null, { timeout: 90000 });
  expect((await page.locator('[data-testid="hybrid-active"]').count()) === 0, "no hybrid banner");
  const m = mark();
  await analyzeBtn().click();
  await page.waitForFunction(() => /\/scan\/\d+/.test(location.pathname) || document.querySelector("[data-sonner-toast][data-type=error]"), null, { timeout: 60000 });
  expect(callsSince(m, "scanner.uploadImage") === 1 && callsSince(m, "scanner.processOCR") === 1, "OCR path used");
});
await step("Hybrid: barcode in photo but OFF outage -> falls back to OCR with a clear note", async () => {
  stub.outage = true;
  await openScanner(/Image/);
  await page.setInputFiles("#imageUpload", fx("ean13-outage-hybrid.png"));
  const f = page.locator('[data-testid="hybrid-fallback"]');
  await f.waitFor({ timeout: 90000 });
  expect(/unreachable/.test(await f.innerText()) && /OCR/.test(await f.innerText()), "fallback wording: " + (await f.innerText()));
  stub.outage = false;
});
await step("Hybrid: bad-checksum barcode in photo -> warning, OCR used", async () => {
  await openScanner(/Image/);
  await page.setInputFiles("#imageUpload", fx("ean13-bad-checksum.png"));
  const w = page.locator('[data-testid="hybrid-invalid"]');
  await w.waitFor({ timeout: 90000 });
  expect(/check digit/.test(await w.innerText()), "warning wording");
});

// ---------------------------------------------------------------- 6. explorer
await step("Explorer: scan from photo fills the barcode input and looks the product up", async () => {
  await page.goto(`${BASE}/openfoodfacts`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="explorer-scan-toggle"]').click();
  await page.locator('[data-testid="barcode-photo-input"]').waitFor({ state: "attached" });
  await page.setInputFiles('[data-testid="barcode-photo-input"]', fx("upca-valid.png"));
  await page.getByText("Test Cereal Flakes").first().waitFor({ timeout: 60000 });
  expect((await page.getByLabel("Barcode number").inputValue()) === "0036000291452", "input filled with the lookup code");
});

// ---------------------------------------------------------------- 7. server-side cache + mobile layout
await step("Server cache: repeated lookups of one product reached the stub once", async () => {
  expect(stub.hits["4006381333931"] === 1, "stub hits for 4006381333931: " + stub.hits["4006381333931"]);
});
await step("Mobile 360px: barcode tab and explorer have no horizontal overflow", async () => {
  const mctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });
  const mp = await mctx.newPage();
  for (const [url, tab] of [[`${BASE}/scanner`, /Barcode/], [`${BASE}/openfoodfacts`, null]]) {
    await mp.goto(url, { waitUntil: "domcontentloaded" });
    if (tab) await mp.getByRole("tab", { name: tab }).click();
    else await mp.locator('[data-testid="explorer-scan-toggle"]').click();
    await mp.locator('[data-testid="barcode-scanner"]').waitFor();
    const over = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over <= 0, `${url} overflows by ${over}px`);
    await mp.screenshot({ path: path.join(os.tmpdir(), `barcode-mobile-${url.endsWith("scanner") ? "scanner" : "explorer"}.png`) });
  }
  await mctx.close();
});

// ---------------------------------------------------------------- 8. camera paths
const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const mjpeg = path.join(os.tmpdir(), "barcode-fake-camera.mjpeg");
if (ffmpeg) {
  spawnSync("ffmpeg", ["-y", "-loop", "1", "-i", fx("ean13-valid.png"), "-vf", "scale=480:-2,pad=640:480:(ow-iw)/2:(oh-ih)/2:white,format=yuvj420p", "-t", "6", "-r", "10", "-c:v", "mjpeg", "-q:v", "2", "-f", "mjpeg", mjpeg], { stdio: "ignore" });
}
async function withCameraBrowser(extraArgs, perms, fn) {
  const b = await chromium.launch({ args: launchArgs(extraArgs) });
  const c = await b.newContext({ viewport: { width: 1280, height: 900 }, permissions: perms });
  const p = await c.newPage();
  try { await fn(p); } finally { await b.close(); }
}
if (ffmpeg && fs.existsSync(mjpeg)) {
  await step("Live camera (Chromium fake video stream): decodes the barcode, stops the stream, finds the product", async () => {
    await withCameraBrowser(["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${mjpeg}`], ["camera"], async (p) => {
      const m = trpcCalls.length;
      await p.goto(`${BASE}/scanner`, { waitUntil: "domcontentloaded" });
      await p.getByRole("tab", { name: /Barcode/ }).click();
      await p.locator('[data-testid="barcode-camera-start"]').click();
      await p.locator('[data-testid="off-product-card"]').waitFor({ timeout: 60000 });
      expect((await p.locator('[data-testid="barcode-result"]').innerText()).includes("4006381333931"), "camera decoded the right code");
      // camera released: start button is back and no live track remains
      await p.locator('[data-testid="barcode-camera-start"]').waitFor();
      const live = await p.evaluate(() => { const v = document.querySelector('[data-testid="barcode-video"]'); return !!(v && v.srcObject); });
      expect(!live, "video stream detached after detection");
    });
  });
  await step("Camera permission denied: clear message", async () => {
    await withCameraBrowser(["--deny-permission-prompts"], [], async (p) => {
      await p.goto(`${BASE}/scanner`, { waitUntil: "domcontentloaded" });
      await p.getByRole("tab", { name: /Barcode/ }).click();
      await p.locator('[data-testid="barcode-camera-start"]').click();
      const e = p.locator('[data-testid="barcode-camera-error"]');
      await e.waitFor({ timeout: 30000 });
      expect(/denied|permission|No camera/i.test(await e.innerText()), "error wording: " + (await e.innerText()));
      await p.locator('[data-testid="barcode-camera-start"]').waitFor(); // can retry
    });
  });
  await step("No camera device: clear message", async () => {
    await withCameraBrowser(["--use-fake-ui-for-media-stream"], ["camera"], async (p) => {
      await p.goto(`${BASE}/scanner`, { waitUntil: "domcontentloaded" });
      await p.getByRole("tab", { name: /Barcode/ }).click();
      await p.locator('[data-testid="barcode-camera-start"]').click();
      const e = p.locator('[data-testid="barcode-camera-error"]');
      await e.waitFor({ timeout: 30000 });
      expect(/No camera|denied|Could not start/i.test(await e.innerText()), "error wording: " + (await e.innerText()));
    });
  });
} else {
  skip("Live camera paths", "ffmpeg not available or could not create the fake video file");
}
await step("Insecure context (non-localhost http): explains that the camera needs HTTPS", async () => {
  const ip = (os.networkInterfaces().eth0 || Object.values(os.networkInterfaces()).flat()).find((i) => i && i.family === "IPv4" && !i.internal)?.address;
  if (!ip) throw new Error("SKIP-no-external-ip");
  const b = await chromium.launch({ args: launchArgs() });
  try {
    const p = await (await b.newContext()).newPage();
    await p.goto(`http://${ip}:${PORT}/scanner`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await p.getByRole("tab", { name: /Barcode/ }).click();
    await p.locator('[data-testid="barcode-camera-start"]').click();
    const e = p.locator('[data-testid="barcode-camera-error"]');
    await e.waitFor({ timeout: 30000 });
    expect(/HTTPS/.test(await e.innerText()), "mentions HTTPS: " + (await e.innerText()));
  } finally { await b.close(); }
});

// ---------------------------------------------------------------- report
const unexpected = consoleErrors.filter((e) => !/503|404|Failed to load resource|Open Food Facts/.test(e));
await step("No unexpected console errors", async () => { expect(unexpected.length === 0, unexpected.slice(0, 3).join(" | ")); });

await browser.close();
stubServer.close();
stopApp();
console.log("\n=== barcode-scan e2e ===");
for (const [s, name, ms, why] of results) console.log(`${s.padEnd(4)}  ${name}  (${ms}ms)${why ? "  -> " + why : ""}`);
const fails = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.filter((r) => r[0] === "PASS").length} passed, ${fails} failed, ${results.filter((r) => r[0] === "SKIP").length} skipped. server log: ${logFile}`);
process.exit(fails ? 1 : 0);
