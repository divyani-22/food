import { createHmac } from "node:crypto";
import { normalizePhone, toMetaAddress } from "../phone";
import { DEFAULT_MAX_MEDIA_BYTES, MediaRejectedError, checkMediaUrl, safeEqual } from "../security";
import { splitMessage } from "../format";
import type { DownloadedMedia, InboundMessage, MediaRef, Sender, TemplateSend } from "../types";
import { fetchMediaSafely, ProviderSendError, type FetchLike } from "./mediaFetch";

export const GRAPH_VERSION = "v20.0";

/** Verify X-Hub-Signature-256 ("sha256=<hex>") over the RAW request body. */
export function verifyMetaSignature(
  rawBody: string | Uint8Array,
  header: string | undefined | null,
  appSecret: string,
): boolean {
  if (!header || !appSecret) return false;
  const m = /^sha256=([0-9a-fA-F]{64})$/.exec(header.trim());
  if (!m) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return safeEqual(expected, m[1].toLowerCase());
}

export interface MetaChallengeResult {
  status: 200 | 403;
  body: string;
}

/** Handle the GET verification handshake (hub.mode / hub.verify_token / hub.challenge). */
export function handleMetaVerification(
  query: Record<string, string | string[] | undefined>,
  verifyToken: string,
): MetaChallengeResult {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const mode = one(query["hub.mode"]);
  const token = one(query["hub.verify_token"]);
  const challenge = one(query["hub.challenge"]);
  // Challenge is reflected in the response body: accept only a conservative charset.
  if (
    mode === "subscribe" &&
    verifyToken.length > 0 &&
    token !== undefined &&
    safeEqual(token, verifyToken) &&
    challenge !== undefined &&
    /^[A-Za-z0-9_-]{1,200}$/.test(challenge)
  ) {
    return { status: 200, body: challenge };
  }
  return { status: 403, body: "forbidden" };
}

interface MetaWebhookJson {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<Record<string, any>>;
        statuses?: unknown[];
      };
    }>;
  }>;
}

/** Parse the Cloud API webhook JSON. Status updates are ignored. Never throws on odd shapes. */
export function parseMetaWebhook(json: unknown, receivedAt: number): InboundMessage[] {
  const out: InboundMessage[] = [];
  const body = json as MetaWebhookJson | null;
  if (!body || !Array.isArray(body.entry)) return out;
  for (const entry of body.entry) {
    for (const change of entry?.changes ?? []) {
      for (const m of change?.value?.messages ?? []) {
        const id = typeof m?.id === "string" ? m.id : undefined;
        const from = normalizePhone(typeof m?.from === "string" ? m.from : undefined);
        if (!id || !from) continue;
        const base = { provider: "meta" as const, id, from, receivedAt };
        switch (m.type) {
          case "text":
            out.push({ ...base, kind: "text", text: String(m.text?.body ?? "") });
            break;
          case "image": {
            const mediaId = typeof m.image?.id === "string" ? m.image.id : undefined;
            if (!mediaId) {
              out.push({ ...base, kind: "unsupported" });
              break;
            }
            const media: MediaRef = {
              provider: "meta",
              mediaId,
              contentType: typeof m.image?.mime_type === "string" ? m.image.mime_type : undefined,
            };
            out.push({ ...base, kind: "image", text: m.image?.caption ? String(m.image.caption) : undefined, media });
            break;
          }
          case "interactive": {
            const r = m.interactive?.button_reply ?? m.interactive?.list_reply;
            const text = r ? String(r.title ?? r.id ?? "") : "";
            out.push({ ...base, kind: "interactive", text });
            break;
          }
          case "location": {
            const latitude = Number(m.location?.latitude);
            const longitude = Number(m.location?.longitude);
            if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
              out.push({ ...base, kind: "location", location: { latitude, longitude } });
            } else out.push({ ...base, kind: "unsupported" });
            break;
          }
          default:
            out.push({ ...base, kind: "unsupported" });
        }
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------- sending

export interface MetaSenderConfig {
  accessToken: string;
  phoneNumberId: string;
  graphVersion?: string;
  fetchImpl?: FetchLike;
  maxChunk?: number;
  apiBase?: string;
}

export function createMetaSender(cfg: MetaSenderConfig): Sender {
  const doFetch: FetchLike = cfg.fetchImpl ?? ((i, init) => fetch(i, init));
  const base = cfg.apiBase ?? "https://graph.facebook.com";
  const url = `${base}/${cfg.graphVersion ?? GRAPH_VERSION}/${encodeURIComponent(cfg.phoneNumberId)}/messages`;

  async function post(payload: unknown): Promise<void> {
    const res = await doFetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      let code: string | undefined;
      try {
        const j = (await res.json()) as { error?: { code?: number } };
        if (j?.error?.code !== undefined) code = String(j.error.code);
      } catch {
        /* ignore */
      }
      throw new ProviderSendError("meta", res.status, code);
    }
  }

  return {
    async sendText(to, text) {
      for (const chunk of splitMessage(text, cfg.maxChunk ?? 4000)) {
        await post({
          messaging_product: "whatsapp",
          to: toMetaAddress(to),
          type: "text",
          text: { body: chunk, preview_url: false },
        });
      }
    },
    async sendTemplate(to, t: TemplateSend) {
      await post({
        messaging_product: "whatsapp",
        to: toMetaAddress(to),
        type: "template",
        template: {
          name: t.name,
          language: { code: t.language },
          components: t.variables.length
            ? [{ type: "body", parameters: t.variables.map((v) => ({ type: "text", text: v })) }]
            : [],
        },
      });
    },
  };
}

// --------------------------------------------------------------------- media

/** Two-step download: GET media id -> {url}, then authenticated GET of that url. */
export async function downloadMetaMedia(args: {
  media: MediaRef;
  accessToken: string;
  graphVersion?: string;
  maxBytes?: number;
  fetchImpl?: FetchLike;
  apiBase?: string;
}): Promise<DownloadedMedia> {
  const id = args.media.mediaId ?? "";
  if (!/^[0-9]{1,30}$/.test(id)) throw new MediaRejectedError("bad_url");
  const doFetch: FetchLike = args.fetchImpl ?? ((i, init) => fetch(i, init));
  const maxBytes = args.maxBytes ?? DEFAULT_MAX_MEDIA_BYTES;
  const headers = { Authorization: `Bearer ${args.accessToken}` };
  const metaUrl = `${args.apiBase ?? "https://graph.facebook.com"}/${args.graphVersion ?? GRAPH_VERSION}/${id}`;
  const res = await doFetch(metaUrl, { method: "GET", headers, redirect: "manual", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new MediaRejectedError("download_failed");
  const info = (await res.json()) as { url?: string; file_size?: number };
  if (!info?.url || !checkMediaUrl(info.url, "meta").ok) throw new MediaRejectedError("bad_url");
  if (typeof info.file_size === "number" && info.file_size > maxBytes) throw new MediaRejectedError("too_large");
  return fetchMediaSafely({ url: info.url, provider: "meta", headers, maxBytes, fetchImpl: args.fetchImpl });
}
