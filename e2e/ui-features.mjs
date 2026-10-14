// Real-browser check of the pantry-intelligence UI (ethylene alerts, rescue recipes, health alerts, WhatsApp card).
// Needs: web app on BASE_URL (default http://localhost:3104) running in dev mode (auto sign-in) with SQLITE_PATH pointing at
// the DB used by e2e/lib/db.mjs, and the WhatsApp env set (TWILIO_*, WHATSAPP_BOT_NUMBER) for the "configured" states.
// Run from the repo root:  SQLITE_PATH=/tmp/ui1.db node e2e/ui-features.mjs
import { chromium } from "playwright";
import { sql } from "./lib/db.mjs";
import fs from "fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3104";
const OUT = process.env.SHOT_DIR ?? "/tmp/ui1-shots";
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => { results.push([ok ? "PASS" : "FAIL", name, detail]); console.log(ok ? "PASS" : "FAIL", name, detail); };

const args = ["--ignore-certificate-errors"];
if (process.env.HTTPS_PROXY) args.push(`--proxy-server=${process.env.HTTPS_PROXY}`, "--proxy-bypass-list=localhost;127.0.0.1");
const browser = await chromium.launch({ args });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error" && !/fonts\.g|net::ERR|Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

const rpc = (proc, input, mutate = true) => page.evaluate(async ([proc, input, mutate]) => {
  const url = `/api/trpc/${proc}` + (mutate ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input ?? null }))}`);
  const r = await fetch(url, { method: mutate ? "POST" : "GET", headers: { "content-type": "application/json" }, body: mutate ? JSON.stringify({ json: input ?? null }) : undefined });
  const b = await r.json();
  return { status: r.status, data: b?.result?.data?.json, error: b?.error?.json?.message };
}, [proc, input, mutate]);

const day = (n) => { const d = new Date(Date.now() + n * 86_400_000); return d.toISOString().slice(0, 10); };
const noOverflow = async (label) => {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`no horizontal overflow: ${label}`, o <= 0, `delta=${o}`);
};
const shot = async (name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

// ---- sign in (dev auto-login) and seed
await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
const uid = sql("select id from users order by id limit 1");
check("dev user exists", Boolean(uid), `uid=${uid}`);
sql(`delete from produce_inventory where user_id=${uid}`);
sql(`delete from food_inventory where user_id=${uid}`);
sql(`delete from medical_conditions where user_id=${uid}`);
sql(`delete from medications where user_id=${uid}`);
sql(`delete from user_profiles where user_id=${uid}`);
sql(`delete from whatsapp_links where user_id=${uid}`);
sql(`delete from whatsapp_link_codes where user_id=${uid}`);

// health alerts without any profile first (needs a scan)
const scan = await rpc("scanner.createScan", { productName: "Choco Crunch Cereal", inputType: "text", rawIngredients: "Sugar, Glucose Syrup, Maltodextrin, Palm Oil, Salt" });
const scanId = scan.data?.scanId;
check("scan created", Number.isInteger(scanId), JSON.stringify(scan.error ?? ""));
sql(`update food_scans set risk_score=72, analysis_complete=1 where id=${scanId}`);
for (const [n, c, r] of [["Sugar", "Sweetener", "high"], ["Glucose Syrup", "Sweetener", "high"], ["Maltodextrin", "Carbohydrate", "moderate"], ["Palm Oil", "Oil", "moderate"], ["Salt", "Mineral", "low"]]) {
  sql(`insert into scan_ingredients (scan_id,name,category,risk_level) values (${scanId},'${n}','${c}','${r}')`);
}

await page.goto(`${BASE}/scan/${scanId}`, { waitUntil: "networkidle" });
await page.getByText("Alerts for you").first().waitFor();
let body = await page.locator("main, body").first().innerText();
check("health alerts: profile prompt shown with no profile", /Add your health conditions/.test(body));
check("health alerts: link to /profile", (await page.locator('a[href="/profile"]').count()) > 0);
check("health alerts: disclaimer visible", /not medical advice/i.test(body));
check("health alerts: never says safe", !/\bsafe\b/i.test(await page.locator('section[aria-label="Alerts for you"]').innerText()));
await shot("scan-noprofile-1440");

// diabetic condition via profile UI-equivalent API, then reload
const cond = await rpc("profile.addMedicalCondition", { condition: "Type 2 Diabetes" });
check("condition added", !cond.error, cond.error ?? "");
await page.reload({ waitUntil: "networkidle" });
await page.getByText("Alerts for you").first().waitFor();
await page.waitForTimeout(500);
const panel = page.locator('section[aria-label="Alerts for you"]');
const ptxt = await panel.innerText();
check("health alerts: diabetes alert rendered", /diabet/i.test(ptxt) && /Triggered by/.test(ptxt) && /Source/.test(ptxt), ptxt.slice(0, 200).replace(/\n/g, " | "));
check("health alerts: no profile prompt now", !/Add your health conditions/.test(ptxt));
check("health alerts: severity tag shown", /Important|Caution|Note/.test(ptxt));
await shot("scan-diabetes-1440");
await noOverflow("scan 1440");
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
await shot("scan-diabetes-390");
await noOverflow("scan 390");
await page.setViewportSize({ width: 1440, height: 900 });

// ---- pantry seed
const exp = (name, fruit, d) => rpc("produce.addInventory", { name, fruit, freshness: "fresh", pFresh: 80, confidence: 90, expiryDate: day(d) });
for (const [n, f, d] of [["Banana", "banana", 4], ["Cucumber", "cucumber", 6], ["Apple", "apple", 10]]) {
  const r = await exp(n, f, d); check(`produce seeded: ${n}`, !r.error, r.error ?? "");
}
const milk = await rpc("inventory.add", { title: "Spinach", category: "Vegetables", quantity: "1", storageLocation: "fridge", expiryDate: day(1) });
check("packaged item expiring tomorrow", !milk.error, milk.error ?? "");
const old = await rpc("inventory.add", { title: "Old yoghurt", category: "Dairy", quantity: "1", storageLocation: "fridge", expiryDate: day(-2) });
check("expired item seeded", !old.error, old.error ?? "");

// ---- Fridge tracker: ethylene + rescue
await page.goto(`${BASE}/fridge`, { waitUntil: "networkidle" });
const eth = page.locator('section[aria-label="Storage alerts"]');
await eth.waitFor();
await page.waitForTimeout(500);
const etxt = await eth.innerText();
check("ethylene: banana/cucumber alert listed", /banana/i.test(etxt) && /cucumber/i.test(etxt), etxt.slice(0, 220).replace(/\n/g, " | "));
check("ethylene: severity tag + advice", /Warning|Tip/.test(etxt));
await page.getByRole("button", { name: "Rescue my fridge" }).click();
const rescue = page.locator('section[aria-label="Rescue my fridge"]');
await rescue.locator("article").first().waitFor({ timeout: 20000 });
const rtxt = await rescue.innerText();
check("rescue: recipes shown", (await rescue.locator("article").count()) > 0);
check("rescue: source badge", /Offline template|\bAI\b/.test(rtxt), /Offline template/.test(rtxt) ? "offline" : "ai");
check("rescue: min/serves/uses/steps", /min/.test(rtxt) && /Serves/.test(rtxt) && /Uses:/.test(rtxt) && (await rescue.locator("ol li").count()) > 0);
check("rescue: spinach is being used", /Spinach/.test(rtxt));
check("rescue: check before use lists expired item", /Check before use/.test(rtxt) && /Old yoghurt/.test(rtxt));
await shot("fridge-1440");
await noOverflow("fridge 1440");
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
await shot("fridge-390");
await noOverflow("fridge 390");
await page.setViewportSize({ width: 1440, height: 900 });

// ---- Dashboard rescue
await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
check("dashboard: rescue card present", (await page.locator('section[aria-label="Rescue my fridge"]').count()) === 1);
await page.getByRole("button", { name: "Rescue my fridge" }).click();
await page.locator('section[aria-label="Rescue my fridge"] article').first().waitFor({ timeout: 20000 });
await shot("dashboard-1440");
await noOverflow("dashboard 1440");
await page.setViewportSize({ width: 390, height: 844 });
await shot("dashboard-390");
await noOverflow("dashboard 390");
await page.setViewportSize({ width: 1440, height: 900 });

// ---- Rescue empty state
sql(`delete from food_inventory where user_id=${uid}`);
sql(`delete from produce_inventory where user_id=${uid}`);
sql(`insert into produce_inventory (user_id,name,fruit_type,freshness,p_fresh,confidence,expiry_date) values (${uid},'Apple','apple','fresh',80,90,'${day(20)}')`);
await page.reload({ waitUntil: "networkidle" });
await page.getByRole("button", { name: "Rescue my fridge" }).click();
await page.getByText(/Nothing expires within 3 days/).waitFor({ timeout: 10000 });
check("rescue: empty state", true);
// restore seed for later screens
sql(`delete from produce_inventory where user_id=${uid}`);
for (const [n, f, d] of [["Banana", "banana", 4], ["Cucumber", "cucumber", 6], ["Apple", "apple", 10]]) await exp(n, f, d);

// ---- Produce scanner pantry tab
await page.goto(`${BASE}/produce`, { waitUntil: "networkidle" });
await page.getByRole("tab", { name: /pantry|fridge|inventory/i }).first().click();
await page.locator('section[aria-label="Storage alerts"]').waitFor();
await page.waitForTimeout(500);
check("produce pantry tab: ethylene alerts", /banana/i.test(await page.locator('section[aria-label="Storage alerts"]').innerText()));
await shot("produce-pantry-1440");
await noOverflow("produce 1440");
await page.setViewportSize({ width: 390, height: 844 });
await shot("produce-pantry-390");
await noOverflow("produce 390");
await page.setViewportSize({ width: 1440, height: 900 });

// ---- WhatsApp card
await page.goto(`${BASE}/profile`, { waitUntil: "networkidle" });
await page.getByText("Get expiry reminders").waitFor();
await page.getByRole("button", { name: "Generate link code" }).click();
await page.getByText(/Open WhatsApp on your phone/).waitFor();
const wa = await page.locator("main, body").first().innerText();
const code = (wa.match(/LINK ([A-Z0-9]{4,12})/) ?? [])[1];
check("whatsapp: link code shown", Boolean(code), `code=${code}`);
check("whatsapp: bot number + expiry", /\+14155238886/.test(wa) && /Expires in \d+:\d\d/.test(wa));
check("whatsapp: code stored hashed in DB", sql(`select count(*) from whatsapp_link_codes where user_id=${uid}`) === "1" && !sql("select code_hash from whatsapp_link_codes").includes(code ?? "~"));
await shot("profile-code-1440");
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
await shot("profile-code-390");
await noOverflow("profile code 390");
await page.setViewportSize({ width: 1440, height: 900 });

// simulate the bot linking the phone, then the card should flip to linked on its own (polling)
sql(`insert into whatsapp_links (user_id,phone,timezone,reminder_hour,reminders_enabled) values (${uid},'+919876543210','UTC',9,1)`);
await page.getByText("Connected").waitFor({ timeout: 15000 });
const linkedTxt = await page.locator("main, body").first().innerText();
check("whatsapp: linked state masks phone", /\+91\*+210/.test(linkedTxt) && !/9876543210/.test(linkedTxt));
await page.locator("#wa-tz").click();
await page.getByRole("option", { name: "Asia/Kolkata", exact: true }).click();
await page.waitForTimeout(800);
await page.locator("#wa-hour").click();
await page.getByRole("option", { name: "6:00 PM", exact: true }).click();
await page.waitForTimeout(800);
await page.locator("#wa-reminders").click();
await page.waitForTimeout(800);
await page.reload({ waitUntil: "networkidle" });
await page.getByText("Connected").waitFor();
const row = sql(`select timezone,reminder_hour,reminders_enabled from whatsapp_links where user_id=${uid}`);
check("whatsapp: prefs persisted in DB", row === "Asia/Kolkata\t18\t0", row);
check("whatsapp: prefs shown after reload", /Asia\/Kolkata/.test(await page.locator("#wa-tz").innerText()) && /6:00 PM/.test(await page.locator("#wa-hour").innerText()) && (await page.locator("#wa-reminders").getAttribute("aria-checked")) === "false");
await shot("profile-linked-1440");
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
await shot("profile-linked-390");
await noOverflow("profile linked 390");
await page.setViewportSize({ width: 1440, height: 900 });
await page.getByRole("button", { name: "Disconnect" }).click();
await page.getByRole("alertdialog").waitFor();
await shot("profile-disconnect-confirm");
await page.getByRole("button", { name: "Keep connected" }).click();
check("whatsapp: cancel keeps link", sql(`select count(*) from whatsapp_links where user_id=${uid}`) === "1");
await page.getByRole("button", { name: "Disconnect" }).click();
await page.getByRole("alertdialog").getByRole("button", { name: "Disconnect" }).click();
await page.getByRole("button", { name: "Generate link code" }).waitFor();
check("whatsapp: disconnect removes link", sql(`select count(*) from whatsapp_links where user_id=${uid}`) === "0");
// existing profile fields still present
check("profile: existing sections intact", (await page.getByText("Personal Details").count()) > 0 && (await page.getByText("Medical Conditions").count()) > 0 && (await page.getByText("Type 2 Diabetes").count()) > 0);

check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" || "));
await browser.close();
const fails = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - fails} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
