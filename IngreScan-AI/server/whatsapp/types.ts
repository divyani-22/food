/**
 * Narrow, explicit interfaces for the WhatsApp bot core.
 * The core is pure: all I/O goes through Store, Services and Sender, which the
 * application wires to the real DB / tRPC logic / Flask service / provider APIs.
 */

export type Provider = "twilio" | "meta";

/** Reference to media attached to an inbound message (not yet downloaded). */
export interface MediaRef {
  provider: Provider;
  /** Twilio: MediaUrl0. Meta: undefined until resolved from mediaId. */
  url?: string;
  /** Meta: media id to resolve through the Graph API. */
  mediaId?: string;
  contentType?: string;
}

export interface DownloadedMedia {
  bytes: Uint8Array;
  contentType: string;
}

export type InboundKind = "text" | "image" | "location" | "interactive" | "unsupported";

/** Provider-independent inbound message. `from` is E.164 (+15551234567). */
export interface InboundMessage {
  provider: Provider;
  /** Provider message id (Twilio MessageSid, Meta wamid). Used for dedupe. */
  id: string;
  from: string;
  /** Epoch milliseconds when the message was received by us. */
  receivedAt: number;
  kind: InboundKind;
  text?: string;
  media?: MediaRef;
  location?: { latitude: number; longitude: number };
}

/** A reply to deliver through the same provider session. */
export interface OutboundMessage {
  to: string;
  text: string;
}

// ---------------------------------------------------------------- domain data

export type FreshnessStatus = "fresh" | "normal" | "rotten";

/** Result of the Flask /api/predict call, trimmed to what the bot needs. */
export interface ProduceClassification {
  fruit: string;
  /** 0-100 (percent), as returned by the Flask service. */
  confidence: number;
  freshnessStatus: FreshnessStatus;
  shelfLifeDays: number;
  storageTip?: string;
  cookingTip?: string;
}

export type ImageInterpretation =
  | { kind: "barcode"; barcode: string }
  | { kind: "label_text"; text: string }
  | { kind: "unknown" };

export interface PackagedReport {
  productName: string;
  brand?: string;
  /** 0-100. Higher means riskier. */
  riskScore: number;
  highRiskAdditives: string[];
  /** Allergen names derived from Open Food Facts tags (e.g. "milk", "gluten"). */
  allergens: string[];
  healthierAlternative?: { name: string; brand?: string; riskScore?: number };
  /** Personalised alerts based on the user's profile/conditions. */
  personalAlerts: string[];
}

export interface PantryItem {
  id: string;
  name: string;
  kind: "produce" | "packaged";
  /** Local calendar date YYYY-MM-DD, or null if unknown. */
  expiryDate: string | null;
}

export interface NewPantryItem {
  name: string;
  kind: "produce" | "packaged";
  expiryDate: string;
  /** Free-form origin, e.g. "whatsapp_photo". */
  source: string;
  freshnessStatus?: FreshnessStatus;
  confidence?: number;
  storageTip?: string;
}

export interface Recipe {
  title: string;
  /** Short description or numbered steps, already plain text. */
  summary: string;
  usesItems: string[];
}

export interface ReminderPrefs {
  enabled: boolean;
  /** Local hour 0-23. */
  hour: number;
  /** IANA zone. */
  timezone: string;
}

export type LinkResult =
  | { ok: true; userId: string; displayName?: string }
  | { ok: false; reason: "invalid" | "expired" | "used" | "locked" };

// ------------------------------------------------------------------ Services

/**
 * Business operations. The application implements these on top of the real
 * tRPC/db logic and the Flask service. All must throw on infrastructure failure;
 * the orchestrator converts that into a friendly message (never a stack trace).
 */
export interface Services {
  /** POST to Flask /api/predict. Return null when the image is unusable. */
  classifyImage(img: DownloadedMedia): Promise<ProduceClassification | null>;
  /** Try to decode a barcode or read a label from an image that is not produce. */
  classifyOrExtract(img: DownloadedMedia): Promise<ImageInterpretation>;
  /** Open Food Facts lookup + risk analysis. Null when the barcode is unknown. */
  lookupBarcode(userId: string, barcode: string): Promise<PackagedReport | null>;
  analyzeIngredientsText(userId: string, text: string): Promise<PackagedReport>;
  listPantry(userId: string): Promise<PantryItem[]>;
  addPantryItem(userId: string, item: NewPantryItem): Promise<{ id: string }>;
  /** Mark an item as consumed. */
  clearPantryItem(userId: string, itemId: string): Promise<void>;
  rescueRecipes(userId: string, expiringItems: PantryItem[]): Promise<Recipe[]>;
  /** Redeem a link code (hash + compare + single use are the implementer's job; see linking.ts). */
  linkAccount(code: string, phone: string): Promise<LinkResult>;
  getReminderPrefs(userId: string): Promise<ReminderPrefs>;
  setReminderPrefs(userId: string, patch: Partial<ReminderPrefs>): Promise<ReminderPrefs>;
  /** Download inbound media (use downloadTwilioMedia / downloadMetaMedia). Must enforce limits. */
  downloadMedia(media: MediaRef): Promise<DownloadedMedia>;
}

// --------------------------------------------------------------------- Store

export type ConversationState =
  | {
      kind: "awaiting_add";
      item: NewPantryItem & { shelfLifeDays: number };
      expiresAt: number;
    }
  | {
      kind: "awaiting_clear_choice";
      candidates: Array<{ id: string; name: string }>;
      expiresAt: number;
    }
  | { kind: "browsing_pantry"; nextPage: number; expiresAt: number };

export interface LinkRecord {
  /** E.164 phone. */
  phone: string;
  userId: string;
  timezone: string;
  /** Preferred local hour for the daily reminder (default 9). */
  reminderHour: number;
  remindersEnabled: boolean;
  /** Epoch ms of the last inbound message from this user (customer-service window). */
  lastInboundAt: number | null;
  /** Local date YYYY-MM-DD of the last reminder, or null. */
  lastReminderLocalDate: string | null;
}

export interface ReminderLink extends LinkRecord {
  /** Active pantry items for this user (expiry dates are local dates). */
  items: PantryItem[];
}

/** Persistence. Must be atomic where noted. */
export interface Store {
  /**
   * Atomically record the message id and return true if it was ALREADY seen.
   * (e.g. INSERT ... ON CONFLICT DO NOTHING and check affected rows.)
   */
  seenMessage(provider: Provider, id: string): Promise<boolean>;
  getLink(phone: string): Promise<LinkRecord | null>;
  /** Called on every inbound message from a linked user. */
  touchInbound(phone: string, at: number): Promise<void>;
  getConversation(phone: string): Promise<ConversationState | null>;
  /** null clears the state. */
  setConversation(phone: string, state: ConversationState | null): Promise<void>;
  /** Linked users with their active items, for the reminder job. */
  listReminderCandidates(): Promise<ReminderLink[]>;
  markReminded(phone: string, localDate: string): Promise<void>;
}

// -------------------------------------------------------------------- Sender

export interface TemplateSend {
  /** Approved template name. */
  name: string;
  /** Template language code, e.g. "en". */
  language: string;
  /** Positional variables {{1}}, {{2}}, ... */
  variables: string[];
}

export interface Sender {
  sendText(to: string, text: string): Promise<void>;
  sendTemplate(to: string, template: TemplateSend): Promise<void>;
}

// -------------------------------------------------------------------- Config

export interface BotConfig {
  /** Public web app URL, used in guidance ("Profile > Connect WhatsApp"). */
  webAppUrl: string;
  /** Optional marker mode. Default false: no emoji anywhere. */
  useEmoji?: boolean;
  /** Approved template for business-initiated reminders. */
  reminderTemplate: { name: string; language: string };
  /** Default 15 minutes. */
  addTtlMs?: number;
  /** Default 10 minutes (clear choice) / 30 minutes (browsing). */
  choiceTtlMs?: number;
  browseTtlMs?: number;
  /** Fallback timezone when a link has none. */
  defaultTimezone?: string;
  /** Items shown per FRIDGE page. Default 8. */
  pageSize?: number;
  /** Quiet hours in the user's local time: no reminders when start <= hour or hour < end. Default 21 and 8. */
  quietHours?: { startHour: number; endHour: number };
  /** Reminder window in days. Default 2 (48 hours). */
  reminderDays?: number;
  /** Customer-service window. Default 24h. */
  sessionWindowMs?: number;
  /** Minimum produce confidence percent. Default 50. */
  minConfidence?: number;
  /** Media cap. Default 8 MB. */
  maxMediaBytes?: number;
}

export interface HandlerDeps {
  store: Store;
  services: Services;
  config: BotConfig;
  /** Rate limiter keyed by phone. */
  rateLimiter: { take(key: string, now?: number): boolean };
  /** Optional brute-force guard for LINK attempts (see AttemptLimiter in linking.ts). */
  linkLimiter?: {
    allowed(key: string, now: number): boolean;
    fail(key: string, now: number): void;
    reset(key: string): void;
  };
  /** Clock, injectable for tests. */
  now?: () => number;
  /** Optional logger. Never pass user content that may contain secrets. */
  log?: (level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) => void;
}
