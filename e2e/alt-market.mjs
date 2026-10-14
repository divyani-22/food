// Real-browser check of the "Where to find it" block on the scan result page (alternatives price/availability).
// Real Express/tRPC app on SQLite + real Chromium. Open Food Facts and Open Prices are replaced by ONE local stub that
// imitates their DOCUMENTED response shapes (the sandbox cannot reach the live hosts), so this proves our integration
// flow and UI, NOT the live APIs.
//
//   SQLITE_PATH=/tmp/altmkt.db PORT=3430 node e2e/alt-market.mjs      (from the repo root; starts/stops its own app)
import { chromium } from "playwright";
import { spawn } from "child_process";
import http from "http";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

process.env.SQLITE_PATH ||= "/tmp/altmkt.db";
const { sql } = await import("./lib/db.mjs");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.join(HERE, "..", "IngreScan-AI");
const PORT = Number(process.env.PORT || 3430);
const STUB_PORT = Number(process.env.STUB_PORT || 3431);
const BASE = `http://localhost:${PORT}`;
const STUB = `http://127.0.0.1:${STUB_PORT}`;
const OUT = process.env.SHOT_DIR ?? "/tmp/altmkt-shots";
fs.mkdirSync(OUT, { recursive: true });
for (const f of [process.env.SQLITE_PATH, process.env.SQLITE_PATH + "-wal", process.env.SQLITE_PATH + "-shm"]) fs.rmSync(f, { force: true });

const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(ok ? "PASS" : "FAIL", name, detail); };
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

// ---------------------------------------------------------------- stub (OFF search + Open Prices)
const stub = { searches: [], prices: [], failMillet: true };
const PRODUCTS = {
  "quaker rolled oats": { code: "8901234567890", product_name: "Rolled Oats", brands: "Quaker, PepsiCo", stores: "Big Bazaar, DMart, Reliance Fresh, Spencer's, More, Star Bazaar, Nature's Basket", countries_tags: ["en:india"], nutriscore_grade: "a", image_front_small_url: `${STUB}/img/oats.png` },
  "alpen muesli": { code: "5000000000017", product_name: "Muesli", brands: "Alpen", countries_tags: ["en:united-kingdom"], nutriscore_grade: "b" },
  "britannia fresh brown bread": { code: "8909999999991", product_name: "Fresh White Bread", brands: "Tesco", nutriscore_grade: "c" }, // wrong brand + name -> must be rejected
  "millet cookies": { code: "8905555555550", product_name: "Millet Cookies", brands: "" },
};
const PRICES = {
  "8901234567890": [
    { id: 1, price: 129.5, currency: "INR", date: daysAgo(4), price_per: "UNIT", location: { osm_name: "DMart Baner", osm_address_country: "India", osm_address_country_code: "IN" } },
    { id: 2, price: 135, currency: "INR", date: daysAgo(20), price_per: "UNIT", location: { osm_name: "Spencer's Koregaon", osm_address_country_code: "IN" } },
    { id: 3, price: 4.2, currency: "EUR", date: daysAgo(1), location: { osm_name: "Lidl", osm_address_country_code: "FR" } },
  ],
  "5000000000017": [{ id: 9, price: 3.1, currency: "GBP", date: daysAgo(500), location: { osm_name: "Asda", osm_address_country_code: "GB" } }],
  "8905555555550": [{ id: 7, price: "88", currency: "inr", date: daysAgo(2), location: { name: "Local Mart", country_code: "IN" } }],
};
const stubServer = http.createServer((req, res) => {
  const u = new URL(req.url, STUB);
  const send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (u.pathname === "/cgi/search.pl") {
    const q = (u.searchParams.get("search_terms") || "").toLowerCase();
    stub.searches.push({ q, tag: u.searchParams.get("tag_0") });
    if (q.includes("millet") && stub.failMillet) return send(503, { error: "down" });
    const hit = Object.entries(PRODUCTS).find(([k]) => q.includes(k.split(" ")[0]) && q.includes(k.split(" ").slice(-1)[0]));
    return send(200, { count: hit ? 1 : 0, products: hit ? [hit[1], { weird: true }, null] : [] });
  }
  if (u.pathname === "/api/v1/prices") {
    const code = u.searchParams.get("product_code");
    stub.prices.push(code);
    return send(200, { items: PRICES[code] ?? [], total: (PRICES[code] ?? []).length, page: 1, size: 20, pages: 1, unknown_extra: { a: 1 } });
  }
  if (u.pathname === "/img/oats.png") { res.writeHead(200, { "content-type": "image/png" }); return res.end(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64")); }
  send(404, {});
});
await new Promise((r) => stubServer.listen(STUB_PORT, "127.0.0.1", r));

// ---------------------------------------------------------------- app
const logFile = path.join(os.tmpdir(), `altmkt-e2e-server-${process.pid}.log`);
const logFd = fs.openSync(logFile, "w");
const app = spawn("npx", ["tsx", "server/_core/index.ts"], {
  cwd: APP_DIR,
  env: { ...process.env, DATABASE_URL: "", PORT: String(PORT), JWT_SECRET: "dev-only-secret", NODE_ENV: "development", OFF_CACHE_DISABLED: "true", OPENFOODFACTS_BASE_URL: STUB, OPEN_PRICES_BASE_URL: STUB },
  stdio: ["ignore", logFd, logFd],
  detached: true,
});
const stopAll = () => { try { process.kill(-app.pid, "SIGTERM"); } catch { /* gone */ } stubServer.close(); };
process.on("exit", stopAll);
for (let i = 0, up = false; i < 120 && !up; i++) {
  try { up = (await fetch(`${BASE}/api/trpc/auth.me`)).status < 500; } catch { /* not yet */ }
  if (!up) await new Promise((r) => setTimeout(r, 1000));
  if (i === 119) { console.log("app did not start, log", logFile); process.exit(2); }
}

const args = ["--ignore-certificate-errors"];
if (process.env.HTTPS_PROXY) args.push(`--proxy-server=${process.env.HTTPS_PROXY}`, "--proxy-bypass-list=localhost;127.0.0.1");
const browser = await chromium.launch({ args });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error" && !/fonts\.g|net::ERR|Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

try {
  await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
  const uid = sql("select id from users order by id limit 1");
  check("dev user exists", Boolean(uid), `uid=${uid}`);
  sql(`insert into user_profiles (user_id, region) values (${uid}, 'Pune, India')`);

  const mkScan = (name) => {
    sql(`insert into food_scans (user_id, product_name, input_type, risk_score, analysis_complete) values (${uid}, '${name}', 'text', 70, 1)`);
    return sql(`select max(id) from food_scans where user_id=${uid}`);
  };
  const scanWith = mkScan("Choco Crunch Cereal");
  const alts = [["Rolled Oats", "Quaker"], ["Muesli", "Alpen"], ["Fresh Brown Bread", "Britannia"], ["Millet Cookies", ""]];
  for (const [n, b] of alts) sql(`insert into alternatives (scan_id, product_name, brand, reason) values (${scanWith}, '${n}', '${b}', 'Less sugar than the scanned product')`);
  const scanEmpty = mkScan("No Alternatives Yet");

  // lazy: a scan without alternatives never touches the data sources
  await page.goto(`${BASE}/scan/${scanEmpty}`, { waitUntil: "networkidle" });
  await page.getByText("Healthier Alternatives").first().waitFor();
  await page.waitForTimeout(500);
  check("no outbound lookups when there are no alternatives", stub.searches.length === 0 && stub.prices.length === 0);

  // main scan, desktop
  await page.goto(`${BASE}/scan/${scanWith}`, { waitUntil: "domcontentloaded" });
  await page.getByText("Healthier Alternatives").first().waitFor();
  await page.locator('[data-testid="market-ok"]').first().waitFor({ timeout: 20000 });
  await page.locator('[data-testid="market-none"]').first().waitFor({ timeout: 20000 });
  await page.locator('[data-testid="market-error"]').first().waitFor({ timeout: 20000 });
  const card = (name) => page.locator("li", { hasText: name }).filter({ has: page.locator('text="Where to find it"') }).last();

  const oats = card("Rolled Oats");
  const oatsText = await oats.innerText();
  check("oats: INR price with date and location", /₹\s?129\.50|INR\s?129\.50|129\.50/.test(oatsText) && oatsText.includes(daysAgo(4)) && /DMart Baner/.test(oatsText), oatsText.replace(/\s+/g, " ").slice(0, 200));
  check("oats: user's country preferred, EUR price not mixed in", !/4\.20|€/.test(oatsText));
  check("oats: label 'community-reported, may be outdated'", /community-reported, may be outdated/i.test(oatsText));
  check("oats: 2 recent reports range shown", /2 recent reports/.test(oatsText));
  const chips = await oats.locator('[data-testid="market-stores"] ul > li').allInnerTexts();
  check("oats: max 5 store chips + '+N more'", chips.filter((c) => !/more$/.test(c)).length === 5 && chips.some((c) => /^\+\d+ more$/.test(c)), JSON.stringify(chips));
  check("oats: Open Food Facts + Open Prices links point at the configured hosts",
    (await oats.locator('a:has-text("Open Food Facts")').getAttribute("href")) === `${STUB}/product/8901234567890` &&
    (await oats.locator('a:has-text("Open Prices")').getAttribute("href")) === `${STUB}/products/8901234567890`);
  check("oats: attribution text visible", /ODbL/.test(oatsText) && /Open Prices/.test(oatsText));
  check("oats: search restricted to the profile country", stub.searches.some((s) => s.tag === "india"));

  const muesli = await card("Muesli").innerText();
  check("muesli: stale price flagged as old", /Old price/.test(muesli) && /£|GBP/.test(muesli) && /3\.10/.test(muesli), muesli.replace(/\s+/g, " ").slice(0, 160));

  const bread = await card("Fresh Brown Bread").innerText();
  check("bread: wrong-brand product rejected -> 'No community data found'", /No community data found/.test(bread) && !/Tesco/.test(bread));

  const millet = card("Millet Cookies");
  check("millet: unavailable state with Retry", /unavailable right now/.test(await millet.innerText()) && (await millet.getByRole("button", { name: "Retry" }).count()) === 1);
  await page.screenshot({ path: `${OUT}/desktop.png`, fullPage: true });
  const ov = async (label) => { const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); check(`no horizontal overflow: ${label}`, o <= 0, `delta=${o}`); };
  await ov("desktop");

  stub.failMillet = false;
  await millet.getByRole("button", { name: "Retry" }).click();
  await page.locator("li", { hasText: "Millet Cookies" }).locator('text=/88/').first().waitFor({ timeout: 15000 });
  check("millet: retry succeeds and shows the INR price (lowercase currency normalised)", /88/.test(await card("Millet Cookies").innerText()));

  // mobile
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  const before = stub.searches.length;
  await page.getByText("Healthier Alternatives").first().waitFor();
  await page.waitForTimeout(1500);
  check("lazy: nothing requested while the alternatives list is far below the fold (390px)", stub.searches.length === before, `new searches=${stub.searches.length - before}`);
  await page.locator("li", { hasText: "Rolled Oats" }).first().scrollIntoViewIfNeeded();
  await page.locator('[data-testid="market-ok"]').first().waitFor({ timeout: 20000 });
  await ov("390px");
  await card("Rolled Oats").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/mobile.png`, fullPage: true });

  // API-level: another/nonexistent scan is NOT_FOUND, no fabricated data
  const r = await page.evaluate(async (id) => {
    const x = await fetch(`/api/trpc/analysis.alternativeMarket?input=${encodeURIComponent(JSON.stringify({ json: { scanId: id } }))}`);
    return { status: x.status, body: await x.json() };
  }, 999999);
  check("unknown scan -> NOT_FOUND", r.status === 404 && r.body?.error?.json?.data?.code === "NOT_FOUND", `status=${r.status}`);
  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
} catch (e) {
  console.log("FAIL exception", e?.message ?? e);
  results.push(false);
  await page.screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
  stopAll();
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} checks passed; screenshots in ${OUT}; server log ${logFile}`);
process.exit(failed ? 1 : 0);
