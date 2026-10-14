/**
 * E-bill normalisation: turns the raw content of a grocery-delivery e-bill
 * (a .eml file, an HTML email body, or pasted text) into line-structured plain
 * text that the receipt parser can read, plus metadata (merchant, subject,
 * sender, email date).
 *
 * PURE module: no I/O, no DOM, no dependencies. HTML is processed by a small
 * hand-written tolerant tokenizer (never innerHTML, never evaluated, scripts
 * and styles are dropped). Never throws: garbage in yields empty text plus
 * warnings. All work is bounded (input size, MIME depth, part count).
 *
 * HONESTY: it is written from the general structure of MIME and of typical
 * order-confirmation emails. It has NOT been verified against real bills from
 * Instacart, Blinkit, Zepto, BigBasket, Swiggy Instamart or Amazon Fresh.
 */

export type EbillMerchantId = "instacart" | "blinkit" | "zepto" | "bigbasket" | "instamart" | "amazon_fresh" | "generic";

export interface EbillMerchant {
  id: EbillMerchantId;
  /** Display name. "Generic" when nothing matched. */
  name: string;
}

export type EbillFormat = "eml" | "html" | "text";

export interface EbillText {
  /** Line-structured plain text (may contain non-ASCII; the parser folds it). */
  text: string;
  format: EbillFormat;
  subject?: string;
  from?: string;
  /** Email Date header as ISO date YYYY-MM-DD, when present and valid. */
  headerDate?: string;
  merchant: EbillMerchant;
  warnings: string[];
}

export const MAX_EBILL_CHARS = 1_000_000;
const MAX_OUT_CHARS = 200_000;
const MAX_MIME_DEPTH = 6;
const MAX_MIME_PARTS = 60;
const MAX_TAG_CHARS = 4000;

export const EBILL_MERCHANTS: Readonly<Record<EbillMerchantId, EbillMerchant>> = {
  instacart: { id: "instacart", name: "Instacart" },
  blinkit: { id: "blinkit", name: "Blinkit" },
  zepto: { id: "zepto", name: "Zepto" },
  bigbasket: { id: "bigbasket", name: "BigBasket" },
  instamart: { id: "instamart", name: "Swiggy Instamart" },
  amazon_fresh: { id: "amazon_fresh", name: "Amazon Fresh" },
  generic: { id: "generic", name: "Generic" },
};

/* ------------------------------------------------------------------ */
/* Byte / charset helpers                                               */
/* ------------------------------------------------------------------ */

function decodeBytes(bytes: Uint8Array, charset: string | undefined): string {
  const label = (charset || "utf-8").trim().toLowerCase().replace(/^["']|["']$/g, "");
  try {
    return new TextDecoder(label || "utf-8").decode(bytes);
  } catch {
    try {
      return new TextDecoder("utf-8").decode(bytes);
    } catch {
      let s = "";
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] & 0x7f);
      return s;
    }
  }
}

function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function decodeBase64Bytes(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/_-]/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = clean + "=".repeat((4 - (clean.length % 4)) % 4);
  try {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return new Uint8Array(0);
  }
}

function hexVal(c: number): number {
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 65 && c <= 70) return c - 55;
  if (c >= 97 && c <= 102) return c - 87;
  return -1;
}

/** Quoted-printable to bytes. `headerMode` also maps "_" to a space (RFC 2047 Q encoding). */
function decodeQuotedPrintableBytes(s: string, headerMode = false): Uint8Array {
  const src = headerMode ? s : s.replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const ch = src.charCodeAt(i);
    if (ch === 61 /* = */ && i + 2 < src.length && hexVal(src.charCodeAt(i + 1)) >= 0 && hexVal(src.charCodeAt(i + 2)) >= 0) {
      out.push(hexVal(src.charCodeAt(i + 1)) * 16 + hexVal(src.charCodeAt(i + 2)));
      i += 2;
    } else if (headerMode && ch === 95) {
      out.push(32);
    } else if (ch < 128) {
      out.push(ch);
    } else {
      // Non-ASCII in an already-decoded string: keep UTF-8 bytes.
      const enc = new TextEncoder().encode(src[i]);
      for (let q = 0; q < enc.length; q++) out.push(enc[q]);
    }
  }
  return Uint8Array.from(out);
}

/** Decode RFC 2047 encoded words ("=?utf-8?B?...?=") in a header value. */
export function decodeMimeWords(value: string): string {
  const joined = value.replace(/(\?=)\s+(=\?)/g, "$1$2");
  return joined.replace(/=\?([^?\s]+)\?([bBqQ])\?([^?\s]*)\?=/g, (_m, cs: string, enc: string, data: string) => {
    const charset = cs.split("*")[0];
    const bytes = enc.toLowerCase() === "b" ? decodeBase64Bytes(data) : decodeQuotedPrintableBytes(data, true);
    return decodeBytes(bytes, charset);
  });
}

/* ------------------------------------------------------------------ */
/* MIME parsing                                                         */
/* ------------------------------------------------------------------ */

interface MimeHeaders {
  [name: string]: string;
}

function splitHeaderBody(raw: string): { head: string; body: string } {
  const m = /\r?\n\r?\n/.exec(raw);
  if (!m) return { head: raw, body: "" };
  return { head: raw.slice(0, m.index), body: raw.slice(m.index + m[0].length) };
}

function parseHeaders(head: string): MimeHeaders {
  const out: MimeHeaders = {};
  const unfolded = head.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0 || i > 80) continue;
    const name = line.slice(0, i).trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(name)) continue;
    if (!(name in out)) out[name] = line.slice(i + 1).trim();
  }
  return out;
}

function headerParam(value: string | undefined, param: string): string | undefined {
  if (!value) return undefined;
  const re = new RegExp(`(?:^|;)\\s*${param}\\s*=\\s*(?:"([^"]*)"|([^;\\s]*))`, "i");
  const m = re.exec(value);
  return m ? (m[1] ?? m[2]) : undefined;
}

interface MimeLeaf {
  type: string;
  text: string;
}

function decodeBody(body: string, encoding: string | undefined, charset: string | undefined): string {
  const enc = (encoding || "7bit").trim().toLowerCase();
  if (enc === "base64") return decodeBytes(decodeBase64Bytes(body), charset);
  if (enc === "quoted-printable") return decodeBytes(decodeQuotedPrintableBytes(body), charset);
  // 7bit / 8bit / binary: the string is already characters (the client read it as UTF-8).
  return body;
}

function collectLeaves(raw: string, depth: number, state: { parts: number; warnings: string[] }, leaves: MimeLeaf[]): void {
  if (depth > MAX_MIME_DEPTH) {
    state.warnings.push("Email nesting was deeper than supported; inner parts ignored.");
    return;
  }
  if (++state.parts > MAX_MIME_PARTS) return;
  const { head, body } = splitHeaderBody(raw);
  const headers = parseHeaders(head);
  const ctype = (headers["content-type"] || "text/plain").trim();
  const type = ctype.split(";")[0].trim().toLowerCase();
  const disposition = (headers["content-disposition"] || "").toLowerCase();
  if (type.startsWith("multipart/")) {
    const boundary = headerParam(ctype, "boundary");
    if (!boundary || boundary.length > 200) {
      state.warnings.push("Multipart email without a usable boundary; reading it as plain text.");
      leaves.push({ type: "text/plain", text: body });
      return;
    }
    const marker = "--" + boundary;
    const chunks = body.split(marker);
    // chunks[0] is the preamble; the part after "--boundary--" is the epilogue.
    for (let i = 1; i < chunks.length && state.parts <= MAX_MIME_PARTS; i++) {
      let chunk = chunks[i];
      if (chunk.startsWith("--")) break;
      chunk = chunk.replace(/^[ \t]*\r?\n/, "");
      if (chunk.trim()) collectLeaves(chunk, depth + 1, state, leaves);
    }
    return;
  }
  if (disposition.startsWith("attachment")) return;
  if (type === "text/plain" || type === "text/html") {
    leaves.push({ type, text: decodeBody(body, headers["content-transfer-encoding"], headerParam(ctype, "charset")) });
  }
}

/* ------------------------------------------------------------------ */
/* HTML to text                                                         */
/* ------------------------------------------------------------------ */

const DROP_CONTENT_TAGS = new Set(["script", "style", "noscript", "template", "svg", "head", "title", "object", "iframe"]);
const BLOCK_TAGS = new Set([
  "p", "div", "br", "li", "ul", "ol", "tr", "table", "tbody", "thead", "tfoot", "h1", "h2", "h3", "h4", "h5", "h6",
  "section", "article", "header", "footer", "blockquote", "pre", "hr", "dl", "dt", "dd", "center", "address", "main", "form",
]);
const CELL_TAGS = new Set(["td", "th"]);

const cp = (...codes: number[]): string => String.fromCharCode(...codes);
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ", zwnj: "", zwj: "", shy: "",
  rupee: cp(0x20b9), euro: cp(0x20ac), pound: cp(0xa3), yen: cp(0xa5), cent: cp(0xa2), times: cp(0xd7), middot: cp(0xb7),
  bull: cp(0x2022), ndash: "-", mdash: "-", minus: "-", hellip: "...", lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"',
  copy: "(c)", reg: "(r)", trade: "(tm)", deg: " deg ", frac12: "1/2", frac14: "1/4", frac34: "3/4",
};

function decodeEntities(s: string): string {
  if (s.indexOf("&") < 0) return s;
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,8}|[a-z][a-z0-9]{1,10});?/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return " ";
      try {
        return String.fromCodePoint(code);
      } catch {
        return " ";
      }
    }
    const key = body.toLowerCase();
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : m;
  });
}

function isLetter(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

/**
 * Tolerant, linear-time HTML to text. Block elements and table rows become
 * line breaks, table cells are separated by two spaces, scripts/styles/heads
 * are dropped, entities decoded. Unterminated tags/comments never loop.
 */
export function htmlToText(html: string): string {
  const src = html.length > MAX_EBILL_CHARS ? html.slice(0, MAX_EBILL_CHARS) : html;
  const lower = src.toLowerCase();
  const out: string[] = [];
  let outLen = 0;
  const push = (s: string) => {
    if (outLen > MAX_OUT_CHARS * 2) return;
    out.push(s);
    outLen += s.length;
  };
  let i = 0;
  const n = src.length;
  let textStart = 0;
  let unterminated = 0;
  const flushText = (end: number) => {
    if (end > textStart) push(decodeEntities(src.slice(textStart, end)));
  };
  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt < 0) {
      i = n;
      break;
    }
    const next = src.charCodeAt(lt + 1);
    const isComment = src.startsWith("<!--", lt);
    const isDecl = next === 33 /* ! */ || next === 63 /* ? */;
    const isClose = next === 47 /* / */;
    const tagStart = isClose ? lt + 2 : lt + 1;
    if (!isComment && !isDecl && !isLetter(src.charCodeAt(tagStart))) {
      // A stray "<" in text (for example "a < b").
      i = lt + 1;
      continue;
    }
    flushText(lt);
    if (isComment) {
      const end = src.indexOf("-->", lt + 4);
      i = end < 0 ? n : end + 3;
      textStart = i;
      continue;
    }
    if (isDecl) {
      const end = src.indexOf(">", lt + 2);
      i = end < 0 ? n : end + 1;
      textStart = i;
      continue;
    }
    // Tag name.
    let j = tagStart;
    while (j < n && j - tagStart < 20 && /[A-Za-z0-9:-]/.test(src[j])) j++;
    const name = lower.slice(tagStart, j);
    // Find the end of the tag, honouring quoted attribute values (bounded).
    let k = j;
    let quote = 0;
    const limit = Math.min(n, lt + MAX_TAG_CHARS);
    let closed = false;
    for (; k < limit; k++) {
      const c = src.charCodeAt(k);
      if (quote) {
        if (c === quote) quote = 0;
      } else if (c === 34 || c === 39) quote = c;
      else if (c === 62) {
        closed = true;
        break;
      }
    }
    if (!closed) {
      // Unterminated tag: treat the "<" as text and move on. After many of these the input is not HTML
      // (or is hostile), so stop scanning for tags: this keeps the work linear in the input size.
      if (++unterminated > 50) {
        push("<");
        i = lt + 1;
        textStart = i;
        break;
      }
      push("<");
      i = lt + 1;
      textStart = i;
      continue;
    }
    i = k + 1;
    textStart = i;
    if (!isClose && DROP_CONTENT_TAGS.has(name)) {
      const selfClosed = src.charCodeAt(k - 1) === 47;
      if (!selfClosed) {
        const closeIdx = lower.indexOf("</" + name, i);
        if (closeIdx < 0) {
          i = n;
        } else {
          const gt = src.indexOf(">", closeIdx);
          i = gt < 0 ? n : gt + 1;
        }
        textStart = i;
      }
      continue;
    }
    if (CELL_TAGS.has(name)) push("  ");
    else if (BLOCK_TAGS.has(name)) push("\n");
  }
  flushText(n);
    return tidyLines(out.join(""));
}

const RE_INVISIBLE = new RegExp("[" + cp(0x200b) + "-" + cp(0x200f) + cp(0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2060, 0xfeff, 0xad, 0x34f) + "]", "g");
const RE_NBSP_LIKE = new RegExp("[" + cp(0xa0) + cp(0x2000) + "-" + cp(0x200a) + cp(0x202f, 0x205f, 0x3000) + "]", "g");
const RE_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Trim lines, squeeze whitespace (cells stay separated by two spaces), drop repeated blank lines. */
function tidyLines(s: string): string {
  const cleaned = s.replace(RE_CONTROL, " ").replace(RE_INVISIBLE, "").replace(RE_NBSP_LIKE, " ").replace(/\r\n?/g, "\n");
  const lines: string[] = [];
  let blank = 0;
  for (const rawLine of cleaned.split("\n")) {
    const line = rawLine.replace(/[ \t]{3,}/g, "  ").replace(/^[ \t]+|[ \t]+$/g, "");
    if (!line) {
      if (++blank <= 1 && lines.length > 0) lines.push("");
      continue;
    }
    blank = 0;
    lines.push(line.length > 400 ? line.slice(0, 400) : line);
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Merchant detection                                                   */
/* ------------------------------------------------------------------ */

const MERCHANT_RULES: ReadonlyArray<{ id: EbillMerchantId; domain: RegExp; word: RegExp }> = [
  { id: "blinkit", domain: /blinkit|grofers/i, word: /\bblink\s?it\b|\bgrofers\b/i },
  { id: "zepto", domain: /zepto/i, word: /\bzepto\b/i },
  { id: "instamart", domain: /instamart|swiggy/i, word: /\binstamart\b|\bswiggy\b/i },
  { id: "bigbasket", domain: /bigbasket|bbdaily|bb-?now/i, word: /\bbig\s?basket\b|\bbb\s?daily\b|\bbbnow\b/i },
  { id: "amazon_fresh", domain: /amazonfresh|fresh\.amazon/i, word: /\bamazon\s*fresh\b|\bamazonfresh\b|\bwhole foods market via amazon\b/i },
  { id: "instacart", domain: /instacart/i, word: /\binstacart\b/i },
];

/**
 * Decide the merchant from sender, subject and body (in that order of trust).
 * "Amazon" alone (without "Fresh") in the sender plus a fresh-grocery hint in
 * the subject/body is treated as Amazon Fresh.
 */
export function detectEbillMerchant(parts: { from?: string; subject?: string; text?: string }): EbillMerchant {
  const from = (parts.from || "").slice(0, 400);
  const subject = (parts.subject || "").slice(0, 400);
  const text = (parts.text || "").slice(0, 200_000);
  const head = text.slice(0, 4000);
  for (const r of MERCHANT_RULES) if (r.domain.test(from)) return EBILL_MERCHANTS[r.id];
  for (const r of MERCHANT_RULES) if (r.word.test(subject)) return EBILL_MERCHANTS[r.id];
  for (const r of MERCHANT_RULES) if (r.word.test(head)) return EBILL_MERCHANTS[r.id];
  if (/amazon/i.test(from) && /\bfresh\b/i.test(subject + "\n" + head)) return EBILL_MERCHANTS.amazon_fresh;
  for (const r of MERCHANT_RULES) if (r.word.test(text)) return EBILL_MERCHANTS[r.id];
  return EBILL_MERCHANTS.generic;
}

/* ------------------------------------------------------------------ */
/* Main entry                                                           */
/* ------------------------------------------------------------------ */

const EML_HEADER_START = /^(?:received|return-path|delivered-to|mime-version|content-type|message-id|from|to|subject|date|x-[a-z-]+|dkim-signature|reply-to|content-transfer-encoding):/i;

function looksLikeEml(raw: string): boolean {
  const first = raw.slice(0, 4000).split(/\r?\n/);
  let hits = 0;
  for (const line of first.slice(0, 12)) {
    if (EML_HEADER_START.test(line)) hits++;
    else if (line.trim() === "") break;
  }
  if (hits >= 2) return true;
  return /^(?:mime-version|content-type|received|return-path|delivered-to):/im.test(first.slice(0, 20).join("\n")) && hits >= 1;
}

function looksLikeHtml(raw: string): boolean {
  return /<\s*(?:!doctype\s+html|html|body|table|div|p|br|span|tr|td|ul|li|h[1-6])\b/i.test(raw.slice(0, 20_000));
}

/** Email Date header ("Tue, 14 Oct 2026 10:00:00 +0530") to YYYY-MM-DD, or undefined. */
function headerDateToIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const t = Date.parse(value.replace(/\([^)]*\)/g, " "));
  if (!Number.isFinite(t)) return undefined;
  const d = new Date(t);
  const y = d.getUTCFullYear();
  if (y < 2000 || y > 2100) return undefined;
  // Use the date as written in the header (before timezone shift) when we can read it.
  const m = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/.exec(value);
  if (m) {
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const mi = months.indexOf(m[2].toLowerCase());
    if (mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return d.toISOString().slice(0, 10);
}

function plainHeaderLines(text: string): { subject?: string; from?: string; date?: string } {
  const out: { subject?: string; from?: string; date?: string } = {};
  const head = text.split("\n").slice(0, 25);
  for (const line of head) {
    const m = /^\s*(subject|from|date|sent)\s*:\s*(.{1,300})$/i.exec(line);
    if (!m) continue;
    const k = m[1].toLowerCase();
    if (k === "subject" && !out.subject) out.subject = m[2].trim();
    else if (k === "from" && !out.from) out.from = m[2].trim();
    else if ((k === "date" || k === "sent") && !out.date) out.date = m[2].trim();
  }
  return out;
}

/** Score a candidate body: more currency amounts / digits means a more complete bill. */
function billScore(text: string): number {
  const amounts = (text.match(/\d+[.,]\d{2}\b/g) || []).length;
  return amounts * 10 + Math.min(text.length, 5000) / 1000;
}

/**
 * Normalise an e-bill (EML, HTML or text) into plain text with metadata.
 * Never throws.
 */
export function ebillToText(input: unknown, options: { filename?: string } = {}): EbillText {
  const warnings: string[] = [];
  const empty = (w: string): EbillText => ({ text: "", format: "text", merchant: EBILL_MERCHANTS.generic, warnings: [...warnings, w] });
  try {
    if (typeof input !== "string") return empty("E-bill content was not text.");
    let raw = input;
    if (raw.length > MAX_EBILL_CHARS) {
      raw = raw.slice(0, MAX_EBILL_CHARS);
      warnings.push("E-bill was longer than 1 MB; only the first 1 MB was read.");
    }
    if (/^%PDF-/.test(raw)) return empty("PDF files are not supported. Open the PDF, copy its text and paste it instead.");
    raw = raw.replace(/^﻿/, "");

    const fname = (options.filename || "").toLowerCase();
    let format: EbillFormat = "text";
    let subject: string | undefined;
    let from: string | undefined;
    let headerDate: string | undefined;
    let text: string;

    if (fname.endsWith(".eml") || looksLikeEml(raw)) {
      format = "eml";
      const { head } = splitHeaderBody(raw);
      const headers = parseHeaders(head);
      subject = headers["subject"] ? decodeMimeWords(headers["subject"]).slice(0, 300) : undefined;
      from = headers["from"] ? decodeMimeWords(headers["from"]).slice(0, 300) : undefined;
      headerDate = headerDateToIso(headers["date"]);
      const leaves: MimeLeaf[] = [];
      collectLeaves(raw, 0, { parts: 0, warnings }, leaves);
      const converted = leaves.map((l) => ({ type: l.type, text: l.type === "text/html" ? htmlToText(l.text) : tidyLines(l.text) }));
      if (converted.length === 0) {
        text = "";
        warnings.push("No readable text part was found in the email.");
      } else {
        // Prefer the part that contains more amounts; HTML wins ties because plain stubs are often just a link.
        let best = converted[0];
        for (const c of converted) {
          if (billScore(c.text) > billScore(best.text) || (billScore(c.text) === billScore(best.text) && c.type === "text/html")) best = c;
        }
        text = best.text;
      }
    } else if (fname.endsWith(".html") || fname.endsWith(".htm") || looksLikeHtml(raw)) {
      format = "html";
      text = htmlToText(raw);
    } else {
      text = tidyLines(raw);
      const h = plainHeaderLines(text);
      subject = h.subject;
      from = h.from;
      headerDate = headerDateToIso(h.date);
    }
    if (text.length > MAX_OUT_CHARS) {
      text = text.slice(0, MAX_OUT_CHARS);
      warnings.push("E-bill text was truncated.");
    }
    if (format === "html") {
      const t = /<title[^>]*>([\s\S]{1,300}?)<\/title>/i.exec(raw);
      if (t) subject = decodeEntities(t[1]).replace(/\s+/g, " ").trim() || undefined;
    }
    const merchant = detectEbillMerchant({ from, subject, text });
    if (!text.trim()) warnings.push("The e-bill had no readable text.");
    return {
      text,
      format,
      ...(subject ? { subject } : {}),
      ...(from ? { from } : {}),
      ...(headerDate ? { headerDate } : {}),
      merchant,
      warnings,
    };
  } catch {
    return empty("The e-bill could not be read.");
  }
}
