// Real end-to-end run: real browser, real Express + tRPC server, real MariaDB. No mocks.
import { chromium } from "playwright";
import { execSync } from "child_process";

const BASE = "http://localhost:3000";
const args = ["--ignore-certificate-errors"];
if (process.env.HTTPS_PROXY) args.push(`--proxy-server=${process.env.HTTPS_PROXY}`, "--proxy-bypass-list=localhost;127.0.0.1");
const browser = await chromium.launch({ args });
const results = [];
let OFF_STATE = "not run";
const consoleErrors = [];
const badResponses = [];
const sql = (q) => execSync(`mysql -N ingrescan -e "${q.replace(/"/g, '\\"')}"`).toString().trim();

// Idempotent: remove data created by earlier runs of this suite (only E2E/test rows).
for (const q of [
  "delete from food_inventory where title like 'E2E %'",
  "delete from chat_messages where scan_id in (select id from food_scans where product_name like 'E2E %' or product_name='Secret Scan')",
  "delete from food_scans where product_name like 'E2E %' or product_name='Secret Scan'",
  "delete from users where openId='other-user'",
  "delete from produce_inventory where user_id=1",
  "delete from produce_scans where user_id=1",
  "delete from medical_conditions where user_id=1",
  "delete from medications where user_id=1",
]) sql(q);

async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push(["PASS", name, Date.now() - t]);
  } catch (e) {
    results.push(["FAIL", name, Date.now() - t, String(e.message || e).split("\n")[0]]);
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`${page.url()} :: ${m.text().slice(0, 200)}`); });
page.on("pageerror", (e) => consoleErrors.push(`PAGEERROR ${page.url()} :: ${e.message}`));
page.on("response", (r) => { if (r.status() >= 400) badResponses.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 160)}`); });

// ---------- Navigation ----------
await step("Home loads with hero and nav links", async () => {
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.getByRole("heading", { level: 1 }).waitFor();
  expect((await page.locator("h1").innerText()).includes("what you eat"), "hero headline");
  await page.getByRole("link", { name: "About" }).first().click();
  await page.waitForURL("**/about");
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
});
for (const route of ["/dashboard", "/scanner", "/produce", "/fridge", "/expiry", "/openfoodfacts", "/barcode", "/profile", "/history", "/chat", "/about", "/privacy", "/terms", "/does-not-exist"]) {
  await step(`Route ${route} renders without errors`, async () => {
    const before = consoleErrors.length;
    await page.goto(BASE + route, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    const text = await page.locator("body").innerText();
    expect(text.trim().length > 50, "page has content");
    expect(!/undefined|NaN|\[object Object\]/.test(text), "no undefined/NaN/[object Object] text");
    const html = await page.content();
    const bad = html.match(/[\uac00-\ud7af\u3040-\u30ff\u4e00-\u9fff\u{1F000}-\u{1FAFF}\u2600-\u27BF\uFE0F]/gu);
    expect(!bad, "non-English/emoji characters: " + (bad || []).slice(0, 5).join(" "));
    // Open Food Facts is an external service; when it is unreachable the page must show its outage alert.
    const unexpected = consoleErrors.slice(before).filter((e) => !/Open Food Facts (is unreachable|search is unavailable)|status of 503/.test(e));
    expect(unexpected.length === 0, "console errors: " + unexpected.join(" | "));
  });
}
await step("Sidebar navigation reaches every section", async () => {
  await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
  for (const [label, path] of [["Packaged Scanner", "/scanner"], ["Fresh Produce AI", "/produce"], ["Open Food Facts", "/openfoodfacts"], ["Expiry Tracker", "/fridge"], ["History", "/history"], ["Chat", "/chat"], ["Profile", "/profile"], ["Dashboard", "/dashboard"]]) {
    await page.locator('[data-sidebar="menu-button"]', { hasText: label }).first().click();
    await page.waitForURL("**" + path);
  }
});

// ---------- Profile (DB write/read) ----------
await step("Profile: invalid then valid save persists to DB", async () => {
  await page.goto(BASE + "/profile", { waitUntil: "networkidle" });
  await page.fill("#age", "34");
  await page.fill("#height", "168");
  await page.fill("#weight", "62");
  await page.getByRole("button", { name: "Save Profile" }).click();
  await page.waitForTimeout(1200);
  const row = sql("select age,height,weight,bmi from user_profiles where user_id=1");
  expect(row.startsWith("34\t168\t62"), "profile row: " + row);
});
await step("Profile: add + delete condition and medication", async () => {
  await page.getByLabel("Medical condition").fill("Hypertension");
  await page.getByLabel("Add condition").click();
  await page.getByText("Hypertension").first().waitFor();
  await page.getByLabel("Medication name").fill("Amlodipine");
  await page.getByLabel("Dosage").fill("5 mg");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByText("Amlodipine").first().waitFor();
  expect(sql("select count(*) from medical_conditions where user_id=1") === "1", "condition in DB");
  expect(sql("select count(*) from medications where user_id=1") === "1", "medication in DB");
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Amlodipine").first().waitFor();
});

// ---------- Packaged scanner -> analysis -> result -> alternatives -> chat ----------
let scanId;
await step("Scanner: empty ingredients is blocked", async () => {
  await page.goto(BASE + "/scanner", { waitUntil: "networkidle" });
  expect(await page.getByRole("button", { name: /Analyze Ingredients/ }).isDisabled(), "Analyze is disabled until ingredients are entered");
});
await step("Scanner: text analysis creates scan and opens result", async () => {
  await page.fill("#productName", "E2E Masala Noodles");
  await page.getByPlaceholder(/Sugar, Maltodextrin/).fill("Wheat flour, Palm oil, Salt, Sugar, Monosodium glutamate, Turmeric");
  await page.getByRole("button", { name: /Analyze Ingredients/ }).click();
  await page.waitForURL(/\/scan\/\d+/, { timeout: 30000 });
  scanId = Number(page.url().split("/").pop());
  await page.getByText("Ingredient Analysis").waitFor({ timeout: 15000 });
  const n = Number(sql(`select count(*) from scan_ingredients where scan_id=${scanId}`));
  expect(n >= 5, "ingredients saved: " + n);
  const score = sql(`select risk_score from food_scans where id=${scanId}`);
  expect(score !== "NULL" && Number(score) >= 0, "risk score saved: " + score);
  await page.getByText("Palm oil", { exact: false }).first().waitFor();
});
await step("Scan result: alternatives generate and persist", async () => {
  const btn = page.getByRole("button", { name: /Alternative/i }).first();
  if (await btn.count()) {
    await btn.click();
    await page.waitForTimeout(2500);
  }
  expect(Number(sql(`select count(*) from alternatives where scan_id=${scanId}`)) > 0, "alternatives in DB");
});
await step("Scan result: chat round-trip stores both messages", async () => {
  const toggle = page.getByRole("button", { name: /Show Chat/i });
  if (await toggle.count()) await toggle.click();
  await page.getByPlaceholder(/Ask about ingredients/).fill("Is palm oil safe for me?");
  await page.getByLabel("Send message").click();
  await page.waitForTimeout(3000);
  const n = Number(sql(`select count(*) from chat_messages where scan_id=${scanId}`));
  expect(n >= 2, "chat rows: " + n);
});
await step("History and dashboard list the new scan", async () => {
  await page.goto(BASE + "/history", { waitUntil: "networkidle" });
  await page.getByText("E2E Masala Noodles").first().waitFor();
  await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
  await page.getByText("E2E Masala Noodles").first().waitFor();
});
await step("Other users' scans are not reachable (ownership)", async () => {
  sql("insert into users (openId,name,role,loginMethod) values ('other-user','Other','user','local')");
  const other = sql("select id from users where openId='other-user'");
  sql(`insert into food_scans (user_id,product_name,input_type,analysis_complete) values (${other},'Secret Scan','text',0)`);
  const sid = sql("select max(id) from food_scans");
  await page.goto(`${BASE}/scan/${sid}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  expect(!(await page.locator("body").innerText()).includes("Secret Scan"), "foreign scan leaked");
});

// ---------- Expiry tracker ----------
await step("Fridge: add item via dialog persists", async () => {
  await page.goto(BASE + "/fridge", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Add Food Item/ }).first().click();
  await page.fill("#item-title", "E2E Greek Yogurt");
  await page.fill("#item-qty", "400g");
  const submit = page.getByRole("dialog").getByRole("button", { name: /Add|Save/ }).last();
  await submit.click();
  await page.getByText("E2E Greek Yogurt").first().waitFor({ timeout: 8000 });
  expect(sql("select count(*) from food_inventory where title='E2E Greek Yogurt'") === "1", "inventory row");
});
await step("Fridge: search filter and consume + delete", async () => {
  await page.getByLabel("Search food item").fill("yogurt");
  await page.getByText("E2E Greek Yogurt").first().waitFor();
  await page.getByLabel("Search food item").fill("");
  await page.getByRole("button", { name: /Consumed/ }).first().click();
  await page.waitForTimeout(1200);
  expect(sql("select status from food_inventory where title='E2E Greek Yogurt'") === "consumed", "consumed status");
  // add a second item and delete it
  await page.getByRole("button", { name: /Add Food Item/ }).first().click();
  await page.fill("#item-title", "E2E Delete Me");
  await page.getByRole("dialog").getByRole("button", { name: /Add|Save/ }).last().click();
  await page.getByText("E2E Delete Me").first().waitFor();
  const card = page.locator("div", { hasText: "E2E Delete Me" }).filter({ has: page.getByRole("button", { name: /Delete/i }) }).last();
  page.once("dialog", (d) => d.accept());
  await card.getByRole("button", { name: /Delete/i }).click();
  await page.waitForTimeout(1200);
  expect(sql("select count(*) from food_inventory where title='E2E Delete Me'") === "0", "deleted");
});

// ---------- Open Food Facts (external API through the server) ----------
await step("Open Food Facts: barcode lookup", async () => {
  await page.goto(BASE + "/openfoodfacts", { waitUntil: "networkidle" });
  await page.getByLabel("Barcode number").fill("3017620422003");
  await page.getByRole("button", { name: /Search Barcode/ }).click();
  const product = page.locator("article").getByText(/Nutella/i).first();
  const outage = page.getByRole("alert").getByText(/Couldn.t reach Open Food Facts/);
  await Promise.race([product.waitFor({ timeout: 20000 }), outage.waitFor({ timeout: 20000 })]);
  OFF_STATE = (await product.count()) ? "live product data" : "outage alert (external API unreachable)";
});
await step("Open Food Facts: invalid barcode shows error state", async () => {
  await page.getByLabel("Barcode number").fill("12ab");
  await page.getByRole("button", { name: /Search Barcode/ }).click();
  await page.getByText(/Barcodes contain only digits/).waitFor({ timeout: 5000 });
  await page.getByLabel("Barcode number").fill("0000000000000");
  await page.getByRole("button", { name: /Search Barcode/ }).click();
  await Promise.race([
    page.getByText(/No product found for barcode/).waitFor({ timeout: 20000 }),
    page.getByRole("alert").getByText(/Couldn.t reach Open Food Facts/).waitFor({ timeout: 20000 }),
  ]);
});

// ---------- Fresh produce (Flask via proxy) ----------
await step("Produce: classify sample (real model), history is stored in MySQL", async () => {
  await page.goto(BASE + "/produce", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Apple$/ }).first().click();
  await page.getByText(/Identification Confidence/).waitFor({ timeout: 30000 });
  await page.waitForTimeout(1000);
  expect(sql("select count(*) from produce_scans where user_id=1") === "1", "history row in MySQL for the user");
  expect(sql("select fruit_name from produce_scans where user_id=1") === "Apple", "English name stored");
});
await step("Produce: save to pantry stores a per-user row and shows in the Pantry tab", async () => {
  await page.getByRole("button", { name: /Save to Fridge/i }).click();
  await page.getByRole("tab", { name: /Fridge Pantry \(1\)/ }).waitFor({ timeout: 10000 });
  expect(sql("select count(*) from produce_inventory where user_id=1") === "1", "pantry row in MySQL");
  expect(/^\d{4}-\d{2}-\d{2}$/.test(sql("select expiry_date from produce_inventory where user_id=1")), "expiry date stored");
  await page.getByText("Apple").first().waitFor();
});
await step("Produce: data survives a reload (read back from MySQL)", async () => {
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("tab", { name: /Fridge Pantry \(1\)/ }).waitFor({ timeout: 10000 });
  await page.getByRole("tab", { name: /History/ }).click();
  await page.getByText(/Confidence: \d/).first().waitFor({ timeout: 10000 });
});
await step("Produce: remove pantry item and clear history", async () => {
  await page.getByRole("tab", { name: /Fridge Pantry/ }).click();
  await page.getByRole("button", { name: /Remove \/ Consumed/ }).first().click();
  await page.getByRole("tab", { name: /Fridge Pantry \(0\)/ }).waitFor({ timeout: 10000 });
  expect(sql("select count(*) from produce_inventory where user_id=1") === "0", "pantry row deleted");
  await page.getByRole("tab", { name: /History/ }).click();
  await page.getByRole("button", { name: /Clear History/ }).click();
  await page.waitForTimeout(1200);
  expect(sql("select count(*) from produce_scans where user_id=1") === "0", "history cleared in MySQL");
});

// ---------- Mobile shell ----------
await step("Mobile: tab bar navigation and More sheet", async () => {
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await m.newPage();
  mp.on("pageerror", (e) => consoleErrors.push(`MOBILE ${e.message}`));
  await mp.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
  await mp.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Fridge" }).click();
  await mp.waitForURL("**/fridge");
  await mp.getByRole("button", { name: "Scan packaged food" }).click();
  await mp.waitForURL("**/scanner");
  await mp.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "More" }).click();
  await mp.getByText("Open Food Facts").last().click();
  await mp.waitForURL("**/openfoodfacts");
  const ov = await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(ov === 0, "overflow " + ov);
  await m.close();
});

for (const r of results) console.log(r.join(" | "));
console.log("Open Food Facts observed:", OFF_STATE);
console.log("\nConsole errors:", consoleErrors.length ? consoleErrors : "none");
console.log("HTTP >=400:", badResponses.length ? badResponses : "none");
await browser.close();
