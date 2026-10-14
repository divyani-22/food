import { createHmac } from "node:crypto";
import { normalizePhone, toTwilioAddress } from "../phone";
import { safeEqual } from "../security";
import { splitMessage } from "../format";
import type { DownloadedMedia, InboundMessage, MediaRef, Sender, TemplateSend } from "../types";
import { fetchMediaSafely, ProviderSendError, type FetchLike } from "./mediaFetch";

export type TwilioParams = Record<string, string | string[]>;

/** Parse an application/x-www-form-urlencoded body. Repeated keys become arrays. */
export function parseFormBody(body: string): TwilioParams {
  const out: TwilioParams = Object.create(null);
  new URLSearchParams(body).forEach((v, k) => {
    const prev = out[k];
    if (prev === undefined) out[k] = v;
    else out[k] = Array.isArray(prev) ? [...prev, v] : [prev, v];
  });
  return out;
}

/** base64(HMAC-SHA1(authToken, url + sorted(name+value ...))). */
export function computeTwilioSignature(url: string, params: TwilioParams, authToken: string): string {
  let data = url;
  for (const key of Object.keys(params).sort()) {
    const v = params[key];
    const values = Array.isArray(v) ? [...v].sort() : [v];
    for (const val of values) data += key + val;
  }
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

export function verifyTwilioSignature(args: {
  url: string;
  params: TwilioParams;
  signature: string | undefined | null;
  authToken: string;
}): boolean {
  if (!args.signature || !args.authToken) return false;
  return safeEqual(computeTwilioSignature(args.url, args.params, args.authToken), args.signature);
}

/**
 * Candidate URLs Twilio may have signed. The primary candidate is
 * `${publicBaseUrl}${pathAndQuery}`. The http/https twin is included ONLY when
 * allowSchemeVariants is true (e.g. a proxy that terminates TLS and strips the scheme).
 */
export function twilioUrlCandidates(args: {
  publicBaseUrl: string;
  pathAndQuery: string;
  allowSchemeVariants?: boolean;
}): string[] {
  const base = args.publicBaseUrl.replace(/\/+$/, "");
  const primary = base + args.pathAndQuery;
  const out = [primary];
  if (args.allowSchemeVariants) {
    if (primary.startsWith("https://")) out.push("http://" + primary.slice(8));
    else if (primary.startsWith("http://")) out.push("https://" + primary.slice(7));
  }
  return out;
}

export function verifyTwilioWebhook(args: {
  publicBaseUrl: string;
  pathAndQuery: string;
  params: TwilioParams;
  signature: string | undefined | null;
  authToken: string;
  allowSchemeVariants?: boolean;
}): boolean {
  return twilioUrlCandidates(args).some((url) =>
    verifyTwilioSignature({ url, params: args.params, signature: args.signature, authToken: args.authToken }),
  );
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Normalize a Twilio WhatsApp webhook. Returns null for status callbacks / junk. */
export function parseTwilioWebhook(params: TwilioParams, receivedAt: number): InboundMessage | null {
  const id = first(params.MessageSid) ?? first(params.SmsMessageSid);
  const from = normalizePhone(first(params.From));
  if (!id || !from) return null;
  // Status callbacks carry MessageStatus and no Body/media.
  const numMedia = Number.parseInt(first(params.NumMedia) ?? "0", 10) || 0;
  const body = first(params.Body);
  if (first(params.MessageStatus) && body === undefined && numMedia === 0) return null;

  const base = { provider: "twilio" as const, id, from, receivedAt };
  if (numMedia > 0) {
    const url = first(params.MediaUrl0);
    const contentType = first(params.MediaContentType0)?.toLowerCase();
    if (url && contentType?.startsWith("image/")) {
      const media: MediaRef = { provider: "twilio", url, contentType };
      return { ...base, kind: "image", text: body || undefined, media };
    }
    return { ...base, kind: "unsupported", text: body || undefined };
  }
  const lat = Number.parseFloat(first(params.Latitude) ?? "");
  const lon = Number.parseFloat(first(params.Longitude) ?? "");
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return { ...base, kind: "location", location: { latitude: lat, longitude: lon } };
  }
  return { ...base, kind: "text", text: body ?? "" };
}

// ------------------------------------------------------------------- sending

export interface TwilioSenderConfig {
  accountSid: string;
  authToken: string;
  /** WhatsApp sender, e.g. "+14155238886" (sandbox) or your approved number. */
  fromNumber: string;
  /** Map approved template name -> Content SID (HX...). A name already starting with "HX" is used as-is. */
  contentSids?: Record<string, string>;
  fetchImpl?: FetchLike;
  /** Twilio WhatsApp bodies are limited to 1600 chars; default chunk is 1500. */
  maxChunk?: number;
  apiBase?: string;
}

export function createTwilioSender(cfg: TwilioSenderConfig): Sender {
  const doFetch: FetchLike = cfg.fetchImpl ?? ((i, init) => fetch(i, init));
  const base = cfg.apiBase ?? "https://api.twilio.com";
  const url = `${base}/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}/Messages.json`;
  const auth = "Basic " + Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString("base64");

  async function post(form: Record<string, string>): Promise<void> {
    const res = await doFetch(url, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      let code: string | undefined;
      try {
        const j = (await res.json()) as { code?: number };
        if (j?.code !== undefined) code = String(j.code);
      } catch {
        /* ignore */
      }
      throw new ProviderSendError("twilio", res.status, code);
    }
  }

  return {
    async sendText(to, text) {
      for (const chunk of splitMessage(text, cfg.maxChunk ?? 1500)) {
        await post({ From: toTwilioAddress(cfg.fromNumber), To: toTwilioAddress(to), Body: chunk });
      }
    },
    async sendTemplate(to, t: TemplateSend) {
      const sid = cfg.contentSids?.[t.name] ?? (t.name.startsWith("HX") ? t.name : undefined);
      if (!sid) throw new Error(`twilio_template_unmapped:${t.name}`);
      const vars: Record<string, string> = {};
      t.variables.forEach((v, i) => (vars[String(i + 1)] = v));
      await post({
        From: toTwilioAddress(cfg.fromNumber),
        To: toTwilioAddress(to),
        ContentSid: sid,
        ContentVariables: JSON.stringify(vars),
      });
    },
  };
}

// --------------------------------------------------------------------- media

export function downloadTwilioMedia(args: {
  media: MediaRef;
  accountSid: string;
  authToken: string;
  maxBytes?: number;
  fetchImpl?: FetchLike;
}): Promise<DownloadedMedia> {
  return fetchMediaSafely({
    url: args.media.url ?? "",
    provider: "twilio",
    headers: { Authorization: "Basic " + Buffer.from(`${args.accountSid}:${args.authToken}`).toString("base64") },
    maxBytes: args.maxBytes,
    fetchImpl: args.fetchImpl,
  });
}
