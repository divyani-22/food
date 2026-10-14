// Verifies FreshGuard pantry/history are stored per user in MySQL, via the real HTTP API.
// Needs: web app on :3000 started with VITE_APP_ID=e2e-app and JWT_SECRET=dev-only-secret, Flask on :5000, MariaDB.
// Run from the repo root:  node e2e/produce-isolation.mjs
import { createRequire } from "module";
import { execSync } from "child_process";
const require = createRequire(new URL("../IngreScan-AI/package.json", import.meta.url));
const { SignJWT } = require("jose");
const superjson = require("superjson");

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SECRET = new TextEncoder().encode(process.env.JWT_SECRET ?? "dev-only-secret");
const APP_ID = process.env.VITE_APP_ID ?? "e2e-app";
const sql = (q) => execSync(`mysql -N ingrescan -e "${q}"`).toString().trim();

const results = [];
const check = (name, ok, detail = "") => { results.push([ok ? "PASS" : "FAIL", name, detail]); };

async function sessionFor(openId, name) {
  return new SignJWT({ openId, appId: APP_ID, name })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(Math.floor((Date.now() + 3600_000) / 1000))
    .sign(SECRET);
}
async function trpc(cookie, proc, input, mutate = false) {
  const url = `${BASE}/api/trpc/${proc}` + (mutate ? "" : `?input=${encodeURIComponent(JSON.stringify(superjson.serialize(input ?? undefined)))}`);
  const res = await fetch(url, {
    method: mutate ? "POST" : "GET",
    headers: { cookie: `app_session_id=${cookie}`, "content-type": "application/json" },
    body: mutate ? JSON.stringify(superjson.serialize(input ?? undefined)) : undefined,
  });
  const body = await res.json();
  return { status: res.status, data: body?.result?.data?.json, error: body?.error?.json };
}

// Clean prior runs of this check, then create two real users.
sql("delete from produce_inventory where user_id in (select id from users where openId in ('iso-alice','iso-bob'))");
sql("delete from produce_scans where user_id in (select id from users where openId in ('iso-alice','iso-bob'))");
sql("delete from users where openId in ('iso-alice','iso-bob')");
sql("insert into users (openId,name,role,loginMethod) values ('iso-alice','Alice','user','local'),('iso-bob','Bob','user','local')");
const alice = await sessionFor("iso-alice", "Alice");
const bob = await sessionFor("iso-bob", "Bob");
const aliceId = sql("select id from users where openId='iso-alice'");
const bobId = sql("select id from users where openId='iso-bob'");

const FLASK = process.env.FLASK_URL ?? "http://127.0.0.1:5000";
const flaskHistoryCount = async () => (await (await fetch(`${FLASK}/api/history`)).json()).length;
const flaskBefore = await flaskHistoryCount();

// Alice classifies a sample through the proxy (real PyTorch model), then saves history + pantry.
const pr = await fetch(`${BASE}/api/freshguard/predict?sample=apple.jpg`, { method: "POST", headers: { cookie: `app_session_id=${alice}` } });
const pred = await pr.json();
check("Proxy: classification works for a signed-in user", pr.status === 200 && pred.fruit === "apple", `status ${pr.status}, fruit ${pred.fruit}`);
const NON_ENGLISH = /[\u1100-\u11ff\u3040-\u30ff\u3130-\u318f\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\u{1F000}-\u{1FAFF}\u2600-\u27BF\uFE0F]/u;
check("Proxy: result is English with no emoji field", !("emoji" in pred) && !NON_ENGLISH.test(JSON.stringify(pred)));

const rec = await trpc(alice, "produce.recordScan", { fruit: pred.fruit, fruitName: pred.fruit_kr, freshness: pred.freshness_status, freshnessLabel: pred.freshness_kr, pFresh: pred.p_fresh, confidence: pred.confidence, imageUrl: pred.image_url }, true);
check("Alice: recordScan succeeds", rec.status === 200 && rec.data?.id > 0, JSON.stringify(rec.error ?? rec.data));
const add = await trpc(alice, "produce.addInventory", { name: pred.fruit_kr, fruit: pred.fruit, freshness: pred.freshness_status, pFresh: pred.p_fresh, confidence: pred.confidence, imageUrl: pred.image_url, storageTip: pred.storage_tips, expiryDate: "2099-01-10" }, true);
check("Alice: addInventory succeeds", add.status === 200 && add.data?.id > 0, JSON.stringify(add.error ?? add.data));
const itemId = add.data?.id;

check("MySQL: rows are stored under Alice's user id", sql(`select count(*) from produce_inventory where user_id=${aliceId}`) === "1" && sql(`select count(*) from produce_scans where user_id=${aliceId}`) === "1");
check("Flask's own SQLite history is unchanged by the web app (persist=0)", (await flaskHistoryCount()) === flaskBefore, `${flaskBefore} -> ${await flaskHistoryCount()}`);

const aliceInv = await trpc(alice, "produce.listInventory");
const aliceHist = await trpc(alice, "produce.listHistory");
check("Alice sees her pantry item and history row", aliceInv.data?.length === 1 && aliceInv.data[0].name === "Apple" && aliceHist.data?.length === 1 && aliceHist.data[0].fruit_name_kr === "Apple");

// Bob must see nothing and must not be able to touch Alice's rows.
const bobInv = await trpc(bob, "produce.listInventory");
const bobHist = await trpc(bob, "produce.listHistory");
check("Bob sees none of Alice's pantry or history", bobInv.data?.length === 0 && bobHist.data?.length === 0);
const bobDel = await trpc(bob, "produce.deleteInventory", { id: itemId }, true);
check("Bob cannot delete Alice's item (404)", bobDel.status === 404 && sql(`select count(*) from produce_inventory where id=${itemId}`) === "1", `status ${bobDel.status}`);
await trpc(bob, "produce.clearHistory", undefined, true);
check("Bob clearing his history leaves Alice's intact", sql(`select count(*) from produce_scans where user_id=${aliceId}`) === "1");

// Anonymous requests and the proxy allowlist.
// Production rejects anonymous calls (401). Development signs cookie-less visitors in as a local dev user,
// so there the guarantee is that they never receive another user's rows.
const anon = await fetch(`${BASE}/api/trpc/produce.listInventory`);
if (process.env.EXPECT_PROD === "1") {
  check("Anonymous tRPC call is rejected (401)", anon.status === 401, `status ${anon.status}`);
  const anonProxy = await fetch(`${BASE}/api/freshguard/samples`);
  check("Anonymous proxy call is rejected (401)", anonProxy.status === 401, `status ${anonProxy.status}`);
} else {
  const body = await anon.json();
  const rows = body?.result?.data?.json ?? [];
  check("Anonymous (dev local user) never receives Alice's rows", anon.status === 200 && !rows.some((r) => r.id === itemId));
}
for (const [method, path] of [["GET", "/api/freshguard/inventory"], ["POST", "/api/freshguard/inventory"], ["GET", "/api/freshguard/history"], ["DELETE", "/api/freshguard/history"]]) {
  const r = await fetch(BASE + path, { method, headers: { cookie: `app_session_id=${alice}`, "content-type": "application/json" }, body: method === "POST" ? "{}" : undefined });
  check(`Proxy blocks ${method} ${path} (legacy shared data)`, r.status === 404, `status ${r.status}`);
}
const sampl = await fetch(`${BASE}/api/freshguard/samples`, { headers: { cookie: `app_session_id=${alice}` } });
check("Proxy still serves /samples", sampl.status === 200);

// Validation at the API boundary.
const bad = await trpc(alice, "produce.addInventory", { name: "X", fruit: "apple", freshness: "fresh", pFresh: 1, confidence: 1, imageUrl: "https://evil.example/x.png", expiryDate: "2099-01-10" }, true);
check("External image URLs are rejected", bad.status === 400, `status ${bad.status}`);

// Owner can delete.
const del = await trpc(alice, "produce.deleteInventory", { id: itemId }, true);
check("Alice can delete her own item", del.status === 200 && sql(`select count(*) from produce_inventory where id=${itemId}`) === "0");

sql("delete from produce_inventory where user_id in (select id from users where openId in ('iso-alice','iso-bob'))");
sql("delete from produce_scans where user_id in (select id from users where openId in ('iso-alice','iso-bob'))");
sql("delete from users where openId in ('iso-alice','iso-bob')");

for (const r of results) console.log(r.join(" | "));
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
