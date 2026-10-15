import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deliver, getHeader, processMetaWebhook, processTwilioWebhook, schemeVariants } from "./webhooks";
import { computeTwilioSignature, parseFormBody } from "./providers/twilio";
import { FakeSender, makeHarness } from "./testkit";

const AUTH = "twilio-auth-token-placeholder";
const URL_ = "https://bot.example.test/api/whatsapp/twilio";
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
const textForm = (body: string, sid = "SM100") =>
  form({ MessageSid: sid, From: "whatsapp:+919876543210", To: "whatsapp:+14155238886", Body: body, NumMedia: "0" });
const sig = (f: string, url = URL_) => computeTwilioSignature(url, parseFormBody(f), AUTH);

describe("processTwilioWebhook", () => {
  it("accepts a correctly signed message and returns replies", async () => {
    const h = makeHarness();
    const f = textForm("help");
    const r = await processTwilioWebhook({ url: URL_, formBody: f, headers: { "X-Twilio-Signature": sig(f) } }, { ...h.deps, twilio: { authToken: AUTH } });
    expect(r.status).toBe(200);
    expect(r.contentType).toBe("text/xml");
    expect(r.body).toBe("<Response></Response>");
    expect(r.outbound).toHaveLength(1);
    expect(r.outbound[0]).toMatchObject({ to: "+919876543210" });
    expect(r.outbound[0].text).toContain("FoodIQ commands");
  });

  it("rejects missing, wrong and tampered signatures without running the bot", async () => {
    const h = makeHarness();
    const f = textForm("help");
    const d = { ...h.deps, twilio: { authToken: AUTH } };
    for (const headers of [{}, { "x-twilio-signature": "AAAA" }, { "x-twilio-signature": sig(f).slice(1) + "A" }]) {
      const r = await processTwilioWebhook({ url: URL_, formBody: f, headers }, d);
      expect(r.status).toBe(403);
      expect(r.outbound).toEqual([]);
    }
    const tampered = await processTwilioWebhook({ url: URL_, formBody: textForm("stop"), headers: { "x-twilio-signature": sig(f) } }, d);
    expect(tampered.status).toBe(403);
    const wrongUrl = await processTwilioWebhook({ url: URL_ + "x", formBody: f, headers: { "x-twilio-signature": sig(f) } }, d);
    expect(wrongUrl.status).toBe(403);
    expect(h.store.seen.size).toBe(0);
  });

  it("scheme variants are opt-in", async () => {
    const h = makeHarness();
    const f = textForm("help");
    const httpSig = sig(f, URL_.replace("https", "http"));
    const strict = await processTwilioWebhook({ url: URL_, formBody: f, headers: { "x-twilio-signature": httpSig } }, { ...h.deps, twilio: { authToken: AUTH } });
    expect(strict.status).toBe(403);
    const lax = await processTwilioWebhook(
      { url: URL_, formBody: textForm("help", "SM101"), headers: { "x-twilio-signature": sig(textForm("help", "SM101"), URL_.replace("https", "http")) } },
      { ...h.deps, twilio: { authToken: AUTH, allowSchemeVariants: true } },
    );
    expect(lax.status).toBe(200);
    expect(schemeVariants("https://a/b", false)).toEqual(["https://a/b"]);
    expect(schemeVariants("http://a/b", true)).toEqual(["http://a/b", "https://a/b"]);
  });

  it("acknowledges status callbacks without replies", async () => {
    const h = makeHarness();
    const f = form({ MessageSid: "SM7", From: "whatsapp:+919876543210", MessageStatus: "delivered" });
    const r = await processTwilioWebhook({ url: URL_, formBody: f, headers: { "x-twilio-signature": sig(f) } }, { ...h.deps, twilio: { authToken: AUTH } });
    expect(r.status).toBe(200);
    expect(r.outbound).toEqual([]);
  });

  it("a retried delivery of the same MessageSid yields no second reply", async () => {
    const h = makeHarness();
    const f = textForm("help", "SMRETRY");
    const input = { url: URL_, formBody: f, headers: { "x-twilio-signature": sig(f) } };
    const d = { ...h.deps, twilio: { authToken: AUTH } };
    expect((await processTwilioWebhook(input, d)).outbound).toHaveLength(1);
    expect((await processTwilioWebhook(input, d)).outbound).toHaveLength(0);
  });
});

const SECRET = "meta-app-secret-placeholder";
const mdeps = (h: ReturnType<typeof makeHarness>) => ({ ...h.deps, meta: { appSecret: SECRET, verifyToken: "verify-token-placeholder" } });
const msign = (b: string) => "sha256=" + createHmac("sha256", SECRET).update(b).digest("hex");
const payload = (messages: unknown[]) => JSON.stringify({ entry: [{ changes: [{ value: { messages } }] }] });

describe("processMetaWebhook", () => {
  it("answers the GET verification handshake", async () => {
    const h = makeHarness();
    const ok = await processMetaWebhook(
      { headers: {}, query: { "hub.mode": "subscribe", "hub.verify_token": "verify-token-placeholder", "hub.challenge": "42" }, method: "GET" },
      mdeps(h),
    );
    expect(ok).toMatchObject({ status: 200, body: "42" });
    const bad = await processMetaWebhook({ headers: {}, query: { "hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "42" } }, mdeps(h));
    expect(bad.status).toBe(403);
  });

  it("verifies the signature over the raw body and processes messages in order", async () => {
    const h = makeHarness();
    const raw = payload([
      { id: "wamid.A", from: "919876543210", type: "text", text: { body: "help" } },
      { id: "wamid.B", from: "919876543210", type: "text", text: { body: "hello" } },
    ]);
    const r = await processMetaWebhook({ rawBody: raw, headers: { "X-Hub-Signature-256": msign(raw) } }, mdeps(h));
    expect(r.status).toBe(200);
    expect(r.outbound).toHaveLength(2);
    // redelivery is deduped
    const again = await processMetaWebhook({ rawBody: raw, headers: { "x-hub-signature-256": msign(raw) } }, mdeps(h));
    expect(again.status).toBe(200);
    expect(again.outbound).toEqual([]);
  });

  it("rejects bad signatures (including re-serialised bodies) and malformed JSON", async () => {
    const h = makeHarness();
    const raw = payload([{ id: "wamid.C", from: "919876543210", type: "text", text: { body: "help" } }]);
    expect((await processMetaWebhook({ rawBody: raw, headers: {} }, mdeps(h))).status).toBe(403);
    expect((await processMetaWebhook({ rawBody: raw, headers: { "x-hub-signature-256": msign(raw + " ") } }, mdeps(h))).status).toBe(403);
    expect((await processMetaWebhook({ rawBody: JSON.stringify(JSON.parse(raw), null, 2), headers: { "x-hub-signature-256": msign(raw) } }, mdeps(h))).status).toBe(403);
    const junk = "not json";
    expect((await processMetaWebhook({ rawBody: junk, headers: { "x-hub-signature-256": msign(junk) } }, mdeps(h))).status).toBe(400);
    expect(h.store.seen.size).toBe(0);
  });

  it("ignores status-only payloads", async () => {
    const h = makeHarness();
    const raw = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: "x", status: "read" }] } }] }] });
    const r = await processMetaWebhook({ rawBody: raw, headers: { "x-hub-signature-256": msign(raw) } }, mdeps(h));
    expect(r).toMatchObject({ status: 200, outbound: [] });
  });

  it("caps the number of messages processed per request", async () => {
    const h = makeHarness();
    const msgs = Array.from({ length: 80 }, (_, i) => ({ id: `wamid.${i}`, from: "919876543210", type: "text", text: { body: "help" } }));
    const raw = payload(msgs);
    await processMetaWebhook({ rawBody: raw, headers: { "x-hub-signature-256": msign(raw) } }, mdeps(h));
    expect(h.store.seen.size).toBe(50);
  });
});

describe("helpers", () => {
  it("getHeader is case-insensitive and takes the first of arrays", () => {
    expect(getHeader({ "X-A": "1" }, "x-a")).toBe("1");
    expect(getHeader({ "x-a": ["1", "2"] }, "X-A")).toBe("1");
    expect(getHeader({}, "x-a")).toBeUndefined();
  });
  it("deliver continues after a failed send", async () => {
    const s = new FakeSender();
    let n = 0;
    const orig = s.sendText.bind(s);
    s.sendText = async (to, t) => {
      if (n++ === 0) throw new Error("x");
      return orig(to, t);
    };
    expect(await deliver(s, [{ to: "+1", text: "a" }, { to: "+1", text: "b" }])).toEqual({ sent: 1, failed: 1 });
    expect(s.texts.map((t) => t.text)).toEqual(["b"]);
  });
});
