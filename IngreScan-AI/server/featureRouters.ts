/**
 * Routers for the pantry intelligence features: ethylene storage alerts, personal health alerts for a scan,
 * "rescue my fridge" recipes and the WhatsApp account link. Merged into appRouter in routers.ts.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  HEALTH_DISCLAIMER,
  analyzeEthyleneStorage,
  buildRescuePrompt,
  evaluateHealthAlerts,
  processRescueResponse,
  selectRescueItems,
} from "@shared/engines";
import { protectedProcedure, router } from "./_core/trpc";
import { invokeLLM, isRealLLMConfigured } from "./_core/llm";
import * as db from "./db";
import * as dbf from "./dbFeatures";
import { getLLMText } from "./logic";
import { createLinkCode } from "./whatsapp/linking";
import { getWhatsappEnv, isWhatsappConfigured } from "./whatsappConfig";

/** Whole calendar days from today (UTC date) to a YYYY-MM-DD expiry. */
function daysLeftFromDate(expiryDate: string, now: Date = new Date()): number {
  const target = Date.parse(`${expiryDate}T00:00:00Z`);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Number.isNaN(target) ? 0 : Math.round((target - today) / 86_400_000);
}

async function profileContext(userId: number) {
  const [profile, conditions, medications] = await Promise.all([
    db.getUserProfile(userId),
    db.getMedicalConditions(userId),
    db.getMedications(userId),
  ]);
  return {
    profile,
    conditions: conditions.map((c) => c.condition),
    medications: medications.map((m) => ({ name: m.name, isCurrent: m.isCurrent, dosage: m.dosage })),
  };
}

export const insightsRouter = router({
  /** Items in the pantry that should not share a drawer (ethylene producers next to sensitive produce). */
  ethyleneAlerts: protectedProcedure.query(async ({ ctx }) => {
    const pantry = await dbf.listActivePantry(ctx.user.id);
    const alerts = analyzeEthyleneStorage(
      pantry.map((p) => ({
        name: p.name,
        // FreshGuard produce has no storage location of its own: a fridge crisper is the typical home.
        storageLocation: p.storageLocation ?? "fridge",
        daysLeft: daysLeftFromDate(p.expiryDate),
      }))
    );
    return { alerts, itemCount: pantry.length };
  }),

  /** Personal alerts for a scan, computed from its ingredients and the user's profile (deterministic, no LLM). */
  healthAlerts: protectedProcedure
    .input(z.object({ scanId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const scan = await db.getFoodScan(input.scanId, ctx.user.id); // scoped to the owner in the query itself
      if (!scan) throw new TRPCError({ code: "NOT_FOUND", message: "Scan not found" });
      const [ingredients, pc] = await Promise.all([db.getScanIngredients(input.scanId), profileContext(ctx.user.id)]);
      const alerts = evaluateHealthAlerts({
        ingredients: ingredients.map((i) => ({ name: i.name, category: i.category, riskLevel: i.riskLevel })),
        profile: pc.profile ? { dietType: pc.profile.dietType } : null,
        conditions: pc.conditions,
        medications: pc.medications,
        dietType: pc.profile?.dietType ?? null,
      });
      return { alerts, disclaimer: HEALTH_DISCLAIMER, hasProfile: Boolean(pc.profile || pc.conditions.length || pc.medications.length) };
    }),
});

export const rescueRouter = router({
  /**
   * 15-minute recipes from items close to expiry. Uses the configured LLM when there is one; otherwise (or when the
   * LLM is unreachable or returns nothing usable) deterministic offline recipes, always labelled with their source.
   */
  recipes: protectedProcedure
    .input(
      z.object({
        windowDays: z.number().int().min(1).max(5).default(3),
        utcOffsetMinutes: z.number().int().min(-840).max(840).default(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const pantry = await dbf.listActivePantry(ctx.user.id);
      const selection = selectRescueItems(
        pantry.map((p) => ({ id: p.id, title: p.name, category: null, storageLocation: p.storageLocation, expiryDate: p.expiryDate })),
        new Date(),
        { windowDays: input.windowDays, utcOffsetMinutes: input.utcOffsetMinutes }
      );
      if (selection.urgent.length === 0) {
        return { selection, recipes: [], source: "none" as const, usedFallback: false, dropped: [] };
      }
      const pc = await profileContext(ctx.user.id);
      const ctxInfo = { conditions: pc.conditions, dietType: pc.profile?.dietType ?? null };

      let text = "";
      let source: "llm" | "offline" = "offline";
      if (isRealLLMConfigured()) {
        try {
          const prompt = buildRescuePrompt(selection, pc.profile, pc.conditions, ctxInfo.dietType);
          text = getLLMText(await invokeLLM({ messages: prompt.messages }));
          source = "llm";
        } catch (err) {
          console.warn("[Rescue] LLM unavailable, using offline recipes:", err instanceof Error ? err.message : err);
        }
      }
      const result = processRescueResponse(text, selection, ctxInfo);
      return {
        selection,
        recipes: result.recipes,
        source: result.usedFallback ? ("offline" as const) : source,
        usedFallback: result.usedFallback,
        dropped: result.dropped,
      };
    }),
});

// ----------------------------------------------------------------- WhatsApp link

const linkCodeBuckets = new Map<number, number[]>();

function maskPhone(phone: string): string {
  return phone.length <= 6 ? "***" : `${phone.slice(0, 3)}${"*".repeat(Math.max(phone.length - 6, 3))}${phone.slice(-3)}`;
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const whatsappRouter = router({
  status: protectedProcedure.query(async ({ ctx }) => {
    const env = getWhatsappEnv();
    const link = await dbf.getWhatsappLinkByUser(ctx.user.id);
    return {
      configured: isWhatsappConfigured(env),
      botNumber: env.botNumber,
      linked: Boolean(link),
      phoneMasked: link ? maskPhone(link.phone) : null,
      timezone: link?.timezone ?? null,
      reminderHour: link?.reminderHour ?? null,
      remindersEnabled: link?.remindersEnabled ?? null,
    };
  }),

  /** One-time code (valid 10 minutes). The user sends "LINK <code>" to the bot from their own phone. */
  createLinkCode: protectedProcedure.mutation(async ({ ctx }) => {
    if (!isWhatsappConfigured()) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The WhatsApp bot is not configured on this server." });
    }
    const now = Date.now();
    const recent = (linkCodeBuckets.get(ctx.user.id) ?? []).filter((t) => now - t < 60 * 60 * 1000);
    if (recent.length >= 5) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many codes requested. Please wait a while and try again." });
    }
    linkCodeBuckets.set(ctx.user.id, [...recent, now]);
    const { code, record } = createLinkCode({ userId: String(ctx.user.id), now });
    await dbf.createWhatsappLinkCode(ctx.user.id, record.codeHash, record.salt, new Date(record.expiresAt));
    return { code, expiresAt: record.expiresAt, botNumber: getWhatsappEnv().botNumber };
  }),

  unlink: protectedProcedure.mutation(async ({ ctx }) => ({ success: await dbf.unlinkWhatsapp(ctx.user.id) })),

  updatePrefs: protectedProcedure
    .input(
      z.object({
        timezone: z.string().max(64).optional(),
        reminderHour: z.number().int().min(0).max(23).optional(),
        remindersEnabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.timezone !== undefined && !isValidTimezone(input.timezone)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown time zone. Use an IANA name such as Asia/Kolkata." });
      }
      if (!(await dbf.getWhatsappLinkByUser(ctx.user.id))) {
        throw new TRPCError({ code: "NOT_FOUND", message: "WhatsApp is not linked yet." });
      }
      await dbf.updateWhatsappPrefsByUser(ctx.user.id, input);
      return { success: true };
    }),
});
