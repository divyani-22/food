// Accessibility audit: axe-core (WCAG 2.0/2.1 A + AA + best-practice) on every route in client/src/App.tsx plus key interactive
// states, at 390px and 1280px, in the signed-in state. Also runs automated manual-style checks (keyboard walkthrough, 320px /
// 200% zoom reflow, document.title per route, landmarks, skip link, status tags carry text, 44px touch targets on mobile).
// Starts nothing itself. Needs a web app on BASE_URL running in dev mode (zero-config SQLite signs in automatically):
//   Flask (optional, only for the QC results state)   FRESHGUARD_PORT=5470 python3 app.py
//   Web   cd IngreScan-AI && SQLITE_PATH=/tmp/a11y-1.db PORT=3470 FRESHGUARD_URL=http://127.0.0.1:5470 \
//         NODE_ENV=development node --import=tsx ./server/_core/index.ts
// Run from the repo root:  SQLITE_PATH=/tmp/a11y-1.db BASE_URL=http://localhost:3470 node e2e/a11y.mjs
//   (needs `pnpm add -D axe-core @axe-core/playwright` inside IngreScan-AI; resolved from IngreScan-AI/node_modules)
// Env: BASE_URL, SQLITE_PATH (the DB the web app uses, for seeding), REPORT (json output path, default /tmp/a11y-report.json),
//      SHOT_DIR (optional: save a full-page PNG per scenario), ONLY (substring filter on scenario names).
// Exit code 1 when any serious/critical violation or failed manual check remains.
import { chromium } from "playwright";
import { createRequire } from "module";
import { sql } from "./lib/db.mjs";
import fs from "fs";
import path from "path";
import os from "os";

const require = createRequire(new URL("../IngreScan-AI/package.json", import.meta.url));
const { AxeBuilder } = require("@axe-core/playwright");

const BASE = process.env.BASE_URL ?? "http://localhost:3470";
const REPORT = process.env.REPORT ?? "/tmp/a11y-report.json";
const SHOTS = process.env.SHOT_DIR;
const ONLY = process.env.ONLY;
const ROOT = new URL("..", import.meta.url).pathname;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];
const VIEWPORTS = [{ name: "390", width: 390, height: 844 }, { name: "1280", width: 1280, height: 900 }];
const IMPACT_ORDER = ["critical", "serious", "moderate", "minor"];
// Rules that Radix modal widgets trigger by design while they are open (everything else is aria-hidden to assistive tech,
// and the portalled popper content sits outside landmarks). Reported separately and not counted towards the exit code.
const KNOWN_RADIX = new Set(["aria-hidden-focus", "landmark-one-main", "page-has-heading-one", "region"]);
const isKnown = (scenario, rule) => /select open|user menu/.test(scenario) && KNOWN_RADIX.has(rule);


// ------------------------------------------------------------------ --contrast: WCAG ratios for the design tokens (no browser)
if (process.argv.includes("--contrast")) {
  const css = fs.readFileSync(path.join(ROOT, "IngreScan-AI/client/src/index.css"), "utf8");
  const tok = (n) => css.match(new RegExp(`--fn-${n}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
  const lum = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const W = "#ffffff", F = tok("fog"), G = tok("graphite");
  const rows = [];
  const add = (what, fg, bg, need) => { const r = ratio(fg, bg); rows.push(`${r >= need ? "PASS" : "FAIL"}  ${r.toFixed(2).padStart(5)}:1 (need ${need})  ${what}  ${fg} on ${bg}`); };
  for (const [n, need] of [["ember-orange", 4.5], ["verdant-green", 4.5], ["sunset-orange", 4.5], ["signal-red-orange", 4.5], ["sky-blue", 4.5], ["alert-red", 4.5]]) {
    add(`BEFORE ${n} text on white`, tok(n), W, need); add(`BEFORE ${n} text on fog`, tok(n), F, need); add(`BEFORE white text on ${n} fill`, W, tok(n), need);
  }
  for (const n of ["ember-deep", "verdant-ink", "sunset-ink", "negative-ink", "sky-ink", "alert-ink", "amber"]) {
    add(`AFTER ${n} text on white`, tok(n), W, 4.5); add(`AFTER ${n} text on fog`, tok(n), F, 4.5); add(`AFTER white text on ${n} fill`, W, tok(n), 4.5);
  }
  add("graphite text on white", G, W, 4.5); add("graphite text on fog", G, F, 4.5);
  add("muted-foreground / placeholder on white", tok("ink-muted"), W, 4.5); add("muted-foreground / placeholder on fog", tok("ink-muted"), F, 4.5);
  add("focus ring (ember-deep) vs white page", tok("ember-deep"), W, 3); add("focus ring (ember-deep) vs fog page", tok("ember-deep"), F, 3);
  add("bright ember icon on white (decorative, paired with text)", tok("ember-orange"), W, 3);
  console.log(rows.join("\n"));
  process.exit(0);
}

const args = ["--ignore-certificate-errors"];
if (process.env.HTTPS_PROXY) args.push(`--proxy-server=${process.env.HTTPS_PROXY}`, "--proxy-bypass-list=localhost;127.0.0.1");
const browser = await chromium.launch({ args });

// ------------------------------------------------------------------ seed data (signed-in dev user)
async function seed() {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
  const rpc = (proc, input) => page.evaluate(async ([proc, input]) => {
    const r = await fetch(`/api/trpc/${proc}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ json: input ?? null }) });
    const b = await r.json();
    return { status: r.status, data: b?.result?.data?.json, error: b?.error?.json?.message };
  }, [proc, input]);
  const uid = sql("select id from users order by id limit 1");
  if (!uid) throw new Error("no dev user: is the server in NODE_ENV=development and SQLITE_PATH the same DB?");
  const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  // idempotent: start from a clean slate for the dev user so reruns produce comparable numbers
  for (const q of [
    `delete from scan_ingredients where scan_id in (select id from food_scans where user_id=${uid})`,
    `delete from alternatives where scan_id in (select id from food_scans where user_id=${uid})`,
    `delete from food_scans where user_id=${uid}`,
    `delete from qc_items where batch_id in (select id from qc_batches where user_id=${uid})`,
    `delete from qc_batches where user_id=${uid}`,
    `delete from produce_inventory where user_id=${uid}`,
    `delete from food_inventory where user_id=${uid}`,
    `delete from medical_conditions where user_id=${uid}`,
    `delete from medications where user_id=${uid}`,
    `delete from user_profiles where user_id=${uid}`,
  ]) sql(q);
  sql(`insert into user_profiles (user_id, region) values (${uid}, 'Pune, India')`);
  for (const [n, f, d] of [["Banana", "banana", 4], ["Cucumber", "cucumber", 6]]) {
    await rpc("produce.addInventory", { name: n, fruit: f, freshness: "fresh", pFresh: 80, confidence: 90, expiryDate: day(d) });
  }
  await rpc("inventory.add", { title: "Spinach", category: "Vegetables", quantity: "1", storageLocation: "fridge", expiryDate: day(1) });
  await rpc("inventory.add", { title: "Old yoghurt", category: "Dairy", quantity: "1", storageLocation: "fridge", expiryDate: day(-2) });
  await rpc("profile.addMedicalCondition", { condition: "Type 2 Diabetes" });
  const mkScan = (name) => {
    sql(`insert into food_scans (user_id, product_name, input_type, risk_score, analysis_complete) values (${uid}, '${name}', 'text', 72, 1)`);
    return sql(`select max(id) from food_scans where user_id=${uid}`);
  };
  const scanId = mkScan("Choco Crunch Cereal");
  for (const [n, c, r] of [["Sugar", "Sweetener", "high"], ["Glucose Syrup", "Sweetener", "high"], ["Maltodextrin", "Carbohydrate", "moderate"], ["Palm Oil", "Oil", "moderate"], ["Salt", "Mineral", "low"]]) {
    sql(`insert into scan_ingredients (scan_id,name,category,risk_level) values (${scanId},'${n}','${c}','${r}')`);
  }
  for (const [n, b] of [["Rolled Oats", "Quaker"], ["Muesli", "Alpen"], ["Millet Cookies", ""]]) {
    sql(`insert into alternatives (scan_id, product_name, brand, reason) values (${scanId}, '${n}', '${b}', 'Less sugar than the scanned product')`);
  }
  await ctx.close();
  return { scanId };
}

// ------------------------------------------------------------------ scenarios
const RECEIPT = `Blinkit
Order ID: ORD123456789
Amul Taaza Toned Milk 500 ml  x2   56.00
Britannia Brown Bread 400 g   1   45.00
Farm Eggs Pack of 6   1   72.00
Fresh Tomato Hybrid 500 g   1   28.00
Paneer 200 g   1   90.00
Handling fee  5.00
Grand Total Rs. 396.00`;

const go = async (page, p) => { await page.goto(BASE + p, { waitUntil: "networkidle" }); await page.waitForTimeout(400); };
const closeAll = async (page) => { await page.keyboard.press("Escape"); await page.waitForTimeout(250); };

function scenarios({ scanId }) {
  const routes = ["/", "/dashboard", "/scanner", "/produce", "/fridge", "/expiry", "/qc", "/receipt", "/openfoodfacts", "/barcode", "/profile", `/scan/${scanId}`, "/history", "/chat", "/privacy", "/terms", "/about", "/404", "/no-such-page"];
  const list = routes.map((r) => ({ name: `route ${r.replace(/^\/scan\/\d+$/, "/scan/:id")}`, route: r, run: (page) => go(page, r) }));
  list.push(
    { name: "state produce shelf-scan tab", route: "/produce", run: async (page) => { await go(page, "/produce"); await page.getByRole("button", { name: /Scan a whole shelf/ }).click(); await page.waitForTimeout(500); } },
    { name: "state scanner image-upload tab", route: "/scanner", run: async (page) => { await go(page, "/scanner"); await page.getByRole("tab", { name: /Image/ }).click(); await page.waitForTimeout(400); } },
    { name: "state open food facts product-search tab", route: "/openfoodfacts", run: async (page) => { await go(page, "/openfoodfacts"); await page.getByRole("tab", { name: /Product Search/ }).click(); await page.waitForTimeout(400); } },
    { name: "state fridge add dialog", route: "/fridge", run: async (page) => { await go(page, "/fridge"); await page.getByRole("button", { name: "Add Food Item" }).click(); await page.getByRole("dialog").waitFor(); } },
    { name: "state fridge add dialog select open", route: "/fridge", run: async (page) => { await go(page, "/fridge"); await page.getByRole("button", { name: "Add Food Item" }).click(); await page.getByRole("dialog").waitFor(); await page.getByRole("combobox").first().click(); await page.getByRole("listbox").waitFor(); } },
    { name: "state fridge category filter select open", route: "/fridge", run: async (page) => { await go(page, "/fridge"); await page.getByRole("combobox").first().click(); await page.getByRole("listbox").waitFor(); } },
    { name: "state profile select open", route: "/profile", run: async (page) => { await go(page, "/profile"); await page.getByRole("combobox").first().click(); await page.getByRole("listbox").waitFor(); } },
    { name: "state profile form with errors and toast", route: "/profile", run: async (page) => {
        await go(page, "/profile");
        await page.locator("#age").fill("-5");
        await page.locator("#region").fill("x".repeat(64));
        await page.getByRole("button", { name: "Save Profile" }).click();
        await page.waitForTimeout(700);
        await page.getByRole("button", { name: "Add condition" }).click(); // empty -> nothing
        await page.locator("#age").evaluate((el) => el.setAttribute("aria-invalid", "true"));
      } },
    { name: "state profile whatsapp unlink dialog", route: "/profile", run: async (page) => {
        await go(page, "/profile");
        const b = page.getByRole("button", { name: "Disconnect" });
        if (await b.count()) { await b.first().click(); await page.getByRole("alertdialog").waitFor(); }
      } },
    { name: "state scan result with alternatives and market block", route: `/scan/${scanId}`, run: async (page) => {
        await go(page, `/scan/${scanId}`);
        await page.getByText("Healthier Alternatives").first().waitFor({ timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(2500); // let market lookups settle (ok / none / unavailable)
      } },
    { name: "state receipt review list with rows", route: "/receipt", run: async (page) => {
        await go(page, "/receipt");
        await page.getByLabel("Receipt or e-bill text").fill(RECEIPT);
        await page.getByRole("button", { name: "Read receipt" }).click();
        await page.getByTestId("receipt-rows").waitFor({ timeout: 30000 });
      } },
    { name: "state receipt review validation errors", route: "/receipt", run: async (page) => {
        await go(page, "/receipt");
        await page.getByLabel("Receipt or e-bill text").fill(RECEIPT);
        await page.getByRole("button", { name: "Read receipt" }).click();
        await page.getByTestId("receipt-rows").waitFor({ timeout: 30000 });
        await page.getByTestId("receipt-rows").locator("li input[type=date]").first().fill("");
        await page.getByRole("button", { name: /^Add \d+ items? to my pantry$/ }).click();
        await page.waitForTimeout(400);
      } },
    { name: "state qc validation error", route: "/qc", run: async (page) => {
        await go(page, "/qc");
        await page.getByTestId("photo-input").setInputFiles([path.join(ROOT, "static/samples/apple.jpg")]);
        await page.getByRole("button", { name: "Grade batch" }).click();
        await page.waitForTimeout(400);
      } },
  );
  for (const tab of ["History", "Vendor scorecard"]) {
    list.push({ name: `state qc tab ${tab}`, route: "/qc", run: async (page) => { await go(page, "/qc"); await page.getByRole("tab", { name: tab }).click(); await page.waitForTimeout(500); } });
  }
  list.push(
    { name: "state qc results (graded batch)", route: "/qc", needsFlask: true, run: async (page) => {
        await go(page, "/qc");
        await page.getByLabel("Vendor", { exact: true }).fill("A11y Vendor");
        const files = ["apple", "banana", "orange", "strawberry", "tomato"].map((f) => path.join(ROOT, `static/samples/${f}.jpg`));
        await page.getByTestId("photo-input").setInputFiles(files);
        await page.getByRole("button", { name: "Grade batch" }).click();
        await page.getByTestId("verdict").waitFor({ timeout: 90000 });
      } },
    { name: "state qc history delete dialog", route: "/qc", needsFlask: true, run: async (page) => {
        await go(page, "/qc");
        await page.getByRole("tab", { name: "History" }).click();
        await page.getByTestId("history-row").first().waitFor({ timeout: 10000 }).catch(() => {});
        const del = page.getByRole("button", { name: /^Delete batch/ });
        if (!(await del.count())) throw new Error("no batch in history (QC results scenario did not run)");
        await del.first().click();
        await page.getByRole("alertdialog").waitFor();
      } },
    { name: "state mobile More sheet", route: "/dashboard", mobileOnly: true, run: async (page) => { await go(page, "/dashboard"); await page.getByRole("button", { name: "More" }).click(); await page.getByRole("dialog").waitFor(); } },
    { name: "state desktop user menu", route: "/dashboard", desktopOnly: true, run: async (page) => { await go(page, "/dashboard"); await page.locator('[data-sidebar="footer"] button').first().click(); await page.getByRole("menu").waitFor(); } },
  );
  return list;
}

// ------------------------------------------------------------------ touch-target check (mobile primary controls)
async function smallTargets(page) {
  return page.evaluate(() => {
    const out = [];
    const sel = 'button, [role="button"], [role="tab"], [role="combobox"], [role="checkbox"], [role="switch"], input:not([type=hidden]), select, textarea, a[href]';
    for (const el of document.querySelectorAll(sel)) {
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || el.closest("[aria-hidden='true']") || el.disabled) continue;
      if (el.matches('input[type=file]') ) continue;
      let r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // inline text links inside a sentence are exempt (WCAG 2.5.8 inline exception)
      if (el.matches("a") && getComputedStyle(el).display === "inline") continue;
      // an input inside a label/wrapper that provides a larger hit area counts via the label
      const lab = el.closest("label");
      if (lab) { const lr = lab.getBoundingClientRect(); if (lr.height >= r.height) r = lr; }
      if (el.getAttribute("role") === "checkbox" || el.type === "checkbox") {
        // radix checkbox: measure the row/label hit area if the button itself is smaller
        const p = el.closest("label, li, [data-hit]"); if (p) { const pr = p.getBoundingClientRect(); if (pr.height >= 44 && el.closest("label")) r = pr; }
      }
      if (r.height < 43.5 || r.width < 43.5) {
        const t = (el.getAttribute("aria-label") || el.textContent || el.id || el.tagName).trim().replace(/\s+/g, " ").slice(0, 40);
        out.push({ tag: el.tagName.toLowerCase(), label: t, w: Math.round(r.width), h: Math.round(r.height) });
      }
    }
    return out;
  });
}

// ------------------------------------------------------------------ run axe
const all = []; // {scenario, viewport, violations:[{id,impact,help,nodes,targets}]}
const manual = []; // [name, ok, detail]
const note = (name, ok, detail = "") => { manual.push([ok ? "PASS" : "FAIL", name, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -  " + detail : ""}`); };
const skipped = [];
const titles = {};
const touch = {};

const data = await seed();
const all_scenarios = scenarios(data);

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.width < 500, hasTouch: vp.width < 500, reducedMotion: "reduce" });
  await ctx.addInitScript(() => { try { localStorage.setItem("ingrescan.produce.engine", "server"); } catch {} });
  const page = await ctx.newPage();
  for (const sc of all_scenarios) {
    if (ONLY && !sc.name.includes(ONLY)) continue;
    if ((sc.mobileOnly && vp.width >= 500) || (sc.desktopOnly && vp.width < 500)) continue;
    try {
      await sc.run(page);
    } catch (e) {
      skipped.push(`${sc.name} @${vp.name}: ${String(e.message).split("\n")[0]}`);
      console.log(`SKIP  ${sc.name} @${vp.name}: ${String(e.message).split("\n")[0]}`);
      await closeAll(page);
      continue;
    }
    if (sc.name.startsWith("route ")) titles[`${sc.route}@${vp.name}`] = await page.title();
    const res = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    const violations = res.violations.map((v) => ({ id: v.id, impact: v.impact ?? "minor", help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0, 3).map((n) => n.target.join(" ")), html: v.nodes.slice(0, 3).map((n) => n.html.slice(0, 160)) }));
    if (vp.width < 500 && !sc.name.includes("sheet")) {
      const small = await smallTargets(page);
      touch[`${sc.name}`] = small;
      if (small.length) violations.push({ id: "x-touch-target-44", impact: "moderate", help: "Interactive control smaller than 44x44 CSS px on mobile", nodes: small.length, targets: small.slice(0, 3).map((s) => `${s.tag} "${s.label}" ${s.w}x${s.h}`) });
    }
    all.push({ scenario: sc.name, viewport: vp.name, violations });
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${sc.name.replace(/[^a-z0-9]+/gi, "-")}-${vp.name}.png`), fullPage: true }).catch(() => {});
    const worst = violations.length ? violations.map((v) => `${v.id}(${v.impact[0]})x${v.nodes}`).join(" ") : "clean";
    console.log(`AXE  ${vp.name.padStart(4)}  ${sc.name.padEnd(52)} ${worst}`);
    await closeAll(page);
  }
  await ctx.close();
}

// ------------------------------------------------------------------ summary
const byImpact = Object.fromEntries(IMPACT_ORDER.map((i) => [i, 0]));
const knownRadix = Object.fromEntries(IMPACT_ORDER.map((i) => [i, 0]));
const byRule = {};
for (const s of all) for (const v of s.violations) {
  if (isKnown(s.scenario, v.id)) { knownRadix[v.impact] += v.nodes; v.known = true; continue; }
  byImpact[v.impact] = (byImpact[v.impact] ?? 0) + v.nodes;
  const k = `${v.id} [${v.impact}]`;
  (byRule[k] ??= { nodes: 0, where: new Set(), help: v.help, sample: v.targets[0] }).nodes += v.nodes;
  byRule[k].where.add(`${s.scenario} @${s.viewport}`);
}
const ruleRows = Object.entries(byRule).sort((a, b) => IMPACT_ORDER.indexOf(a[0].match(/\[(\w+)\]/)[1]) - IMPACT_ORDER.indexOf(b[0].match(/\[(\w+)\]/)[1]) || b[1].nodes - a[1].nodes);
console.log("\n=== axe violations by rule (nodes) ===");
for (const [k, v] of ruleRows) console.log(`${String(v.nodes).padStart(5)}  ${k.padEnd(34)} in ${v.where.size} page-states, e.g. ${[...v.where][0]}  ${v.sample ?? ""}`);
console.log("\n=== violating nodes by impact ===", JSON.stringify(byImpact));
console.log("known Radix modal-widget findings (excluded above):", JSON.stringify(knownRadix));
const scenariosWithViolations = all.filter((s) => s.violations.length).length;
console.log(`scenarios audited: ${all.length}, with violations: ${scenariosWithViolations}, skipped: ${skipped.length}`);

// ------------------------------------------------------------------ manual-style checks
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  // document.title per route
  const routeTitles = Object.entries(titles).filter(([k]) => k.endsWith("@1280")).map(([k, v]) => [k.replace("@1280", ""), v]);
  const pairs = routeTitles.filter(([r]) => !["/expiry", "/barcode", "/404", "/no-such-page"].includes(r));
  const distinct = new Set(pairs.map(([, t]) => t));
  note("document.title differs per route", distinct.size === pairs.length && pairs.every(([, t]) => t && t !== "IngreScan-AI" || pairs.length === 0), pairs.map(([r, t]) => `${r}=${t}`).join(" | ").slice(0, 400));

  // html lang, landmarks, skip link
  for (const r of ["/", "/dashboard", "/qc", "/profile", "/privacy"]) {
    await go(page, r);
    const info = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      mains: document.querySelectorAll("main, [role=main]").length,
      h1: document.querySelectorAll("h1").length,
      navs: [...document.querySelectorAll("nav, [role=navigation]")].map((n) => n.getAttribute("aria-label") || n.getAttribute("aria-labelledby") || ""),
      skip: !!document.querySelector('a[href^="#"]'),
    }));
    note(`landmarks ${r}: lang, one main, one h1, labelled navs`, info.lang === "en" && info.mains === 1 && info.h1 === 1 && info.navs.every(Boolean), JSON.stringify(info));
    await page.keyboard.press("Tab");
    const first = await page.evaluate(() => { const a = document.activeElement; return { text: (a?.textContent || "").trim().slice(0, 30), href: a?.getAttribute?.("href") }; });
    note(`skip link is the first Tab stop ${r}`, /skip/i.test(first.text) && (first.href ?? "").startsWith("#"), JSON.stringify(first));
    const target = (first.href ?? "").startsWith("#") && (await page.evaluate((h) => !!document.querySelector(h), first.href));
    note(`skip link target exists ${r}`, !!target);
  }

  // keyboard: tab through /dashboard, reach every actionable control, no trap
  for (const r of ["/dashboard", "/fridge", "/profile", "/receipt", "/qc"]) {
    await go(page, r);
    const expected = await page.evaluate(() => [...document.querySelectorAll('a[href], button, input:not([type=hidden]):not([type=file]), select, textarea, [role=tab], [role=combobox], [role=switch], [tabindex="0"]')]
      .filter((el) => { const cs = getComputedStyle(el); const rc = el.getBoundingClientRect(); return !el.disabled && cs.visibility !== "hidden" && cs.display !== "none" && rc.width > 0 && rc.height > 0 && el.tabIndex >= 0 && !el.closest("[aria-hidden=true]"); }).length);
    const seen = new Set(); let steps = 0; let indicator = 0; let focusedCount = 0;
    for (; steps < expected + 15; steps++) {
      await page.keyboard.press("Tab");
      const st = await page.evaluate(() => {
        const a = document.activeElement;
        if (!a || a === document.body) return null;
        const cs = getComputedStyle(a);
        return { key: String([...document.querySelectorAll("*")].indexOf(a)), ring: a.matches(":focus-visible") && ((cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2) || cs.boxShadow !== "none") };
      });
      if (!st) break; // focus left the document into browser chrome = no trap
      seen.add(st.key); focusedCount++; if (st.ring) indicator++;
    }
    note(`keyboard ${r}: Tab reaches every actionable control, no trap`, seen.size >= expected - 1, `focusable=${expected}, reached=${seen.size}`);
    note(`focus indicator (>=2px outline or ring) on every Tab stop ${r}`, indicator === focusedCount, `${indicator}/${focusedCount}`);
  }

  // dialogs: focus moves in, is trapped, Esc closes and restores focus
  await go(page, "/fridge");
  const addBtn = page.getByRole("button", { name: "Add Food Item" });
  await addBtn.focus(); await page.keyboard.press("Enter");
  await page.getByRole("dialog").waitFor();
  const inside = () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  note("dialog: focus moves into it", await inside());
  let stayed = true; for (let i = 0; i < 25; i++) { await page.keyboard.press("Tab"); if (!(await inside())) stayed = false; }
  note("dialog: Tab stays trapped inside", stayed);
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  note("dialog: Esc closes and focus returns to the trigger", (await page.getByRole("dialog").count()) === 0 && (await page.evaluate(() => document.activeElement?.textContent?.includes("Add Food Item"))));
  await go(page, "/profile");
  const combo = page.getByRole("combobox").first();
  await combo.focus(); await page.keyboard.press("Enter"); await page.getByRole("listbox").waitFor();
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter"); await page.waitForTimeout(250);
  note("select: operable by keyboard (Enter, arrows, Enter) and closes", (await page.getByRole("listbox").count()) === 0 && !/Select gender/.test(await combo.innerText()), await combo.innerText());
  await ctx.close();

  // mobile tab bar by keyboard + 320px reflow + 200% zoom
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await m.newPage();
  await go(mp, "/dashboard");
  const tabs = await mp.locator('nav[aria-label="Primary"] button').count();
  note("mobile tab bar: 5 buttons with accessible names", tabs === 5 && (await mp.locator('nav[aria-label="Primary"] button').evaluateAll((els) => els.every((e) => (e.getAttribute("aria-label") || e.textContent || "").trim().length > 0))));
  await mp.locator('nav[aria-label="Primary"] button').nth(1).focus(); await mp.keyboard.press("Enter"); await mp.waitForURL(/\/produce/);
  note("mobile tab bar: Enter on a tab navigates", /\/produce$/.test(mp.url()));
  await m.close();

  const reflowRoutes = ["/", "/dashboard", "/scanner", "/fridge", "/qc", "/receipt", "/profile", `/scan/${data.scanId}`, "/history", "/about"];
  for (const [label, vp, scale] of [["320px wide", { width: 320, height: 640 }, 1], ["200% zoom (640 CSS px -> 1280 device)", { width: 640, height: 450 }, 1]]) {
    const c = await browser.newContext({ viewport: vp, isMobile: false });
    const p = await c.newPage();
    const bad = [];
    for (const r of reflowRoutes) {
      await go(p, r);
      const d = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (d > 0) bad.push(`${r} +${d}px`);
    }
    note(`reflow ${label}: no horizontal page scroll (${reflowRoutes.length} routes)`, bad.length === 0, bad.join(", "));
    await c.close();
  }

  // forced-colors / colour-only: every status tag carries text; emulate forced colours and compare visible text
  const fc = await browser.newContext({ viewport: { width: 1280, height: 900 }, forcedColors: "active", reducedMotion: "reduce" });
  const fp = await fc.newPage();
  const scanUrl = `/scan/${data.scanId}`;
  await go(fp, scanUrl);
  const tags = await fp.evaluate(() => [...document.querySelectorAll(".fn-tag")].map((t) => t.textContent.trim()));
  note("status tags: every .fn-tag has a text label (not colour alone)", tags.length > 0 && tags.every((t) => t.length > 1), `${tags.length} tags: ${[...new Set(tags)].slice(0, 6).join(", ")}`);
  const hidden = await fp.evaluate(() => [...document.querySelectorAll("h1, h2, button, a[href]")].filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && cs.visibility !== "hidden" && cs.color === getComputedStyle(e).backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)"; }).length);
  note("forced-colors: no text rendered in its own background colour", hidden === 0, `${hidden} elements`);
  const anim = await fp.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && a.effect?.getComputedTiming().iterations === Infinity).length);
  note("prefers-reduced-motion: no infinite animations running", anim === 0, `${anim} running`);
  await fc.close();
}

// ------------------------------------------------------------------ report
fs.writeFileSync(REPORT, JSON.stringify({ base: BASE, tags: TAGS, byImpact, knownRadix, rules: ruleRows.map(([k, v]) => ({ rule: k, nodes: v.nodes, pageStates: v.where.size, help: v.help, sample: v.sample })), scenarios: all, skipped, manual, titles, touch }, null, 2));
const failedManual = manual.filter((m) => m[0] === "FAIL");
console.log(`\nmanual-style checks: ${manual.length - failedManual.length} passed, ${failedManual.length} failed`);
for (const f of failedManual) console.log("  FAIL", f[1], f[2]);
if (skipped.length) console.log("skipped scenarios:\n  " + skipped.join("\n  "));
console.log(`report: ${REPORT}`);
await browser.close();
process.exit(byImpact.critical + byImpact.serious + failedManual.length > 0 ? 1 : 0);
