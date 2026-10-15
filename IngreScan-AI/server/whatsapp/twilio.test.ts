import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  computeTwilioSignature,
  createTwilioSender,
  downloadTwilioMedia,
  parseFormBody,
  parseTwilioWebhook,
  twilioUrlCandidates,
  verifyTwilioSignature,
  verifyTwilioWebhook,
} from "./providers/twilio";

const TOKEN = "12345678901234567890123456789012";
const URL_ = "https://mycompany.com/myapp.php?foo=1&bar=2";
const PARAMS = {
  CallSid: "CA1234567890ABCDE",
  Caller: "+12349013030",
  Digits: "1234",
  From: "+12349013030",
  To: "+18005551212",
};
/**
 * NOTE: the task brief quoted "0/KCTR6DLpKmkAf8muzZqo1nDgQ=" for this input. It does NOT
 * reproduce (checked with node:crypto AND `openssl dgst -sha1 -hmac`), so it is not used.
 * The value below was computed independently with openssl and is a regression value for the
 * documented algorithm, not an official Twilio constant.
 */
const OPENSSL_SIGNATURE = "ywaPmaw4i7u6NcKlNoz8UEm3vLY=";

describe("Twilio signature", () => {
  it("matches an independent computation (openssl) of the documented algorithm", () => {
    expect(computeTwilioSignature(URL_, PARAMS, TOKEN)).toBe(OPENSSL_SIGNATURE);
    // Re-derive by hand: url + sorted name/value pairs, HMAC-SHA1, base64.
    let data = URL_;
    for (const k of Object.keys(PARAMS).sort()) data += k + (PARAMS as any)[k];
    expect(createHmac("sha1", TOKEN).update(data).digest("base64")).toBe(OPENSSL_SIGNATURE);
  });

  it("does not reproduce the signature quoted in the brief (documented, not edited)", () => {
    expect(computeTwilioSignature(URL_, PARAMS, TOKEN)).not.toBe("0/KCTR6DLpKmkAf8muzZqo1nDgQ=");
  });

  it("verifies a good signature", () => {
    expect(verifyTwilioSignature({ url: URL_, params: PARAMS, signature: OPENSSL_SIGNATURE, authToken: TOKEN })).toBe(true);
  });

  it("is independent of parameter order", () => {
    const shuffled = { To: PARAMS.To, Digits: PARAMS.Digits, CallSid: PARAMS.CallSid, From: PARAMS.From, Caller: PARAMS.Caller };
    expect(verifyTwilioSignature({ url: URL_, params: shuffled, signature: OPENSSL_SIGNATURE, authToken: TOKEN })).toBe(true);
  });

  it("rejects tampered params, url, token and bad signature shapes", () => {
    const ok = { url: URL_, params: PARAMS, signature: OPENSSL_SIGNATURE, authToken: TOKEN };
    expect(verifyTwilioSignature({ ...ok, params: { ...PARAMS, Digits: "1235" } })).toBe(false);
    expect(verifyTwilioSignature({ ...ok, params: { ...PARAMS, Extra: "x" } })).toBe(false);
    expect(verifyTwilioSignature({ ...ok, url: URL_ + "&x=1" })).toBe(false);
    expect(verifyTwilioSignature({ ...ok, url: URL_.replace("https", "http") })).toBe(false);
    expect(verifyTwilioSignature({ ...ok, authToken: TOKEN.slice(1) + "0" })).toBe(false);
    expect(verifyTwilioSignature({ ...ok, signature: "" })).toBe(false);
    expect(verifyTwilioSignature({ ...ok, signature: undefined })).toBe(false);
    expect(verifyTwilioSignature({ ...ok, signature: OPENSSL_SIGNATURE.slice(0, -2) + "A=" })).toBe(false);
    expect(verifyTwilioSignature({ ...ok, authToken: "" })).toBe(false);
  });

  it("handles repeated parameters", () => {
    const p = parseFormBody("a=2&a=1&b=x");
    expect(p.a).toEqual(["2", "1"]);
    const sig = computeTwilioSignature("https://h/p", p, "tok");
    expect(sig).toBe(computeTwilioSignature("https://h/p", { b: "x", a: ["1", "2"] }, "tok"));
  });

  it("only tries the other scheme when explicitly allowed", () => {
    const httpSig = computeTwilioSignature("http://x.test/api/whatsapp/twilio", PARAMS, TOKEN);
    const base = { publicBaseUrl: "https://x.test/", pathAndQuery: "/api/whatsapp/twilio", params: PARAMS, signature: httpSig, authToken: TOKEN };
    expect(verifyTwilioWebhook(base)).toBe(false);
    expect(verifyTwilioWebhook({ ...base, allowSchemeVariants: true })).toBe(true);
    expect(twilioUrlCandidates({ publicBaseUrl: "https://x.test", pathAndQuery: "/a" })).toEqual(["https://x.test/a"]);
    expect(twilioUrlCandidates({ publicBaseUrl: "https://x.test", pathAndQuery: "/a", allowSchemeVariants: true })).toEqual([
      "https://x.test/a",
      "http://x.test/a",
    ]);
  });
});

describe("parseTwilioWebhook", () => {
  it("parses text", () => {
    const m = parseTwilioWebhook(parseFormBody("MessageSid=SM1&From=whatsapp%3A%2B919876543210&Body=Hello&NumMedia=0"), 5);
    expect(m).toEqual({ provider: "twilio", id: "SM1", from: "+919876543210", receivedAt: 5, kind: "text", text: "Hello" });
  });
  it("parses an image", () => {
    const m = parseTwilioWebhook(
      parseFormBody("MessageSid=SM2&From=whatsapp%3A%2B919876543210&Body=&NumMedia=1&MediaUrl0=https%3A%2F%2Fapi.twilio.com%2Fm%2F1&MediaContentType0=image%2Fjpeg"),
      5,
    );
    expect(m?.kind).toBe("image");
    expect(m?.media).toEqual({ provider: "twilio", url: "https://api.twilio.com/m/1", contentType: "image/jpeg" });
  });
  it("marks non-image media unsupported, parses location, drops status callbacks and junk", () => {
    const pdf = parseTwilioWebhook(parseFormBody("MessageSid=SM3&From=whatsapp%3A%2B919876543210&NumMedia=1&MediaUrl0=https%3A%2F%2Fa.b%2Fc&MediaContentType0=application%2Fpdf"), 1);
    expect(pdf?.kind).toBe("unsupported");
    const loc = parseTwilioWebhook(parseFormBody("MessageSid=SM4&From=whatsapp%3A%2B919876543210&Latitude=19.07&Longitude=72.87"), 1);
    expect(loc?.location).toEqual({ latitude: 19.07, longitude: 72.87 });
    expect(parseTwilioWebhook(parseFormBody("MessageSid=SM5&From=whatsapp%3A%2B919876543210&MessageStatus=delivered"), 1)).toBeNull();
    expect(parseTwilioWebhook(parseFormBody("Body=hi"), 1)).toBeNull();
    expect(parseTwilioWebhook(parseFormBody("MessageSid=S&From=whatsapp%3Anotaphone&Body=hi"), 1)).toBeNull();
  });
});

describe("createTwilioSender (fake fetch)", () => {
  function fakeFetch(status = 201) {
    const calls: Array<{ url: string; init: any }> = [];
    const f = async (url: string, init?: any) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(status >= 400 ? { code: 63016 } : { sid: "SM1" }), { status });
    };
    return { f, calls };
  }
  const cfg = { accountSid: "ACtest", authToken: "tok", fromNumber: "+14155238886" };

  it("posts text with basic auth and whatsapp: addressing", async () => {
    const { f, calls } = fakeFetch();
    await createTwilioSender({ ...cfg, fetchImpl: f }).sendText("+919876543210", "hello");
    expect(calls[0].url).toBe("https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json");
    expect(calls[0].init.headers.Authorization).toBe("Basic " + Buffer.from("ACtest:tok").toString("base64"));
    const body = new URLSearchParams(calls[0].init.body);
    expect(body.get("To")).toBe("whatsapp:+919876543210");
    expect(body.get("From")).toBe("whatsapp:+14155238886");
    expect(body.get("Body")).toBe("hello");
  });

  it("chunks long text under the Twilio 1600 char limit", async () => {
    const { f, calls } = fakeFetch();
    const text = Array.from({ length: 200 }, (_, i) => `line number ${i} with some padding text`).join("\n");
    await createTwilioSender({ ...cfg, fetchImpl: f }).sendText("+919876543210", text);
    expect(calls.length).toBeGreaterThan(1);
    for (const c of calls) expect(new URLSearchParams(c.init.body).get("Body")!.length).toBeLessThanOrEqual(1500);
  });

  it("sends templates through ContentSid and variables", async () => {
    const { f, calls } = fakeFetch();
    const s = createTwilioSender({ ...cfg, fetchImpl: f, contentSids: { pantry_expiry_reminder: "HXabc" } });
    await s.sendTemplate("+919876543210", { name: "pantry_expiry_reminder", language: "en", variables: ["Milk (today)"] });
    const body = new URLSearchParams(calls[0].init.body);
    expect(body.get("ContentSid")).toBe("HXabc");
    expect(JSON.parse(body.get("ContentVariables")!)).toEqual({ "1": "Milk (today)" });
    expect(body.get("Body")).toBeNull();
    await expect(s.sendTemplate("+919876543210", { name: "unknown", language: "en", variables: [] })).rejects.toThrow(/unmapped/);
  });

  it("raises an error without leaking credentials", async () => {
    const { f } = fakeFetch(400);
    const err = await createTwilioSender({ ...cfg, fetchImpl: f }).sendText("+919876543210", "x").catch((e) => e);
    expect(err.message).toContain("status=400");
    expect(err.message).toContain("63016");
    expect(err.message).not.toContain("tok");
  });
});

describe("downloadTwilioMedia (fake fetch)", () => {
  const media = { provider: "twilio" as const, url: "https://api.twilio.com/2010-04-01/Accounts/AC/Messages/MM/Media/ME", contentType: "image/jpeg" };
  const auth = { accountSid: "AC", authToken: "tok" };

  it("follows a redirect to the CDN without forwarding credentials", async () => {
    const seen: Array<{ url: string; headers: any }> = [];
    const f = async (url: string, init?: any) => {
      seen.push({ url, headers: init?.headers });
      if (url.includes("api.twilio.com"))
        return new Response(null, { status: 302, headers: { location: "https://media.twiliocdn.com/abc" } });
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } });
    };
    const r = await downloadTwilioMedia({ media, ...auth, fetchImpl: f });
    expect(Array.from(r.bytes)).toEqual([1, 2, 3]);
    expect(seen[0].headers.Authorization).toMatch(/^Basic /);
    expect(seen[1].headers).toBeUndefined();
  });

  it("refuses redirects to non-allowlisted hosts and plain http", async () => {
    for (const loc of ["https://evil.example/x", "http://media.twiliocdn.com/x", "https://169.254.169.254/latest"]) {
      const f = async () => new Response(null, { status: 302, headers: { location: loc } });
      await expect(downloadTwilioMedia({ media, ...auth, fetchImpl: f })).rejects.toMatchObject({ reason: "bad_url" });
    }
  });

  it("refuses a hostile starting URL without fetching", async () => {
    let called = false;
    const f = async () => ((called = true), new Response("x"));
    await expect(
      downloadTwilioMedia({ media: { ...media, url: "https://api.twilio.com@evil.com/x" }, ...auth, fetchImpl: f }),
    ).rejects.toMatchObject({ reason: "bad_url" });
    expect(called).toBe(false);
  });

  it("enforces content type and size limits", async () => {
    const mk = (headers: Record<string, string>, body: Uint8Array) => async () => new Response(body, { status: 200, headers });
    await expect(
      downloadTwilioMedia({ media, ...auth, fetchImpl: mk({ "content-type": "text/html" }, new Uint8Array([1])) }),
    ).rejects.toMatchObject({ reason: "bad_type" });
    await expect(
      downloadTwilioMedia({ media, ...auth, maxBytes: 4, fetchImpl: mk({ "content-type": "image/png" }, new Uint8Array(10)) }),
    ).rejects.toMatchObject({ reason: "too_large" });
    const declared = async () =>
      new Response(new Uint8Array(2), { status: 200, headers: { "content-type": "image/png", "content-length": "99999999" } });
    await expect(downloadTwilioMedia({ media, ...auth, fetchImpl: declared })).rejects.toMatchObject({ reason: "too_large" });
    const ok = await downloadTwilioMedia({ media, ...auth, fetchImpl: mk({ "content-type": "image/webp; charset=x" }, new Uint8Array(3)) });
    expect(ok.contentType).toBe("image/webp");
  });

  it("limits redirect depth", async () => {
    const f = async () => new Response(null, { status: 302, headers: { location: "https://media.twiliocdn.com/loop" } });
    await expect(downloadTwilioMedia({ media, ...auth, fetchImpl: f })).rejects.toMatchObject({ reason: "download_failed" });
  });
});
