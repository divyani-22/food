// Real end-to-end check of the e-bill import path on /receipt (upload .eml / .html / .txt, paste, errors). No mocks.
//
// ALL BILLS HERE ARE SYNTHETIC: hand-written imitations of typical grocery-delivery e-bill layouts. They are not
// real bills from Instacart, Blinkit, Zepto, BigBasket, Swiggy Instamart or Amazon Fresh, so this script proves the
// plumbing and the parser on these shapes only, NOT accuracy on real bills.
//
// Needs a running web app on your own port (dev mode signs in automatically; zero-config SQLite):
//   cd IngreScan-AI && SQLITE_PATH=/tmp/ebill.db PORT=3420 NODE_ENV=development node --import=tsx ./server/_core/index.ts
// Run from the repo root:  SQLITE_PATH=/tmp/ebill.db BASE_URL=http://localhost:3420 node e2e/ebill-import.mjs
// Env: BASE_URL (default http://localhost:3420), SQLITE_PATH / DATABASE_URL (same DB as the app), SHOT_DIR (screenshots)
import { chromium } from "playwright";
import fs from "fs";
import os from "os";
import path from "path";
import { sql } from "./lib/db.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3420";
const SHOTS = process.env.SHOT_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), "ebill-shots-"));
const FILES = fs.mkdtempSync(path.join(os.tmpdir(), "ebill-files-"));

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -  " + detail : ""}`);
};

// ---- synthetic fixtures; order dates are relative to today so they always fall in the accepted window
const DAY = 86_400_000;
const orderDay = new Date(Date.now() - 2 * DAY);
const iso = orderDay.toISOString().slice(0, 10);
const long = orderDay.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const us = orderDay.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const RUPEE = "&#8377;";

const qpEncode = (s) => {
  let out = "";
  let col = 0;
  for (const byte of Buffer.from(s, "utf8")) {
    if (byte === 10) { out += "\r\n"; col = 0; continue; }
    const piece = byte === 61 || byte > 126 || byte < 32 ? "=" + byte.toString(16).toUpperCase().padStart(2, "0") : String.fromCharCode(byte);
    if (col + piece.length > 74) { out += "=\r\n"; col = 0; }
    out += piece; col += piece.length;
  }
  return out;
};

const INSTACART_EML = [
  "From: Instacart <orders@mail.instacart.com>",
  "Subject: Your Instacart receipt",
  `Date: ${orderDay.toUTCString()}`,
  "MIME-Version: 1.0",
  'Content-Type: multipart/alternative; boundary="b1"',
  "",
  "--b1",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Open this email in a browser to see your receipt.",
  "--b1",
  "Content-Type: text/html; charset=utf-8",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  qpEncode(`<html><body><script>window.EVIL = 1</script><div>Your Instacart receipt</div><div>Delivered ${us}</div><table>
<tr><td>Organic Bananas</td><td>2.1 lb</td><td>$1.89</td></tr>
<tr><td>Kirkland Greek Yogurt Plain 32 oz</td><td>Qty: 2</td><td>$10.98</td></tr>
<tr><td>Fresh Salmon Fillet</td><td>1 lb</td><td>$12.99</td></tr>
<tr><td>Zxqv Plorbo Gizmo Deluxe</td><td>1</td><td>$8.49</td></tr>
<tr><td>Dawn Dish Soap 19 oz</td><td>1</td><td>$3.99</td></tr>
<tr><td>Service fee</td><td>$3.99</td></tr><tr><td>Tip</td><td>$4.00</td></tr>
<tr><td>Total</td><td>$41.82</td></tr></table></body></html>`),
  "--b1--",
  "",
].join("\r\n");

const BLINKIT_HTML = `<html><head><title>Your Blinkit order</title></head><body><table>
<tr><td>Blinkit</td></tr><tr><td>Order placed on ${long}</td></tr>
<tr><td>Amul Taaza Toned Milk (500 ml)</td><td>2 x ${RUPEE}27</td><td>${RUPEE}54</td></tr>
<tr><td>Fresho Onion (1 kg)</td><td>1 unit</td><td>${RUPEE}40</td></tr>
<tr><td>Britannia Brown Bread 400 g</td><td>${RUPEE}45</td></tr>
<tr><td>Surf Excel Matic Liquid 1 L</td><td>${RUPEE}230</td></tr>
<tr><td>Handling charge</td><td>${RUPEE}4</td></tr><tr><td>Grand total</td><td>${RUPEE}373</td></tr></table></body></html>`;

const AMAZON_FRESH_TXT = `Amazon Fresh
Order Placed: ${us}
2 x Organic Strawberries 16 oz
Sold by: Amazon.com Services LLC
$7.98
Fresh Whole Chicken 4 lb   $11.96
Bounty Paper Towels 6 rolls   $9.99
Item(s) Subtotal: $29.93
Grand Total: $29.93`;

const w = (name, content) => {
  const p = path.join(FILES, name);
  fs.writeFileSync(p, content);
  return p;
};
const eml = w("instacart.eml", INSTACART_EML);
const htm = w("blinkit.html", BLINKIT_HTML);
const txt = w("amazon-fresh.txt", AMAZON_FRESH_TXT);
const pdf = w("bill.pdf", "%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");
const big = w("huge.html", "<td>Milk Rs 40</td>\n".repeat(80_000)); // > 1 MB

const args = ["--ignore-certificate-errors"];
if (process.env.HTTPS_PROXY) args.push(`--proxy-server=${process.env.HTTPS_PROXY}`, "--proxy-bypass-list=localhost;127.0.0.1");
const browser = await chromium.launch({ args });
const consoleErrors = [];
async function newPage(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 500, hasTouch: width < 500 });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`${m.text()} @ ${page.url()}`); });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const rowsOf = (page) =>
  page.getByTestId("receipt-rows").locator("li").evaluateAll((lis) =>
    lis.map((li) => ({
      name: li.querySelector("input[id$='-name']").value,
      date: li.querySelector("input[type=date]").value,
      included: li.getAttribute("data-included") === "true",
      doubt: li.querySelector("[data-testid=line-doubt]")?.getAttribute("data-level") ?? null,
    })),
  );

// =============================================================== desktop: errors, .eml, import
{
  const { ctx, page } = await newPage(1440, 1000);
  await page.goto(`${BASE}/receipt`, { waitUntil: "networkidle" });
  check("upload e-bill control present", (await page.getByTestId("ebill-file").count()) === 1);
  check("Read receipt disabled with no input", await page.getByRole("button", { name: "Read receipt" }).isDisabled());

  await page.getByTestId("ebill-file").setInputFiles(pdf);
  const pdfMsg = await page.getByTestId("ebill-error").innerText();
  check("PDF upload is refused with a clear message", /PDF e-bills are not supported/.test(pdfMsg) && /paste/i.test(pdfMsg), pdfMsg.replace(/\n/g, " "));
  check("no file chip after a refused PDF", (await page.getByTestId("ebill-chip").count()) === 0 && (await page.getByRole("button", { name: "Read receipt" }).isDisabled()));

  await page.getByTestId("ebill-file").setInputFiles(big);
  const bigMsg = await page.getByTestId("ebill-error").innerText();
  check("file over 1 MB is refused", /larger than 1 MB/.test(bigMsg), bigMsg.replace(/\n/g, " "));

  await page.getByTestId("ebill-file").setInputFiles(eml);
  await page.getByTestId("ebill-chip").waitFor();
  check("valid .eml accepted and error cleared", (await page.getByTestId("ebill-error").count()) === 0);
  await page.getByRole("button", { name: "Read receipt" }).click();
  await page.getByTestId("receipt-rows").waitFor({ timeout: 30_000 });

  const merchant = await page.getByTestId("merchant-tag").innerText();
  const orderDate = await page.getByTestId("order-date").innerText();
  check("merchant detected from the sender", /Instacart/.test(merchant), merchant);
  check("order date shown", /Order date/.test(orderDate), orderDate);
  const rows = await rowsOf(page);
  console.log("  rows:", JSON.stringify(rows));
  const names = rows.map((r) => r.name);
  check("food items listed", ["Bananas", "Yogurt", "Salmon"].every((k) => names.some((n) => n.includes(k))), names.join(" | "));
  check("non-food, fee, tip and total lines not offered", !names.some((n) => /soap|fee|tip|total/i.test(n)));
  check("script content from the email did not run", (await page.evaluate(() => window.EVIL)) === undefined);
  check("expiry dates start from the order date, not before it", rows.filter((r) => r.date).every((r) => r.date >= iso), `order ${iso}`);
  const gizmo = rows.find((r) => /gizmo/i.test(r.name));
  check("unrecognised product is flagged doubtful and unticked", !!gizmo && gizmo.doubt === "low" && gizmo.included === false);
  check("recognised foods are ticked", rows.filter((r) => /banana|yogurt/i.test(r.name)).every((r) => r.included));
  const salmon = rows.find((r) => /salmon/i.test(r.name));
  check("fish whose estimate lapsed before today (order was 2 days ago) is flagged and unticked", !!salmon && salmon.included === false && salmon.doubt === "low" && salmon.date < new Date().toISOString().slice(0, 10), `${salmon?.date}`);
  await shot(page, "ebill-review-instacart-1440.png");
  await page.getByText(/skipped lines?/).first().click();
  const skipped = await page.getByTestId("skipped-lines").innerText();
  check("skipped lines include non-food and fees", /Not a food item/.test(skipped) && /Fee or charge/.test(skipped), skipped.replace(/\n/g, " | ").slice(0, 140));

  const btn = page.getByRole("button", { name: /^Add \d+ items? to my pantry$/ });
  const nBtn = Number((await btn.textContent()).match(/\d+/)[0]);
  check("Add button counts only ticked rows", nBtn === rows.filter((r) => r.included).length, `${nBtn}`);
  const before = Number(sql("select count(*) from food_inventory"));
  await btn.click();
  await page.getByTestId("import-success").waitFor({ timeout: 20_000 });
  const added = Number(sql("select count(*) from food_inventory")) - before;
  check("import adds exactly the ticked rows", added === nBtn, `${added} rows`);
  const dbDates = sql("select expiry_date from food_inventory order by id desc limit " + added).split("\n");
  const asIso = (v) => (/^\d+$/.test(String(v)) ? new Date(Number(v) < 1e11 ? Number(v) * 1000 : Number(v)).toISOString().slice(0, 10) : String(v).slice(0, 10));
  check("saved expiry dates are on/after the order date", dbDates.every((d) => asIso(d) >= iso), dbDates.map(asIso).join(","));
  await shot(page, "ebill-success-1440.png");
  await ctx.close();
}

// =============================================================== mobile 390: .html upload + paste of plain bill text
{
  const { ctx, page } = await newPage(390, 844);
  await page.goto(`${BASE}/receipt`, { waitUntil: "networkidle" });
  check("no horizontal overflow @390 (empty form with e-bill upload)", (await overflow(page)) <= 0, `delta ${await overflow(page)}`);
  await shot(page, "ebill-form-390.png");
  await page.getByTestId("ebill-file").setInputFiles(htm);
  await page.getByRole("button", { name: "Read receipt" }).click();
  await page.getByTestId("receipt-rows").waitFor({ timeout: 30_000 });
  const merchant = await page.getByTestId("merchant-tag").innerText();
  const rows = await rowsOf(page);
  console.log("  rows:", JSON.stringify(rows));
  check("Blinkit html: merchant + order date", /Blinkit/.test(merchant) && (await page.getByTestId("order-date").innerText()).includes(String(orderDay.getUTCFullYear())));
  check("Blinkit html: 3 food rows, detergent excluded", rows.length === 3 && !rows.some((r) => /surf|excel/i.test(r.name)), rows.map((r) => r.name).join(" | "));
  check("no horizontal overflow @390 (review)", (await overflow(page)) <= 0, `delta ${await overflow(page)}`);
  await shot(page, "ebill-review-blinkit-390.png");

  // pasted text path (no file): Amazon Fresh style bill
  await page.getByRole("button", { name: "Remove e-bill file" }).click();
  await page.getByLabel("Receipt or e-bill text").fill(AMAZON_FRESH_TXT);
  await page.getByRole("button", { name: "Read receipt" }).click();
  await page.waitForFunction(() => document.querySelector("[data-testid=merchant-tag]")?.textContent?.includes("Amazon Fresh"), null, { timeout: 30_000 });
  const rows2 = await rowsOf(page);
  check("pasted Amazon Fresh text: 2 food rows, paper towels excluded", rows2.length === 2 && !rows2.some((r) => /towel/i.test(r.name)), rows2.map((r) => r.name).join(" | "));
  await shot(page, "ebill-review-amazon-390.png");
  await ctx.close();
}

// =============================================================== desktop: .txt upload
{
  const { ctx, page } = await newPage(1440, 900);
  await page.goto(`${BASE}/receipt`, { waitUntil: "networkidle" });
  await page.getByTestId("ebill-file").setInputFiles(txt);
  await page.getByRole("button", { name: "Read receipt" }).click();
  await page.getByTestId("receipt-rows").waitFor({ timeout: 30_000 });
  check(".txt upload parsed as Amazon Fresh", /Amazon Fresh/.test(await page.getByTestId("merchant-tag").innerText()));
  await ctx.close();
}

await browser.close();
const unexpected = consoleErrors.filter((e) => !/favicon|Failed to load resource/i.test(e));
check("no unexpected console errors", unexpected.length === 0, unexpected.slice(0, 3).join(" || "));
console.log(`\nscreenshots: ${SHOTS}`);
const failed = results.filter((x) => !x).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
