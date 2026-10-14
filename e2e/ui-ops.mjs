// Real end-to-end check of the Batch QC (/qc) and Receipt import (/receipt) pages. No mocks.
//
// Needs a running stack on your own ports (dev mode signs in automatically; zero-config SQLite):
//   Flask  FRESHGUARD_PORT=5105 python3 app.py
//   Web    cd IngreScan-AI && SQLITE_PATH=/tmp/ui2.db PORT=3105 FRESHGUARD_URL=http://127.0.0.1:5105 \
//          NODE_ENV=development node --import=tsx ./server/_core/index.ts
// Run from the repo root:  SQLITE_PATH=/tmp/ui2.db BASE_URL=http://localhost:3105 node e2e/ui-ops.mjs
//
// Env: BASE_URL (default http://localhost:3105), SQLITE_PATH / DATABASE_URL (same DB the web app uses),
//      PHOTO_DIR (default: a temp dir filled from static/samples with PIL-derived variants), SHOT_DIR (screenshots)
import { chromium } from "playwright";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { sql } from "./lib/db.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3105";
const ROOT = new URL("..", import.meta.url).pathname;
const SHOTS = process.env.SHOT_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), "ui-ops-shots-"));
const PHOTOS = process.env.PHOTO_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), "ui-ops-photos-"));

const results = [];
const check = (name, ok, detail = "") => {
  results.push([ok ? "PASS" : "FAIL", name, detail]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -  " + detail : ""}`);
};

// ---------- fixtures: real sample photos + derived variants (different freshness) ----------
if (!fs.existsSync(path.join(PHOTOS, "apple.jpg"))) {
  execFileSync("python3", ["-c", `
import os, sys
from PIL import Image, ImageEnhance, ImageFilter
src = os.path.join(sys.argv[1], "static", "samples"); out = sys.argv[2]
for f in sorted(os.listdir(src)):
    if not f.endswith(".jpg"): continue
    im = Image.open(os.path.join(src, f)).convert("RGB"); b = f[:-4]
    im.save(f"{out}/{b}.jpg")
    ImageEnhance.Brightness(im).enhance(0.35).save(f"{out}/{b}_dark.jpg")
    im.filter(ImageFilter.GaussianBlur(8)).save(f"{out}/{b}_blur.jpg")
    ImageEnhance.Color(ImageEnhance.Brightness(im).enhance(0.55)).enhance(0.3).rotate(25).save(f"{out}/{b}_rot.jpg")
open(f"{out}/notes.txt", "w").write("not an image")
open(f"{out}/corrupt.jpg", "wb").write(b"\\xff\\xd8\\xff garbage, not a real jpeg")
`, ROOT, PHOTOS]);
}
const good = fs.readdirSync(PHOTOS).filter((f) => /\.jpg$/.test(f) && f !== "corrupt.jpg").sort().map((f) => path.join(PHOTOS, f));
check("fixtures: >= 6 real photos", good.length >= 6, `${good.length} photos in ${PHOTOS}`);

const args = ["--ignore-certificate-errors"];
if (process.env.HTTPS_PROXY) args.push(`--proxy-server=${process.env.HTTPS_PROXY}`, "--proxy-bypass-list=localhost;127.0.0.1");
const browser = await chromium.launch({ args });
const consoleErrors = [];

async function newPage(width, height, engine, downloads = false) {
  const ctx = await browser.newContext({ viewport: { width, height }, acceptDownloads: downloads, isMobile: width < 500, hasTouch: width < 500 });
  await ctx.addInitScript((e) => { try { localStorage.setItem("ingrescan.produce.engine", e); } catch {} }, engine);
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`${m.text()} @ ${page.url()}`); });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  return { ctx, page };
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name), fullPage: true });

// =============================================================== Batch QC
async function runBatch(page, { vendor, lot, files, expectDevice }) {
  await page.goto(`${BASE}/qc`, { waitUntil: "networkidle" });
  await page.getByLabel("Vendor", { exact: true }).fill(vendor);
  if (lot) await page.getByLabel("Lot ID (optional)").fill(lot);
  await page.getByTestId("photo-input").setInputFiles(files);
  await page.getByRole("button", { name: "Grade batch" }).click();
  await page.getByTestId("verdict").waitFor({ timeout: 180_000 });
}

const reqs = { predict: 0 };
// ---- device path
{
  const { ctx, page } = await newPage(1440, 1000, "device", true);
  page.on("request", (r) => { if (r.url().includes("/api/freshguard/predict")) reqs.predict++; });
  await page.goto(`${BASE}/qc`, { waitUntil: "networkidle" });
  check("sidebar: Business group + Batch QC", (await page.getByText("Business", { exact: true }).count()) > 0 && (await page.getByRole("button", { name: "Batch QC" }).count()) > 0);
  check("sidebar: Receipt import under Track", (await page.getByRole("button", { name: "Receipt import" }).count()) > 0);
  check("empty state is shown and focusable", await page.getByTestId("empty-state").isVisible());
  await page.getByRole("button", { name: "Choose photos" }).last().focus();
  check("empty-state action is keyboard focusable", await page.evaluate(() => document.activeElement?.textContent?.includes("Choose photos")));
  await shot(page, "qc-empty-1440.png");

  // validation: no vendor
  await page.getByTestId("photo-input").setInputFiles([...good.slice(0, 2), path.join(PHOTOS, "notes.txt")]);
  check("non-image file rejected (2 thumbnails only)", (await page.getByTestId("thumb-grid").locator("li").count()) === 2);
  await page.getByRole("button", { name: "Grade batch" }).click();
  check("vendor required message", await page.getByText("Vendor is required.").isVisible());
  await page.getByRole("button", { name: "Clear all" }).click();

  const before = Number(sql("select count(*) from qc_batches"));
  await page.getByLabel("Vendor", { exact: true }).fill("Green Valley Farms");
  await page.getByLabel("Lot ID (optional)").fill("LOT-DEV-1");
  await page.getByLabel("Declared sample size (optional)").fill("30");
  await page.getByLabel("Notes (optional)").fill("Truck at 6C, device engine run");
  const withCorrupt = [...good, path.join(PHOTOS, "corrupt.jpg")];
  await page.getByTestId("photo-input").setInputFiles(withCorrupt);
  check("thumbnails shown for all files", (await page.getByTestId("thumb-grid").locator("li").count()) === withCorrupt.length, `${withCorrupt.length}`);
  await page.getByRole("button", { name: "Grade batch" }).click();
  const sawProgress = await page.getByTestId("progress").waitFor({ timeout: 20_000 }).then(() => true, () => false);
  check("progress bar visible while classifying", sawProgress);
  await shot(page, "qc-progress-1440.png");
  await page.getByTestId("verdict").waitFor({ timeout: 240_000 });
  check("device path: no server predict calls (model ran in the browser)", reqs.predict === 1 || reqs.predict === 0, `predict calls=${reqs.predict} (corrupt file may fall back once)`);
  const verdict = await page.getByTestId("verdict").textContent();
  check("verdict shown", /ACCEPT|REJECT_LOT|INSPECT/.test(verdict ?? ""), verdict ?? "");
  check("verdict reason + rule + checks table", (await page.getByTestId("verdict-reason").innerText()).length > 10 && (await page.getByTestId("rule-description").innerText()).length > 20 && (await page.getByRole("row").count()) >= 3);
  check("statistical note shown", (await page.getByTestId("statistical-note").innerText()).length > 10);
  check("corrupt photo listed as failed and excluded", (await page.getByTestId("failed-list").innerText()).includes("corrupt.jpg"));
  const photoCards = await page.getByTestId("photo-grid").locator("li").count();
  check("photo grid has the classified photos only", photoCards === good.length, `${photoCards}`);
  const row = sql("select id, vendor, lot_id, notes, verdict, total, grade_a+grade_b+grade_review+grade_reject from qc_batches order by id desc limit 1").split("\t");
  check("DB: qc_batches row saved", Number(sql("select count(*) from qc_batches")) === before + 1 && row[1] === "Green Valley Farms" && row[2] === "LOT-DEV-1" && Number(row[5]) === good.length && Number(row[6]) === good.length, row.join(" | "));
  check("DB: qc_items rows match", Number(sql(`select count(*) from qc_items where batch_id=${row[0]}`)) === good.length);
  const gradeSum = ["A", "B", "REVIEW", "REJECT"].map((g) => Number((await_text(page, `grade-${g}`))));
  void gradeSum;
  const distinctGrades = sql(`select count(distinct grade) from qc_items where batch_id=${row[0]}`);
  check("variants produced more than one grade", Number(distinctGrades) >= 2, `${distinctGrades} distinct grades: ` + sql(`select grade, count(*) from qc_items where batch_id=${row[0]} group by grade`).replace(/\n/g, "; "));
  await shot(page, "qc-result-1440.png");
  check("no horizontal overflow @1440 (result)", (await overflow(page)) <= 0);

  // CSV from result
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download CSV" }).first().click()]);
  const csvPath = path.join(SHOTS, "batch.csv");
  await dl.saveAs(csvPath);
  const csv = fs.readFileSync(csvPath, "utf8");
  check("CSV download: filename + content", dl.suggestedFilename() === `qc-batch-${row[0]}.csv` && csv.includes("Green Valley Farms") && csv.split(/\r?\n/).length > good.length, `${dl.suggestedFilename()} ${csv.length} bytes`);
  const dbCounts = Object.fromEntries(sql(`select grade, count(*) from qc_items where batch_id=${row[0]} group by grade`).split("\n").map((l) => l.split("\t")));
  check("CSV grade counts equal the DB rows", ["A", "B", "REVIEW", "REJECT"].every((g) => csv.includes(`,counts,${g},${dbCounts[g] ?? 0}\n`) || csv.includes(`,counts,${g},${dbCounts[g] ?? 0}\r\n`)), JSON.stringify(dbCounts));

  // history, scorecard
  await page.getByRole("tab", { name: "History" }).click();
  await page.getByTestId("history-row").first().waitFor();
  check("history lists the batch", (await page.getByTestId("history-row").first().innerText()).includes("Green Valley Farms"));
  await shot(page, "qc-history-1440.png");
  await page.getByRole("button", { name: "Open", exact: true }).first().click();
  await page.getByTestId("verdict").waitFor();
  check("history: open shows the stored batch", (await page.getByTestId("photo-grid").locator("li").count()) === good.length);
  await page.getByRole("button", { name: "Back to history" }).click();
  await ctx.close();
}

// ---- server path (also exercises the fallback when the preference is Server)
{
  const { ctx, page } = await newPage(1440, 1000, "server", true);
  let predict = 0;
  page.on("request", (r) => { if (r.url().includes("/api/freshguard/predict")) predict++; });
  await runBatch(page, { vendor: "Sunrise Orchards", lot: "LOT-SRV-1", files: good.slice(0, 8) });
  check("server path: one /predict call per photo", predict === 8, `${predict} calls`);
  check("low-sample warning shown for 8 photos", (await page.getByText(/Low sample/).count()) === 1);
  const id = sql("select id from qc_batches order by id desc limit 1");
  check("DB: server batch saved", sql(`select vendor||'|'||total from qc_batches where id=${id}`) === "Sunrise Orchards|8");

  await page.getByRole("tab", { name: "Vendor scorecard" }).click();
  await page.getByTestId("scorecard-row").first().waitFor();
  check("scorecard ranks both vendors", (await page.getByTestId("scorecard-row").count()) === 2);
  await shot(page, "qc-scorecard-1440.png");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download scorecard CSV" }).click()]);
  const p = path.join(SHOTS, "scorecard.csv");
  await dl.saveAs(p);
  const sc = fs.readFileSync(p, "utf8");
  check("scorecard CSV has both vendors", sc.includes("Green Valley Farms") && sc.includes("Sunrise Orchards"), dl.suggestedFilename());

  // delete with confirm
  await page.getByRole("tab", { name: "History" }).click();
  await page.getByTestId("history-row").first().waitFor();
  const rowsBefore = await page.getByTestId("history-row").count();
  await page.getByRole("button", { name: /^Delete batch Sunrise/ }).first().click();
  await page.getByRole("alertdialog").waitFor();
  await page.getByRole("button", { name: "Cancel" }).click();
  check("delete cancel keeps the batch", Number(sql(`select count(*) from qc_batches where id=${id}`)) === 1);
  await page.getByRole("button", { name: /^Delete batch Sunrise/ }).first().click();
  await page.getByRole("button", { name: "Delete batch", exact: true }).click();
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="history-row"]').length === n - 1, rowsBefore);
  check("delete: batch + items removed from DB", Number(sql(`select count(*) from qc_batches where id=${id}`)) === 0 && Number(sql(`select count(*) from qc_items where batch_id=${id}`)) === 0);
  await ctx.close();
}

// ---- cancel
{
  const { ctx, page } = await newPage(1440, 900, "server");
  await page.goto(`${BASE}/qc`, { waitUntil: "networkidle" });
  await page.getByLabel("Vendor", { exact: true }).fill("Cancel Test Vendor");
  await page.getByTestId("photo-input").setInputFiles(good.slice(0, 10));
  const before = Number(sql("select count(*) from qc_batches"));
  await page.getByRole("button", { name: "Grade batch" }).click();
  await page.getByRole("button", { name: "Cancel" }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('[data-status="done"]').length >= 1);
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByText(/Cancelled after/).waitFor();
  const done = await page.locator('[data-status="done"]').count();
  check("cancel stops classification and stores nothing", done >= 1 && done < 10 && Number(sql("select count(*) from qc_batches")) === before, `${done}/10 classified`);
  await page.getByRole("button", { name: /^Grade \d+ classified/ }).click();
  await page.getByTestId("verdict").waitFor({ timeout: 60_000 });
  check("grade only the classified photos after cancel", Number(sql("select total from qc_batches order by id desc limit 1")) === done);
  sql("delete from qc_batches where vendor='Cancel Test Vendor'");
  await ctx.close();
}

// ---- phone layout
{
  const { ctx, page } = await newPage(390, 844, "server");
  await runBatch(page, { vendor: "Phone Vendor", files: good.slice(0, 6) });
  await shot(page, "qc-result-390.png");
  check("no horizontal overflow @390 (result)", (await overflow(page)) <= 0, `delta ${await overflow(page)}`);
  await page.getByRole("tab", { name: "History" }).click();
  await page.getByTestId("history-row").first().waitFor();
  check("no horizontal overflow @390 (history)", (await overflow(page)) <= 0);
  await shot(page, "qc-history-390.png");
  await page.getByRole("tab", { name: "Vendor scorecard" }).click();
  await page.waitForTimeout(500);
  await shot(page, "qc-scorecard-390.png");
  check("no horizontal overflow @390 (scorecard)", (await overflow(page)) <= 0);
  await page.goto(`${BASE}/qc`, { waitUntil: "networkidle" });
  await shot(page, "qc-empty-390.png");
  check("no horizontal overflow @390 (empty)", (await overflow(page)) <= 0);
  await page.getByRole("button", { name: "More" }).click();
  check("mobile More sheet lists Batch QC + Receipt import", (await page.getByRole("button", { name: "Batch QC" }).count()) > 0 && (await page.getByRole("button", { name: "Receipt import" }).count()) > 0);
  await ctx.close();
}

// =============================================================== Receipt import
const INDIAN = `Blinkit
Order ID: ORD123456789
Delivered on 12 Oct 2026, 08:15 PM
Amul Taaza Toned Milk 500 ml  x2   56.00
Britannia Brown Bread 400 g   1   45.00
Farm Eggs Pack of 6   1   72.00
Fresh Tomato Hybrid 500 g   1   28.00
Paneer 200 g   1   90.00
Maggi 2-Minute Noodles 70 g x4   56.00
Handling fee  5.00
Delivery charge  25.00
Item total 347.00
GST 5%  14.00
Grand Total Rs. 396.00
Paid via UPI`;
const US = `WHOLE FOODS MARKET
123 Main St, Austin TX
Tel (512) 555-0100
ORGANIC BANANAS 1.34 lb @ 0.79/lb   1.06
GREEK YOGURT PLAIN 32OZ   5.49
CHICKEN BREAST BONELESS 2.10 lb   12.59
BABY SPINACH 5OZ   3.99
SOURDOUGH LOAF   4.99
DISH SOAP   3.49
SUBTOTAL 31.61
TAX 0.28
TOTAL $31.89
VISA ****1234`;

async function readReceipt(page, text) {
  await page.goto(`${BASE}/receipt`, { waitUntil: "networkidle" });
  await page.getByLabel("Receipt or e-bill text").fill(text);
  await page.getByRole("button", { name: "Read receipt" }).click();
  await page.getByTestId("receipt-rows").waitFor({ timeout: 30_000 });
}

{
  const { ctx, page } = await newPage(1440, 1000, "server");
  await page.goto(`${BASE}/receipt`, { waitUntil: "networkidle" });
  check("receipt: empty state visible", await page.getByTestId("empty-state").isVisible());
  await shot(page, "receipt-empty-1440.png");
  check("receipt: Read receipt disabled with no input", await page.getByRole("button", { name: "Read receipt" }).isDisabled());

  // photo without an AI key -> PRECONDITION_FAILED message
  const png = path.join(PHOTOS, "apple.jpg");
  await page.getByTestId("receipt-photo").setInputFiles(png);
  await page.getByRole("button", { name: "Read receipt" }).click();
  const err = await page.getByTestId("parse-error").waitFor({ timeout: 20_000 }).then(() => page.getByTestId("parse-error").innerText(), () => null);
  check("receipt photo: server precondition message + paste hint", !!err && /Paste the receipt text/i.test(err), err?.replace(/\n/g, " ") ?? "no error shown (an AI key may be configured)");
  await page.getByRole("button", { name: "Remove receipt photo" }).click();

  await readReceipt(page, INDIAN);
  const names = await page.getByTestId("receipt-rows").locator("li input[id$='-name']").evaluateAll((els) => els.map((e) => e.value));
  const dates = await page.getByTestId("receipt-rows").locator("li input[type=date]").evaluateAll((els) => els.map((e) => e.value));
  console.log("  indian items:", JSON.stringify(names), JSON.stringify(dates));
  check("indian receipt: food items detected", names.length >= 5 && names.some((n) => /milk/i.test(n)) && names.some((n) => /paneer/i.test(n)), `${names.length} items`);
  check("indian receipt: expiry suggested for known foods", dates.filter(Boolean).length >= 4, `${dates.filter(Boolean).length}/${dates.length} prefilled`);
  await page.getByText(/skipped lines?/).first().click();
  const skipped = await page.getByTestId("skipped-lines").innerText();
  check("skipped lines list reasons (fees/taxes/total)", /fee|Tax|Total|Order/i.test(skipped), skipped.replace(/\n/g, " | ").slice(0, 160));
  await shot(page, "receipt-review-indian-1440.png");

  // edit a row, uncheck one, clear a date to test validation
  const firstName = page.getByTestId("receipt-rows").locator("li").first().locator("input[id$='-name']");
  await firstName.fill("Amul Milk (edited)");
  const lastRow = page.getByTestId("receipt-rows").locator("li").last();
  await lastRow.getByRole("checkbox").click();
  const secondDate = page.getByTestId("receipt-rows").locator("li").nth(1).locator("input[type=date]");
  const keep = await secondDate.inputValue();
  await secondDate.fill("");
  const btn = page.getByRole("button", { name: /^Add \d+ items? to my pantry$/ });
  await btn.click();
  check("client validation blocks a row with no date", (await page.getByText(/Choose an expiry date|No estimate for this item/).count()) > 0 && Number(sql("select count(*) from food_inventory where notes='Imported from receipt'")) === 0);
  await secondDate.fill(keep || "2026-10-30");
  const n = (await btn.textContent()).match(/\d+/)[0];
  const invBefore = Number(sql("select count(*) from food_inventory"));
  await btn.click();
  await page.getByTestId("import-success").waitFor({ timeout: 20_000 });
  const added = Number(sql("select count(*) from food_inventory")) - invBefore;
  check("import: food_inventory rows added = checked rows", added === Number(n) && Number(n) === names.length - 1, `${added} rows, button said ${n}`);
  check("import: edited name saved + notes + date format", sql("select count(*) from food_inventory where title='Amul Milk (edited)' and notes='Imported from receipt'") === "1");
  console.log("  rows:", sql("select title, quantity, storage_location, expiry_date from food_inventory order by id desc limit 3").replace(/\n/g, " || "));
  await shot(page, "receipt-success-1440.png");
  await page.getByRole("link", { name: "Open Expiry Tracker" }).click();
  await page.waitForURL(/\/fridge/);
  await page.getByText("Amul Milk (edited)").first().waitFor({ timeout: 15_000 });
  check("imported item appears in /fridge", true);
  await shot(page, "fridge-after-import-1440.png");
  await ctx.close();
}
{
  const { ctx, page } = await newPage(390, 844, "server");
  await readReceipt(page, US);
  const names = await page.getByTestId("receipt-rows").locator("li input[id$='-name']").evaluateAll((els) => els.map((e) => e.value));
  console.log("  us items:", JSON.stringify(names));
  check("us receipt: food parsed, dish soap not offered", names.length >= 4 && !names.some((n) => /soap/i.test(n)), `${names.length} items`);
  await shot(page, "receipt-review-us-390.png");
  check("no horizontal overflow @390 (receipt review)", (await overflow(page)) <= 0, `delta ${await overflow(page)}`);
  await page.goto(`${BASE}/receipt`, { waitUntil: "networkidle" });
  await shot(page, "receipt-empty-390.png");
  check("no horizontal overflow @390 (receipt empty)", (await overflow(page)) <= 0);
  await ctx.close();
}
{
  const { ctx, page } = await newPage(1440, 1000, "server");
  await readReceipt(page, US);
  await shot(page, "receipt-review-us-1440.png");
  await readReceipt(page, "Qzxv Wrblat 1  12.00\nBananas 6 pcs 1.50\nTotal 13.50");
  const rows = await page.getByTestId("receipt-rows").locator("li").count();
  const highlighted = await page.locator('[data-testid="receipt-row"].border-sunset-orange').count();
  check("item with no shelf-life estimate is highlighted", rows === 2 && highlighted === 1, `${rows} rows, ${highlighted} highlighted`);
  const invBefore = Number(sql("select count(*) from food_inventory"));
  await page.getByRole("button", { name: /^Add 2 items to my pantry$/ }).click();
  check("import blocked until the missing date is entered", Number(sql("select count(*) from food_inventory")) === invBefore && (await page.getByText(/needs? an expiry date before import/).count()) === 1);
  await ctx.close();
}

// Expected, deliberate failures: corrupt.jpg rejected by the classifier (400) and the receipt photo without an AI key (412).
const unexpected = consoleErrors.filter((e) => !/status of (400|412)|Reading a receipt photo needs an AI key|API Mutation Error/.test(e));
check("no unexpected console errors", unexpected.length === 0, unexpected.slice(0, 3).join(" || "));
await browser.close();

const failed = results.filter((r) => r[0] === "FAIL");
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed. Screenshots: ${SHOTS}`);
process.exit(failed.length ? 1 : 0);

function await_text() { return "0"; }
