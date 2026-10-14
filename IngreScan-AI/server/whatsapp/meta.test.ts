import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createMetaSender,
  downloadMetaMedia,
  handleMetaVerification,
  parseMetaWebhook,
  verifyMetaSignature,
} from "./providers/meta";

const SECRET = "app-secret-placeholder";
const sign = (body: string, secret = SECRET) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

describe("verifyMetaSignature", () => {
  const body = JSON.stringify({ a: 1 });
  it("accepts a valid signature (string or bytes)", () => {
    expect(verifyMetaSignature(body, sign(body), SECRET)).toBe(true);
    expect(verifyMetaSignature(Buffer.from(body), sign(body).toUpperCase().replace("SHA256=", "sha256="), SECRET)).toBe(true);
  });
  it("rejects tampering, wrong secret and malformed headers", () => {
    expect(verifyMetaSignature(body + " ", sign(body), SECRET)).toBe(false);
    expect(verifyMetaSignature(body, sign(body, "other"), SECRET)).toBe(false);
    expect(verifyMetaSignature(body, undefined, SECRET)).toBe(false);
    expect(verifyMetaSignature(body, "", SECRET)).toBe(false);
    expect(verifyMetaSignature(body, sign(body).replace("sha256=", "sha1="), SECRET)).toBe(false);
    expect(verifyMetaSignature(body, sign(body).slice(0, -2), SECRET)).toBe(false);
    expect(verifyMetaSignature(body, sign(body), "")).toBe(false);
  });
});

describe("hub challenge", () => {
  const q = (o: Record<string, string>) => o;
  it("echoes the challenge only with matching token and mode", () => {
    expect(handleMetaVerification(q({ "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "1158201444" }), "tok")).toEqual({
      status: 200,
      body: "1158201444",
    });
  });
  it("rejects wrong token, mode, empty configured token, and unsafe challenge", () => {
    expect(handleMetaVerification(q({ "hub.mode": "subscribe", "hub.verify_token": "bad", "hub.challenge": "1" }), "tok").status).toBe(403);
    expect(handleMetaVerification(q({ "hub.mode": "unsubscribe", "hub.verify_token": "tok", "hub.challenge": "1" }), "tok").status).toBe(403);
    expect(handleMetaVerification(q({ "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "1" }), "").status).toBe(403);
    expect(handleMetaVerification(q({ "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "<script>" }), "tok").status).toBe(403);
    expect(handleMetaVerification(q({ "hub.mode": "subscribe", "hub.verify_token": "tok" }), "tok").status).toBe(403);
  });
});

const wrap = (messages: unknown[], extra: object = {}) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "1", changes: [{ field: "messages", value: { messages, ...extra } }] }],
});

describe("parseMetaWebhook", () => {
  it("parses text, image, interactive and location", () => {
    const out = parseMetaWebhook(
      wrap([
        { id: "wamid.1", from: "919876543210", type: "text", text: { body: "HELP" } },
        { id: "wamid.2", from: "919876543210", type: "image", image: { id: "555", mime_type: "image/jpeg", caption: "apple" } },
        { id: "wamid.3", from: "919876543210", type: "interactive", interactive: { button_reply: { id: "b1", title: "ADD" } } },
        { id: "wamid.4", from: "919876543210", type: "interactive", interactive: { list_reply: { id: "l1", title: "2" } } },
        { id: "wamid.5", from: "919876543210", type: "location", location: { latitude: 1.5, longitude: 2.5 } },
        { id: "wamid.6", from: "919876543210", type: "audio", audio: { id: "9" } },
      ]),
      99,
    );
    expect(out.map((m) => m.kind)).toEqual(["text", "image", "interactive", "interactive", "location", "unsupported"]);
    expect(out[0]).toMatchObject({ id: "wamid.1", from: "+919876543210", text: "HELP", provider: "meta", receivedAt: 99 });
    expect(out[1].media).toEqual({ provider: "meta", mediaId: "555", contentType: "image/jpeg" });
    expect(out[1].text).toBe("apple");
    expect(out[2].text).toBe("ADD");
    expect(out[3].text).toBe("2");
    expect(out[4].location).toEqual({ latitude: 1.5, longitude: 2.5 });
  });

  it("ignores statuses and tolerates malformed payloads", () => {
    expect(parseMetaWebhook({ entry: [{ changes: [{ value: { statuses: [{ id: "x", status: "read" }] } }] }] }, 1)).toEqual([]);
    for (const bad of [null, undefined, "x", 5, {}, { entry: "no" }, { entry: [null] }, wrap([null, {}, { id: 1, from: "x", type: "text" }])]) {
      expect(parseMetaWebhook(bad, 1)).toEqual([]);
    }
  });
});

describe("createMetaSender (fake fetch)", () => {
  function fakeFetch(status = 200) {
    const calls: Array<{ url: string; init: any }> = [];
    return {
      calls,
      f: async (url: string, init?: any) => (calls.push({ url, init }), new Response(JSON.stringify(status === 200 ? {} : { error: { code: 190 } }), { status })),
    };
  }
  const cfg = { accessToken: "tok-placeholder", phoneNumberId: "1234" };

  it("posts text with a bearer token", async () => {
    const { f, calls } = fakeFetch();
    await createMetaSender({ ...cfg, fetchImpl: f }).sendText("+919876543210", "hi");
    expect(calls[0].url).toBe("https://graph.facebook.com/v20.0/1234/messages");
    expect(calls[0].init.headers.Authorization).toBe("Bearer tok-placeholder");
    expect(JSON.parse(calls[0].init.body)).toEqual({
      messaging_product: "whatsapp",
      to: "919876543210",
      type: "text",
      text: { body: "hi", preview_url: false },
    });
  });

  it("posts templates with body parameters", async () => {
    const { f, calls } = fakeFetch();
    await createMetaSender({ ...cfg, fetchImpl: f }).sendTemplate("+919876543210", { name: "pantry_expiry_reminder", language: "en", variables: ["Milk (today)"] });
    expect(JSON.parse(calls[0].init.body).template).toEqual({
      name: "pantry_expiry_reminder",
      language: { code: "en" },
      components: [{ type: "body", parameters: [{ type: "text", text: "Milk (today)" }] }],
    });
  });

  it("surfaces errors without the token", async () => {
    const { f } = fakeFetch(401);
    const err = await createMetaSender({ ...cfg, fetchImpl: f }).sendText("+919876543210", "x").catch((e) => e);
    expect(err.message).toContain("status=401");
    expect(err.message).not.toContain("tok-placeholder");
  });
});

describe("downloadMetaMedia (fake fetch)", () => {
  const media = { provider: "meta" as const, mediaId: "555" };
  it("does the two-step download with auth on both steps", async () => {
    const seen: Array<{ url: string; auth?: string }> = [];
    const f = async (url: string, init?: any) => {
      seen.push({ url, auth: init?.headers?.Authorization });
      if (url.endsWith("/v20.0/555"))
        return new Response(JSON.stringify({ url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1", file_size: 3 }), { status: 200 });
      return new Response(new Uint8Array([9, 9, 9]), { status: 200, headers: { "content-type": "image/jpeg" } });
    };
    const r = await downloadMetaMedia({ media, accessToken: "T", fetchImpl: f });
    expect(Array.from(r.bytes)).toEqual([9, 9, 9]);
    expect(seen.map((s) => s.auth)).toEqual(["Bearer T", "Bearer T"]);
  });

  it("rejects hostile resolved URLs, bad ids and oversize files", async () => {
    const hostile = (url: string) => async () => new Response(JSON.stringify({ url }), { status: 200 });
    for (const u of ["http://lookaside.fbsbx.com/x", "https://evil.example/x", "https://127.0.0.1/x", "https://graph.facebook.com@evil.com/x"]) {
      await expect(downloadMetaMedia({ media, accessToken: "T", fetchImpl: hostile(u) })).rejects.toMatchObject({ reason: "bad_url" });
    }
    await expect(downloadMetaMedia({ media: { provider: "meta", mediaId: "../x" }, accessToken: "T", fetchImpl: hostile("https://graph.facebook.com/x") })).rejects.toMatchObject({ reason: "bad_url" });
    const big = async () => new Response(JSON.stringify({ url: "https://lookaside.fbsbx.com/x", file_size: 99_000_000 }), { status: 200 });
    await expect(downloadMetaMedia({ media, accessToken: "T", fetchImpl: big })).rejects.toMatchObject({ reason: "too_large" });
  });
});
