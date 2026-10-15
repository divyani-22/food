// Regression checks for client UI bugs fixed in the bug-hunt round 4 (real browser, real server, no mocks).
//
// Needs a running stack on your own ports (dev mode signs in automatically; zero-config SQLite):
//   Flask  FRESHGUARD_PORT=5540 python3 app.py
//   Web    cd IngreScan-AI && SQLITE_PATH=/tmp/bh4-1.db PORT=3540 FRESHGUARD_URL=http://127.0.0.1:5540 \
//          NODE_ENV=development node --import=tsx ./server/_core/index.ts
// Run from the repo root:  BASE_URL=http://localhost:3540 node e2e/bugfix-ui.mjs
//
// Env: BASE_URL (default http://localhost:3540). Prints PASS/FAIL lines; exit code 1 when anything fails.
// Covers: keyboard + drag-and-drop upload on /scanner, double-submit guards (produce inspector, expiry tracker,
// profile lists), Enter-to-add in the profile forms, readable validation errors, stale storage alerts after a
// pantry change, trailing-slash routes, scroll reset on navigation, no horizontal overflow on /openfoodfacts at 768,
// and react-query cache cleared on sign out.
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3540";
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -  " + detail : ""}`);
};

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const stamp = Date.now().toString(36);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

const go = async (path) => {
  await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => undefined);
};

try {
  // ---------- 1. Scanner: image upload reachable by keyboard and by drag and drop ----------
  await go("/scanner");
  await page.getByRole("tab", { name: /Image/ }).click();
  const display = await page.evaluate(() => getComputedStyle(document.getElementById("imageUpload")).display);
  check("scanner: file input is not display:none", display !== "none", `display=${display}`);
  await page.locator("#productName").focus();
  let reached = false;
  for (let i = 0; i < 6 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(() => document.activeElement?.id === "imageUpload");
  }
  check("scanner: Tab reaches the image picker", reached);
  const dt = await page.evaluateHandle((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const d = new DataTransfer();
    d.items.add(new File([bytes], "label.png", { type: "image/png" }));
    return d;
  }, PNG_1X1);
  await page.locator("label[for=imageUpload]").dispatchEvent("drop", { dataTransfer: dt });
  await page.locator("img[alt=Preview]").waitFor({ timeout: 5000 }).catch(() => undefined);
  check("scanner: dropping an image shows the preview", (await page.locator("img[alt=Preview]").count()) === 1);

  // ---------- 2. Produce inspector: no concurrent inspections ----------
  await go("/produce");
  await page.getByRole("button", { name: "Server", exact: true }).click();
  // Slow the classifier down so the second click lands while the first inspection is still running.
  await page.route("**/api/freshguard/predict*", async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  const predicts = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/freshguard/predict")) predicts.push(r.url());
  });
  const samples = page.locator("text=Quick Test Samples").locator("xpath=..").locator("button");
  await samples.nth(0).click();
  await samples.nth(1).click({ force: true }).catch(() => undefined); // immediate second click must be ignored
  await page.waitForTimeout(300);
  const othersDisabled = await samples.nth(1).isDisabled();
  check("produce: other samples are disabled while analysing", othersDisabled);
  await page.waitForTimeout(5000);
  await page.unroute("**/api/freshguard/predict*");
  check("produce: exactly one prediction request", predicts.length === 1, `requests=${predicts.length}`);

  // ---------- 3. Expiry tracker: double-click guard and fresh storage alerts ----------
  await go("/fridge");
  const addItem = async (title) => {
    await page.getByRole("button", { name: "Add Food Item" }).first().click();
    await page.getByLabel("Food Name").fill(title);
    await page.getByRole("button", { name: "Save to Tracker" }).click();
    await page.getByText(title, { exact: true }).first().waitFor({ timeout: 8000 });
  };
  await addItem(`Apple ${stamp}`);
  await addItem(`Cucumber ${stamp}`);
  await page.waitForTimeout(800);
  const alertsBefore = await page.locator("section[aria-label='Storage alerts'] li").count();
  check("tracker: apple + cucumber raise a storage alert", alertsBefore > 0, `alerts=${alertsBefore}`);
  const consumeReqs = [];
  page.on("request", (r) => {
    if (r.url().includes("inventory.consume")) consumeReqs.push(r.url());
  });
  const card = page.locator("article", { hasText: `Cucumber ${stamp}` });
  await card.getByRole("button", { name: "Consumed" }).dblclick();
  await page.waitForTimeout(1500);
  check("tracker: double-click on Consumed sends one request", consumeReqs.length === 1, `requests=${consumeReqs.length}`);
  const alertsAfter = await page.locator("section[aria-label='Storage alerts'] li").count();
  check("tracker: storage alerts refresh after consuming (no reload)", alertsAfter < alertsBefore, `before=${alertsBefore} after=${alertsAfter}`);
  await page.locator("article", { hasText: `Apple ${stamp}` }).getByRole("button", { name: /^Remove/ }).click();

  // ---------- 4. Profile: Enter adds, double-click adds once, readable validation errors ----------
  await go("/profile");
  const cond = `Asthma ${stamp}`;
  await page.getByLabel("Medical condition").fill(cond);
  await page.keyboard.press("Enter");
  await page.getByText(cond, { exact: true }).waitFor({ timeout: 5000 }).catch(() => undefined);
  check("profile: Enter adds a condition", (await page.getByText(cond, { exact: true }).count()) === 1);
  const cond2 = `Gout ${stamp}`;
  await page.getByLabel("Medical condition").fill(cond2);
  await page.getByRole("button", { name: "Add condition" }).dblclick();
  await page.waitForTimeout(1500);
  check("profile: double-click adds the condition once", (await page.getByText(cond2, { exact: true }).count()) === 1, `rows=${await page.getByText(cond2, { exact: true }).count()}`);
  for (const c of [cond, cond2]) {
    await page.getByRole("button", { name: `Remove ${c}` }).click().catch(() => undefined);
    await page.waitForTimeout(400);
  }
  await page.fill("#age", "200");
  await page.getByRole("button", { name: "Save Profile" }).click();
  const errToast = page.locator("[data-sonner-toast]", { hasText: /age|expected|too big/i }).first();
  await errToast.waitFor({ timeout: 5000 }).catch(() => undefined);
  const toast = (await errToast.innerText().catch(() => "")).trim();
  check("profile: validation error is readable text, not JSON", toast.length > 0 && !toast.startsWith("[") && /age/i.test(toast), JSON.stringify(toast.slice(0, 90)));

  // ---------- 5. Routing: trailing slash and scroll reset ----------
  for (const p of ["/scanner/", "/dashboard/", "/qc/"]) {
    await page.goto(BASE + p, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);
    const u = new URL(page.url());
    const t = await page.title();
    check(`routing: ${p} opens the page`, u.pathname === p.replace(/\/$/, "") && !/not found/i.test(t), `${u.pathname} "${t}"`);
  }
  await go("/");
  await page.evaluate(() => window.scrollTo(0, 1200));
  const before = await page.evaluate(() => window.scrollY);
  await page.locator("a[href='/about']").last().click();
  await page.waitForURL("**/about");
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => window.scrollY);
  check("routing: a new page starts at the top", before > 300 && after === 0, `before=${before} after=${after}`);

  // ---------- 6. Layout: /openfoodfacts at 768 ----------
  await page.setViewportSize({ width: 768, height: 900 });
  await go("/openfoodfacts");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("layout: /openfoodfacts has no horizontal scroll at 768px", overflow <= 0, `overflow=${overflow}px`);
  await page.setViewportSize({ width: 1280, height: 900 });

  // ---------- 7. Sign out clears the query cache ----------
  await go("/fridge");
  const keep = `Keep ${stamp}`;
  await addItem(keep);
  // Simulate a different person signing in: the server answers auth.me with another user id after sign out.
  // The cache must be dropped and the pantry refetched for the new user, not kept from the previous one.
  let inventoryRefetched = false;
  page.on("request", (r) => {
    if (r.url().includes("inventory.list")) inventoryRefetched = true;
  });
  await page.route("**/api/trpc/*auth.me*", async (route) => {
    const res = await route.fetch();
    const body = await res.text();
    await route.fulfill({ response: res, body: body.replace('"id":1,"openId"', '"id":999,"openId"') });
  });
  await page.getByRole("button", { name: /user@localhost|Local Food Explorer/ }).first().click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForTimeout(2500);
  check("sign out then another user: pantry is refetched for the new user", inventoryRefetched);
  await page.unroute("**/api/trpc/*auth.me*");
  await go("/fridge");
  await page.locator("article", { hasText: keep }).getByRole("button", { name: /^Remove/ }).click().catch(() => undefined);

  check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 200));
} catch (err) {
  failed++;
  console.log(`FAIL  script error  -  ${err instanceof Error ? err.message : err}`);
} finally {
  await browser.close();
}

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
