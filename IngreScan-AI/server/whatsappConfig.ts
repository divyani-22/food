/** WhatsApp bot configuration, read from environment variables (names documented in docs/whatsapp-bot.md). */
export interface WhatsappEnv {
  twilio: { accountSid: string; authToken: string; fromNumber: string; contentSids: Record<string, string> } | null;
  meta: { appSecret: string; verifyToken: string; accessToken: string; phoneNumberId: string } | null;
  /** Public HTTPS base URL of this app (ngrok URL in development). Used to verify Twilio signatures. */
  publicBaseUrl: string;
  /** Number users should message, shown in the web app (display only). */
  botNumber: string;
  reminderTemplate: { name: string; language: string };
  useEmoji: boolean;
  remindersEnabled: boolean;
  allowSchemeVariants: boolean;
}

export function getWhatsappEnv(env: NodeJS.ProcessEnv = process.env): WhatsappEnv {
  const t = env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_WHATSAPP_FROM;
  const m = env.META_APP_SECRET && env.META_VERIFY_TOKEN && env.META_ACCESS_TOKEN && env.META_PHONE_NUMBER_ID;
  const templateName = env.WHATSAPP_REMINDER_TEMPLATE || "pantry_expiry_reminder";
  return {
    twilio: t
      ? {
          accountSid: env.TWILIO_ACCOUNT_SID!,
          authToken: env.TWILIO_AUTH_TOKEN!,
          fromNumber: env.TWILIO_WHATSAPP_FROM!,
          contentSids: env.TWILIO_REMINDER_CONTENT_SID ? { [templateName]: env.TWILIO_REMINDER_CONTENT_SID } : {},
        }
      : null,
    meta: m
      ? {
          appSecret: env.META_APP_SECRET!,
          verifyToken: env.META_VERIFY_TOKEN!,
          accessToken: env.META_ACCESS_TOKEN!,
          phoneNumberId: env.META_PHONE_NUMBER_ID!,
        }
      : null,
    publicBaseUrl: (env.PUBLIC_BASE_URL || "").replace(/\/+$/, ""),
    botNumber: env.WHATSAPP_BOT_NUMBER || "",
    reminderTemplate: { name: templateName, language: env.WHATSAPP_REMINDER_LANGUAGE || "en" },
    useEmoji: env.WHATSAPP_USE_EMOJI === "true",
    remindersEnabled: !["off", "false", "0", "no"].includes((env.WHATSAPP_REMINDERS ?? "").trim().toLowerCase()),
    allowSchemeVariants: env.WHATSAPP_TRUST_SCHEME_VARIANTS === "true",
  };
}

export function isWhatsappConfigured(env: WhatsappEnv = getWhatsappEnv()): boolean {
  return Boolean(env.twilio || env.meta);
}
