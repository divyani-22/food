/** Phone helpers: E.164 normalization and provider prefix handling. */

const WA_PREFIX = /^whatsapp:/i;

/**
 * Normalize to E.164 ("+" followed by 8-15 digits). Accepts "whatsapp:+1 (555) 123-4567".
 * Meta sends digits without "+", so a bare digit string is treated as already
 * including the country code. Returns null if it cannot be a valid number.
 */
export function normalizePhone(input: string | undefined | null): string | null {
  if (!input) return null;
  let s = String(input).trim().replace(WA_PREFIX, "").trim();
  if (s.startsWith("00")) s = "+" + s.slice(2);
  const digits = s.replace(/[^0-9]/g, "");
  if (!/^[1-9][0-9]{7,14}$/.test(digits)) return null;
  // Reject strings with letters or odd characters.
  if (/[A-Za-z]/.test(s)) return null;
  return "+" + digits;
}

/** Twilio addressing: "whatsapp:+15551234567". */
export function toTwilioAddress(e164: string): string {
  // The Twilio console shows senders as "whatsapp:+1415...", which is what operators paste into TWILIO_WHATSAPP_FROM.
  const n = normalizePhone(e164);
  if (n) return "whatsapp:" + n;
  const bare = e164.trim().replace(WA_PREFIX, "");
  return "whatsapp:" + (bare.startsWith("+") ? bare : "+" + bare);
}

/** Meta addressing: digits only. */
export function toMetaAddress(e164: string): string {
  return e164.replace(/^\+/, "");
}

/** Mask for logs: +1555***4567 */
export function maskPhone(e164: string): string {
  if (e164.length <= 7) return "***";
  return e164.slice(0, 4) + "***" + e164.slice(-4);
}
