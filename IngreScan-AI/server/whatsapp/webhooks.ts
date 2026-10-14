/**
 * Framework-free webhook processors. The Express layer passes raw inputs and then
 * delivers `outbound` with a Sender (see `deliver`). See docs/whatsapp-bot.md.
 */
import { handleInbound } from "./conversation";
import { handleMetaVerification, parseMetaWebhook, verifyMetaSignature } from "./providers/meta";
import { parseFormBody, parseTwilioWebhook, verifyTwilioSignature } from "./providers/twilio";
import type { HandlerDeps, OutboundMessage, Sender } from "./types";

export type Headers = Record<string, string | string[] | undefined>;

export interface WebhookResult {
  status: number;
  body: string;
  contentType: string;
  outbound: OutboundMessage[];
}

export function getHeader(headers: Headers, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) {
      const v = headers[k];
      return Array.isArray(v) ? v[0] : v;
    }
  }
  return undefined;
}

const MAX_MESSAGES_PER_REQUEST = 50;
const empty = (status: number, body = ""): WebhookResult => ({ status, body, contentType: "text/plain", outbound: [] });

/** http <-> https twin of a URL, only when explicitly allowed. */
export function schemeVariants(url: string, allow: boolean): string[] {
  if (!allow) return [url];
  if (url.startsWith("https://")) return [url, "http://" + url.slice(8)];
  if (url.startsWith("http://")) return [url, "https://" + url.slice(7)];
  return [url];
}

export interface TwilioWebhookConfig {
  authToken: string;
  /** Try the http/https twin of `url` when verifying (reverse proxies). Default false. */
  allowSchemeVariants?: boolean;
}

/**
 * @param url the exact public URL Twilio requested (PUBLIC_BASE_URL + req.originalUrl)
 * @param formBody the raw application/x-www-form-urlencoded body string
 */
export async function processTwilioWebhook(
  input: { url: string; formBody: string; headers: Headers },
  deps: HandlerDeps & { twilio: TwilioWebhookConfig },
): Promise<WebhookResult> {
  const params = parseFormBody(input.formBody ?? "");
  const signature = getHeader(input.headers, "x-twilio-signature");
  const ok = schemeVariants(input.url, deps.twilio.allowSchemeVariants === true).some((u) =>
    verifyTwilioSignature({ url: u, params, signature, authToken: deps.twilio.authToken }),
  );
  if (!ok) {
    deps.log?.("warn", "twilio_signature_rejected");
    return empty(403, "forbidden");
  }
  const msg = parseTwilioWebhook(params, deps.now?.() ?? Date.now());
  // Twilio expects TwiML or an empty 200; replies are sent through the REST API.
  const ack = { status: 200, body: "<Response></Response>", contentType: "text/xml" };
  if (!msg) return { ...ack, outbound: [] };
  return { ...ack, outbound: await handleInbound(msg, deps) };
}

export interface MetaWebhookConfig {
  appSecret: string;
  verifyToken: string;
}

export async function processMetaWebhook(
  input: { rawBody?: string | Uint8Array; headers: Headers; query?: Record<string, string | string[] | undefined>; method?: "GET" | "POST" },
  deps: HandlerDeps & { meta: MetaWebhookConfig },
): Promise<WebhookResult> {
  const method = input.method ?? (input.rawBody === undefined || input.rawBody.length === 0 ? "GET" : "POST");
  if (method === "GET") {
    const r = handleMetaVerification(input.query ?? {}, deps.meta.verifyToken);
    return { status: r.status, body: r.body, contentType: "text/plain", outbound: [] };
  }
  const raw = input.rawBody ?? "";
  if (!verifyMetaSignature(raw, getHeader(input.headers, "x-hub-signature-256"), deps.meta.appSecret)) {
    deps.log?.("warn", "meta_signature_rejected");
    return empty(403, "forbidden");
  }
  let json: unknown;
  try {
    json = JSON.parse(typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8"));
  } catch {
    return empty(400, "bad request");
  }
  const messages = parseMetaWebhook(json, deps.now?.() ?? Date.now()).slice(0, MAX_MESSAGES_PER_REQUEST);
  const outbound: OutboundMessage[] = [];
  for (const m of messages) outbound.push(...(await handleInbound(m, deps)));
  return { status: 200, body: "ok", contentType: "text/plain", outbound };
}

/** Send replies one by one; a failed send is logged and does not stop the rest. */
export async function deliver(
  sender: Sender,
  outbound: OutboundMessage[],
  log?: HandlerDeps["log"],
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const m of outbound) {
    try {
      await sender.sendText(m.to, m.text);
      sent++;
    } catch (err) {
      failed++;
      log?.("error", "deliver_failed", { error: err instanceof Error ? err.name : "unknown" });
    }
  }
  return { sent, failed };
}
