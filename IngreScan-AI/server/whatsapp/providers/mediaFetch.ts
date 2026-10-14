import type { DownloadedMedia, Provider } from "../types";
import {
  DEFAULT_MAX_MEDIA_BYTES,
  MediaRejectedError,
  checkMediaUrl,
  isAllowedImageType,
  normalizeContentType,
} from "../security";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface MediaFetchOptions {
  url: string;
  provider: Provider;
  headers?: Record<string, string>;
  maxBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

/**
 * Download an image with SSRF protections: every hop (including redirects) must
 * be https on the provider allowlist; credentials are only sent to the first
 * host; size and content type are enforced before/while reading.
 */
export async function fetchMediaSafely(opts: MediaFetchOptions): Promise<DownloadedMedia> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_MEDIA_BYTES;
  const maxRedirects = opts.maxRedirects ?? 3;
  const doFetch: FetchLike = opts.fetchImpl ?? ((i, init) => fetch(i, init));
  let current = opts.url;
  const firstHost = safeHost(current);

  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!checkMediaUrl(current, opts.provider).ok) throw new MediaRejectedError("bad_url");
    const sameHost = safeHost(current) === firstHost;
    const res = await doFetch(current, {
      method: "GET",
      redirect: "manual",
      headers: sameHost ? opts.headers : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new MediaRejectedError("download_failed");
      current = new URL(loc, current).toString();
      continue;
    }
    if (!res.ok) throw new MediaRejectedError("download_failed");

    const contentType = normalizeContentType(res.headers.get("content-type"));
    if (!isAllowedImageType(contentType)) throw new MediaRejectedError("bad_type");
    const declared = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > maxBytes) throw new MediaRejectedError("too_large");

    const bytes = await readCapped(res, maxBytes);
    if (bytes.byteLength === 0) throw new MediaRejectedError("empty");
    return { bytes, contentType };
  }
  throw new MediaRejectedError("download_failed");
}

function safeHost(u: string): string {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return "";
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) throw new MediaRejectedError("too_large");
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new MediaRejectedError("too_large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/** Error from a provider send API. Never includes credentials. */
export class ProviderSendError extends Error {
  constructor(
    public readonly provider: Provider,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(`${provider}_send_failed status=${status}${code ? ` code=${code}` : ""}`);
    this.name = "ProviderSendError";
  }
}
