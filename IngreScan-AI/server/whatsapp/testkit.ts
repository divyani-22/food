/** In-memory fakes for unit tests. These test the bot logic only, not real integrations. */
import { handleInbound } from "./conversation";
import { AttemptLimiter } from "./linking";
import { TokenBucketLimiter } from "./security";
import type {
  BotConfig,
  ConversationState,
  HandlerDeps,
  InboundMessage,
  LinkRecord,
  PackagedReport,
  PantryItem,
  ProduceClassification,
  ReminderLink,
  ReminderPrefs,
  Sender,
  Services,
  Store,
  TemplateSend,
} from "./types";

export class MemoryStore implements Store {
  seen = new Set<string>();
  links = new Map<string, LinkRecord>();
  states = new Map<string, ConversationState>();
  items: ReminderLink["items"] = [];
  reminded: Array<[string, string]> = [];

  async seenMessage(provider: string, id: string) {
    const k = `${provider}:${id}`;
    if (this.seen.has(k)) return true;
    this.seen.add(k);
    return false;
  }
  async getLink(phone: string) {
    return this.links.get(phone) ?? null;
  }
  async touchInbound(phone: string, at: number) {
    const l = this.links.get(phone);
    if (l) l.lastInboundAt = at;
  }
  async getConversation(phone: string) {
    return this.states.get(phone) ?? null;
  }
  async setConversation(phone: string, s: ConversationState | null) {
    if (s) this.states.set(phone, s);
    else this.states.delete(phone);
  }
  async listReminderCandidates(): Promise<ReminderLink[]> {
    return Array.from(this.links.values()).map((l) => ({ ...l, items: this.items }));
  }
  async markReminded(phone: string, d: string) {
    const l = this.links.get(phone);
    if (l) l.lastReminderLocalDate = d;
    this.reminded.push([phone, d]);
  }
}

export const PHONE = "+919876543210";

export function makeLink(over: Partial<LinkRecord> = {}): LinkRecord {
  return {
    phone: PHONE,
    userId: "u1",
    timezone: "Asia/Kolkata",
    reminderHour: 9,
    remindersEnabled: true,
    lastInboundAt: null,
    lastReminderLocalDate: null,
    ...over,
  };
}

export const GOOD_PRODUCE: ProduceClassification = {
  fruit: "Banana",
  confidence: 92.4,
  freshnessStatus: "fresh",
  shelfLifeDays: 5,
  storageTip: "Keep at room temperature.",
};

export class FakeServices implements Services {
  calls: Array<[string, unknown[]]> = [];
  produce: ProduceClassification | null = GOOD_PRODUCE;
  extract: Awaited<ReturnType<Services["classifyOrExtract"]>> = { kind: "unknown" };
  report: PackagedReport | null = {
    productName: "Cola",
    riskScore: 71,
    highRiskAdditives: ["E150d caramel colour"],
    allergens: [],
    personalAlerts: ["High sugar for your diabetes profile"],
  };
  pantry: PantryItem[] = [];
  prefs: ReminderPrefs = { enabled: true, hour: 9, timezone: "Asia/Kolkata" };
  linkResult: Awaited<ReturnType<Services["linkAccount"]>> = { ok: true, userId: "u1", displayName: "Asha" };
  recipes = [{ title: "Banana pancakes", summary: "Mash and fry.", usesItems: ["Banana"] }];
  fail: Partial<Record<keyof Services, Error>> = {};
  media: { bytes: Uint8Array; contentType: string } = { bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" };

  private rec<T>(name: keyof Services, args: unknown[], value: T): T {
    this.calls.push([name, args]);
    const f = this.fail[name];
    if (f) throw f;
    return value;
  }
  async classifyImage(img: unknown) { return this.rec("classifyImage", [img], this.produce); }
  async classifyOrExtract(img: unknown) { return this.rec("classifyOrExtract", [img], this.extract); }
  async lookupBarcode(u: string, b: string) { return this.rec("lookupBarcode", [u, b], this.report); }
  async analyzeIngredientsText(u: string, t: string) {
    return this.rec("analyzeIngredientsText", [u, t], this.report ?? ({ productName: "Pasted ingredients", riskScore: 10, highRiskAdditives: [], allergens: [], personalAlerts: [] } as PackagedReport));
  }
  async listPantry(u: string) { return this.rec("listPantry", [u], this.pantry); }
  async addPantryItem(u: string, i: unknown) { return this.rec("addPantryItem", [u, i], { id: "new1" }); }
  async clearPantryItem(u: string, id: string) { this.rec("clearPantryItem", [u, id], null); }
  async rescueRecipes(u: string, items: PantryItem[]) { return this.rec("rescueRecipes", [u, items], this.recipes); }
  async linkAccount(code: string, phone: string) { return this.rec("linkAccount", [code, phone], this.linkResult); }
  async getReminderPrefs(u: string) { return this.rec("getReminderPrefs", [u], this.prefs); }
  async setReminderPrefs(u: string, patch: Partial<ReminderPrefs>) {
    this.prefs = { ...this.prefs, ...patch };
    return this.rec("setReminderPrefs", [u, patch], this.prefs);
  }
  async downloadMedia(m: unknown) { return this.rec("downloadMedia", [m], this.media); }
  called(name: string) { return this.calls.filter((c) => c[0] === name); }
}

export class FakeSender implements Sender {
  texts: Array<{ to: string; text: string }> = [];
  templates: Array<{ to: string; t: TemplateSend }> = [];
  async sendText(to: string, text: string) { this.texts.push({ to, text }); }
  async sendTemplate(to: string, t: TemplateSend) { this.templates.push({ to, t }); }
}

export const NOW = Date.UTC(2026, 9, 14, 6, 30); // 12:00 in Asia/Kolkata, 2026-10-14

export const CONFIG: BotConfig = {
  webAppUrl: "https://app.example.test",
  reminderTemplate: { name: "pantry_expiry_reminder", language: "en" },
};

export interface Harness {
  store: MemoryStore;
  services: FakeServices;
  deps: HandlerDeps;
  clock: { now: number };
  send(text: string, extra?: Partial<InboundMessage>): Promise<string[]>;
  photo(extra?: Partial<InboundMessage>): Promise<string[]>;
}

let seq = 0;
export function makeHarness(opts: { linked?: boolean; config?: Partial<BotConfig>; rate?: { capacity: number; refillPerSec: number } } = {}): Harness {
  const store = new MemoryStore();
  const services = new FakeServices();
  const clock = { now: NOW };
  if (opts.linked !== false) store.links.set(PHONE, makeLink());
  const deps: HandlerDeps = {
    store,
    services,
    config: { ...CONFIG, ...opts.config },
    rateLimiter: new TokenBucketLimiter({ ...(opts.rate ?? { capacity: 100, refillPerSec: 100 }), now: () => clock.now }),
    linkLimiter: new AttemptLimiter(),
    now: () => clock.now,
  };
  const base = (): InboundMessage => ({ provider: "twilio", id: `SM${++seq}`, from: PHONE, receivedAt: clock.now, kind: "text" });
  return {
    store,
    services,
    deps,
    clock,
    async send(text, extra) {
      return (await handleInbound({ ...base(), text, ...extra }, deps)).map((m) => m.text);
    },
    async photo(extra) {
      return (
        await handleInbound(
          { ...base(), kind: "image", media: { provider: "twilio", url: "https://api.twilio.com/media/1", contentType: "image/jpeg" }, ...extra },
          deps,
        )
      ).map((m) => m.text);
    },
  };
}
