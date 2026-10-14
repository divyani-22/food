/**
 * Conversation orchestrator. `handleInbound` never throws: it always returns the
 * messages to send back, and never exposes internal error details to the user.
 */
import { parseCommand, type Command } from "./commands";
import { validateBarcode } from "./barcode";
import {
  MSG,
  escapeWa,
  helpMessage,
  linkGuidance,
  packagedReport,
  pantryPage,
  produceReport,
  rescueMessage,
  sortPantry,
} from "./format";
import { normalizeLinkCode } from "./linking";
import { inQuietHours, DEFAULT_QUIET_HOURS } from "./reminders";
import { DEFAULT_MAX_MEDIA_BYTES, MediaRejectedError, isAllowedImageType } from "./security";
import { addDaysToLocalDate, canonicalTimeZone, localDate } from "./time";
import type {
  ConversationState,
  DownloadedMedia,
  FreshnessStatus,
  HandlerDeps,
  InboundMessage,
  LinkRecord,
  OutboundMessage,
  PackagedReport,
  ProduceClassification,
} from "./types";

const MIN = 60_000;
const VALID_STATUS: FreshnessStatus[] = ["fresh", "normal", "rotten"];
const MAX_CLEAR_CHOICES = 9;

class Ctx {
  readonly out: OutboundMessage[] = [];
  constructor(
    readonly msg: InboundMessage,
    readonly deps: HandlerDeps,
    readonly now: number,
  ) {}
  say(text: string): void {
    this.out.push({ to: this.msg.from, text });
  }
  get opts() {
    return { useEmoji: this.deps.config.useEmoji === true };
  }
}

export async function handleInbound(msg: InboundMessage, deps: HandlerDeps): Promise<OutboundMessage[]> {
  const now = deps.now?.() ?? Date.now();
  const ctx = new Ctx(msg, deps, now);
  try {
    if (await deps.store.seenMessage(msg.provider, msg.id)) return [];

    const cmd = commandFor(msg);
    const limited = !deps.rateLimiter.take(msg.from, now);
    // Opt-out must always be honoured, even for a rate-limited sender.
    if (limited && cmd.type !== "stop") {
      ctx.say(MSG.rateLimited);
      return ctx.out;
    }

    const link = await deps.store.getLink(msg.from);
    if (!link) await handleUnlinked(ctx, cmd);
    else {
      await deps.store.touchInbound(msg.from, now);
      await handleLinked(ctx, link, cmd);
    }
    return ctx.out;
  } catch (err) {
    deps.log?.("error", "handle_inbound_failed", {
      error: err instanceof Error ? err.name : "unknown",
    });
    return [{ to: msg.from, text: MSG.genericError }];
  }
}

function commandFor(msg: InboundMessage): Command {
  if (msg.kind === "text" || msg.kind === "interactive") return parseCommand(msg.text);
  return { type: "empty" };
}

// ------------------------------------------------------------------ unlinked

async function handleUnlinked(ctx: Ctx, cmd: Command): Promise<void> {
  const { deps, msg, now } = ctx;
  if (cmd.type === "stop") {
    ctx.say("You will not receive reminders from FoodIQ on this number.");
    return;
  }
  if (cmd.type !== "link") {
    ctx.say(linkGuidance(deps.config.webAppUrl));
    return;
  }
  const code = cmd.code ? normalizeLinkCode(cmd.code) : null;
  if (!cmd.code) {
    ctx.say(MSG.linkUsage);
    return;
  }
  const lim = deps.linkLimiter;
  if (lim && !lim.allowed(msg.from, now)) {
    ctx.say(MSG.linkLocked);
    return;
  }
  if (!code) {
    lim?.fail(msg.from, now);
    ctx.say(MSG.linkInvalid);
    return;
  }
  const res = await deps.services.linkAccount(code, msg.from);
  if (res.ok) {
    lim?.reset(msg.from);
    await deps.store.touchInbound(msg.from, now).catch(() => undefined);
    ctx.say(MSG.linkOk(res.displayName));
    return;
  }
  if (res.reason !== "locked") lim?.fail(msg.from, now);
  ctx.say(
    res.reason === "expired"
      ? MSG.linkExpired
      : res.reason === "used"
        ? MSG.linkUsed
        : res.reason === "locked"
          ? MSG.linkLocked
          : MSG.linkInvalid,
  );
}

// -------------------------------------------------------------------- linked

async function handleLinked(ctx: Ctx, link: LinkRecord, cmd: Command): Promise<void> {
  const { msg, deps, now } = ctx;
  const tz = canonicalTimeZone(link.timezone) ?? deps.config.defaultTimezone ?? "UTC";

  if (msg.kind === "location") return ctx.say(MSG.location);
  if (msg.kind === "unsupported") return ctx.say(MSG.unsupportedMedia);
  if (msg.kind === "image") return handlePhoto(ctx, link);

  let state = await deps.store.getConversation(msg.from);
  let expired: ConversationState["kind"] | null = null;
  if (state && state.expiresAt <= now) {
    expired = state.kind;
    await deps.store.setConversation(msg.from, null);
    state = null;
  }

  switch (cmd.type) {
    case "empty":
    case "unknown":
    case "digits":
      return ctx.say(cmd.type === "digits" ? MSG.digitsHint : MSG.unknown);
    case "help":
      return ctx.say(helpMessage(true, deps.config.webAppUrl));
    case "link":
      return ctx.say("This number is already connected. To use a different account, disconnect it in Profile > Connect WhatsApp first.");
    case "cancel":
      await deps.store.setConversation(msg.from, null);
      return ctx.say(MSG.cancelled);
    case "choice":
      return handleChoice(ctx, link, cmd.n, state, expired);
    case "add":
      return handleAdd(ctx, link, tz, state, expired);
    case "fridge":
      return handleFridge(ctx, link, tz, cmd.page, state);
    case "more":
      if (state?.kind === "browsing_pantry") return handleFridge(ctx, link, tz, state.nextPage, state);
      return ctx.say(MSG.moreNone);
    case "rescue":
      return handleRescue(ctx, link, tz);
    case "clear":
      return handleClear(ctx, link, tz, cmd.name);
    case "stop": {
      await deps.services.setReminderPrefs(link.userId, { enabled: false });
      return ctx.say(MSG.stop);
    }
    case "start": {
      const p = await deps.services.setReminderPrefs(link.userId, { enabled: true });
      return ctx.say(MSG.start(p.hour, p.timezone));
    }
    case "remind":
      return handleRemind(ctx, link, cmd.hour);
    case "tz": {
      if (!cmd.zone) return ctx.say(MSG.tzUsage);
      const canon = canonicalTimeZone(cmd.zone);
      if (!canon) return ctx.say(MSG.tzInvalid(cmd.zone));
      await deps.services.setReminderPrefs(link.userId, { timezone: canon });
      return ctx.say(MSG.tzOk(canon));
    }
    case "barcode":
      return handleBarcode(ctx, link, cmd.digits);
    case "ingredients": {
      const report = await deps.services.analyzeIngredientsText(link.userId, cmd.text);
      return ctx.say(packagedReport(sanitizeReport(report), ctx.opts));
    }
  }
}

// ---------------------------------------------------------------------- ADD

async function handleAdd(
  ctx: Ctx,
  link: LinkRecord,
  tz: string,
  state: ConversationState | null,
  expired: ConversationState["kind"] | null,
): Promise<void> {
  const { deps, msg, now } = ctx;
  if (!state || state.kind !== "awaiting_add") {
    return ctx.say(expired === "awaiting_add" ? MSG.addExpired : MSG.addNothing);
  }
  const { shelfLifeDays, ...item } = state.item;
  const expiryDate = addDaysToLocalDate(localDate(now, tz), shelfLifeDays);
  await deps.services.addPantryItem(link.userId, { ...item, expiryDate });
  await deps.store.setConversation(msg.from, null);
  ctx.say(
    `Saved ${escapeWa(item.name)} to your pantry. Expected to last until ${expiryDate}` +
      `${shelfLifeDays === 0 ? " (use it today)" : ` (${shelfLifeDays} ${shelfLifeDays === 1 ? "day" : "days"})`}.\nReply FRIDGE to see your pantry.`,
  );
}

// -------------------------------------------------------------------- photos

async function handlePhoto(ctx: Ctx, link: LinkRecord): Promise<void> {
  const { deps, msg } = ctx;
  const max = deps.config.maxMediaBytes ?? DEFAULT_MAX_MEDIA_BYTES;
  if (!msg.media) return ctx.say(MSG.mediaFailed);
  if (msg.media.contentType && !isAllowedImageType(msg.media.contentType)) return ctx.say(MSG.badMediaType);

  let img: DownloadedMedia;
  try {
    img = await deps.services.downloadMedia(msg.media);
  } catch (err) {
    deps.log?.("warn", "media_download_failed", { error: err instanceof Error ? err.name : "unknown" });
    if (err instanceof MediaRejectedError) {
      return ctx.say(err.reason === "too_large" ? MSG.tooLarge : err.reason === "bad_type" ? MSG.badMediaType : MSG.mediaFailed);
    }
    return ctx.say(MSG.mediaFailed);
  }
  if (img.bytes.byteLength > max) return ctx.say(MSG.tooLarge);
  if (img.bytes.byteLength === 0) return ctx.say(MSG.mediaFailed);
  if (!isAllowedImageType(img.contentType)) return ctx.say(MSG.badMediaType);

  const raw = await deps.services.classifyImage(img);
  const result = usableClassification(raw, deps.config.minConfidence ?? 50);
  if (result) {
    ctx.say(produceReport(result, ctx.opts));
    if (result.freshnessStatus === "rotten") {
      await clearIfAdd(ctx);
    } else {
      await deps.store.setConversation(msg.from, {
        kind: "awaiting_add",
        item: {
          name: result.fruit,
          kind: "produce",
          expiryDate: "",
          source: "whatsapp_photo",
          freshnessStatus: result.freshnessStatus,
          confidence: result.confidence,
          storageTip: result.storageTip,
          shelfLifeDays: result.shelfLifeDays,
        },
        expiresAt: ctx.now + (deps.config.addTtlMs ?? 15 * MIN),
      });
    }
    return;
  }

  // Not produce. Maybe a barcode or an ingredient label.
  let found: Awaited<ReturnType<typeof deps.services.classifyOrExtract>> = { kind: "unknown" };
  try {
    found = await deps.services.classifyOrExtract(img);
  } catch (err) {
    deps.log?.("warn", "extract_failed", { error: err instanceof Error ? err.name : "unknown" });
  }
  if (found.kind === "barcode") return handleBarcode(ctx, link, found.barcode);
  if (found.kind === "label_text" && found.text.trim()) {
    const report = await deps.services.analyzeIngredientsText(link.userId, found.text.slice(0, 4000));
    return ctx.say(packagedReport(sanitizeReport(report), ctx.opts));
  }
  ctx.say(MSG.retryPhoto);
}

async function clearIfAdd(ctx: Ctx): Promise<void> {
  const s = await ctx.deps.store.getConversation(ctx.msg.from);
  if (s?.kind === "awaiting_add") await ctx.deps.store.setConversation(ctx.msg.from, null);
}

/** Reject malformed classifier output instead of showing made-up values. */
function usableClassification(c: ProduceClassification | null, minConfidence: number): ProduceClassification | null {
  if (!c) return null;
  if (typeof c.fruit !== "string" || !c.fruit.trim()) return null;
  if (!Number.isFinite(c.confidence) || c.confidence < minConfidence) return null;
  if (!VALID_STATUS.includes(c.freshnessStatus)) return null;
  if (!Number.isFinite(c.shelfLifeDays)) return null;
  return { ...c, shelfLifeDays: Math.min(365, Math.max(0, Math.round(c.shelfLifeDays))) };
}

// ------------------------------------------------------------------ barcodes

async function handleBarcode(ctx: Ctx, link: LinkRecord, input: string): Promise<void> {
  const v = validateBarcode(input);
  if (!v.valid) {
    return ctx.say(v.reason === "length" ? MSG.barcodeLength : MSG.barcodeChecksum(v.digits));
  }
  const report = await ctx.deps.services.lookupBarcode(link.userId, v.digits);
  if (!report) return ctx.say(MSG.barcodeUnknown(v.digits));
  ctx.say(packagedReport(sanitizeReport(report), ctx.opts));
}

function sanitizeReport(r: PackagedReport): PackagedReport {
  return {
    ...r,
    productName: r.productName || "Unknown product",
    riskScore: Number.isFinite(r.riskScore) ? r.riskScore : 0,
    highRiskAdditives: r.highRiskAdditives ?? [],
    allergens: r.allergens ?? [],
    personalAlerts: r.personalAlerts ?? [],
  };
}

// -------------------------------------------------------------------- pantry

async function handleFridge(
  ctx: Ctx,
  link: LinkRecord,
  tz: string,
  page: number,
  state: ConversationState | null,
): Promise<void> {
  const { deps, msg, now } = ctx;
  const items = await deps.services.listPantry(link.userId);
  if (items.length === 0) return ctx.say(MSG.pantryEmpty);
  const rows = sortPantry(items, localDate(now, tz));
  const res = pantryPage(rows, page, deps.config.pageSize ?? 8, ctx.opts);
  ctx.say(res.text);
  // Never overwrite a pending ADD or CLEAR choice with pagination state.
  const free = !state || state.kind === "browsing_pantry";
  if (free) {
    await deps.store.setConversation(
      msg.from,
      res.hasMore ? { kind: "browsing_pantry", nextPage: res.page + 1, expiresAt: now + (deps.config.browseTtlMs ?? 30 * MIN) } : null,
    );
  }
}

async function handleRescue(ctx: Ctx, link: LinkRecord, tz: string): Promise<void> {
  const { deps, now } = ctx;
  const items = await deps.services.listPantry(link.userId);
  const rows = sortPantry(items, localDate(now, tz));
  const max = deps.config.reminderDays ?? 2;
  const expiring = rows.filter((r) => r.daysLeft !== null && r.daysLeft >= 0 && r.daysLeft <= max).map((r) => r.item);
  if (expiring.length === 0) return ctx.say(MSG.rescueNone);
  const recipes = await deps.services.rescueRecipes(link.userId, expiring);
  if (!recipes.length) return ctx.say(MSG.rescueNoRecipes);
  ctx.say(rescueMessage(recipes, expiring.map((i) => i.name)));
}

async function handleClear(ctx: Ctx, link: LinkRecord, tz: string, name: string | null): Promise<void> {
  const { deps, msg, now } = ctx;
  if (!name) return ctx.say(MSG.clearUsage);
  const q = name.trim().toLowerCase();
  const rows = sortPantry(await deps.services.listPantry(link.userId), localDate(now, tz));
  const exact = rows.filter((r) => r.item.name.trim().toLowerCase() === q);
  const matches = exact.length === 1 ? exact : rows.filter((r) => r.item.name.toLowerCase().includes(q));
  if (matches.length === 0) return ctx.say(MSG.clearNone(name));
  if (matches.length === 1) {
    await deps.services.clearPantryItem(link.userId, matches[0].item.id);
    return ctx.say(`Marked ${escapeWa(matches[0].item.name)} as used up.`);
  }
  const shown = matches.slice(0, MAX_CLEAR_CHOICES);
  await deps.store.setConversation(msg.from, {
    kind: "awaiting_clear_choice",
    candidates: shown.map((r) => ({ id: r.item.id, name: r.item.name })),
    expiresAt: now + (deps.config.choiceTtlMs ?? 10 * MIN),
  });
  const lines = ["Several items match. Reply with a number, or CANCEL:"];
  shown.forEach((r, i) => lines.push(`${i + 1}. ${escapeWa(r.item.name)}`));
  if (matches.length > shown.length) lines.push(`(${matches.length - shown.length} more not shown - use a longer name)`);
  ctx.say(lines.join("\n"));
}

async function handleChoice(
  ctx: Ctx,
  link: LinkRecord,
  n: number,
  state: ConversationState | null,
  expired: ConversationState["kind"] | null,
): Promise<void> {
  const { deps, msg } = ctx;
  if (!state || state.kind !== "awaiting_clear_choice") {
    return ctx.say(expired === "awaiting_clear_choice" ? MSG.clearChoiceExpired : MSG.unknown);
  }
  const pick = state.candidates[n - 1];
  if (!pick) return ctx.say(MSG.clearChoiceInvalid(state.candidates.length));
  await deps.services.clearPantryItem(link.userId, pick.id);
  await deps.store.setConversation(msg.from, null);
  ctx.say(`Marked ${escapeWa(pick.name)} as used up.`);
}

async function handleRemind(ctx: Ctx, link: LinkRecord, hour: number | null): Promise<void> {
  const { deps } = ctx;
  if (hour === null) {
    const p = await deps.services.getReminderPrefs(link.userId);
    return ctx.say(MSG.remindUsage(p.hour));
  }
  const q = deps.config.quietHours ?? DEFAULT_QUIET_HOURS;
  if (inQuietHours(hour, q)) return ctx.say(MSG.remindQuiet(q.startHour, q.endHour));
  await deps.services.setReminderPrefs(link.userId, { hour });
  ctx.say(MSG.remindOk(hour));
}
