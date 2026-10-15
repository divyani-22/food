import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import { configureTrustProxy } from "./lib/security";
import { registerWhatsappRoutes } from "./whatsappRuntime";
import { getWhatsappEnv } from "./whatsappConfig";
import { parseCommand } from "./whatsapp/commands";
import { OffCache } from "./lib/offClient";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("TRUST_PROXY survives WhatsApp route registration", () => {
  const stubDeps: any = {};
  for (const [value, expected] of [
    ["0", 0],
    ["loopback", "loopback"],
    ["2", 2],
    ["true", 1],
  ] as const) {
    it(`TRUST_PROXY=${value}`, () => {
      process.env.TRUST_PROXY = value;
      const app = express();
      configureTrustProxy(app); // index.ts does this first
      const before = app.get("trust proxy");
      registerWhatsappRoutes(app, stubDeps);
      expect(app.get("trust proxy")).toBe(before);
      expect(app.get("trust proxy")).toBe(expected);
    });
  }
});

describe("WHATSAPP_REMINDERS", () => {
  it("off / false / 0 / no disable the scheduler, anything else keeps it on", () => {
    for (const v of ["off", "OFF", "false", "False", "0", "no"]) {
      expect(getWhatsappEnv({ WHATSAPP_REMINDERS: v } as any).remindersEnabled, v).toBe(false);
    }
    for (const v of [undefined, "", "on", "true", "1"]) {
      expect(getWhatsappEnv({ WHATSAPP_REMINDERS: v } as any).remindersEnabled, String(v)).toBe(true);
    }
  });
});

describe("command separators", () => {
  it("accepts any whitespace (newline) between the command word and its argument", () => {
    expect(parseCommand("LINK\nABCD2345")).toEqual({ type: "link", code: "ABCD2345" });
    expect(parseCommand("link\r\nabcd 2345")).toEqual({ type: "link", code: "ABCD2345" });
    expect(parseCommand("REMIND\n8pm")).toMatchObject({ type: "remind", hour: 20 });
    expect(parseCommand("CLEAR\nmilk")).toEqual({ type: "clear", name: "milk" });
    expect(parseCommand("TZ\nAsia/Kolkata")).toEqual({ type: "tz", zone: "Asia/Kolkata" });
    expect(parseCommand("FRIDGE\n2")).toEqual({ type: "fridge", page: 2 });
  });
});

describe("OFF cache env parsing", () => {
  it("an empty OFF_CACHE_* variable means 'unset', not 0 (which would silently disable caching)", async () => {
    process.env.OFF_CACHE_HIT_TTL_SECONDS = "";
    process.env.OFF_CACHE_MAX_ENTRIES = "";
    process.env.NODE_ENV = "development";
    const { defaultCacheOptions } = await import("./lib/offClient");
    const o = defaultCacheOptions();
    expect(o.hitTtlMs).toBe(6 * 60 * 60 * 1000);
    expect(o.maxEntries).toBe(500);
    void OffCache;
  });
});

import { toTwilioAddress, toMetaAddress } from "./whatsapp/phone";
describe("Twilio addressing", () => {
  it("accepts the sender exactly as the Twilio console shows it (whatsapp:+...) without doubling the prefix", () => {
    expect(toTwilioAddress("+14155238886")).toBe("whatsapp:+14155238886");
    expect(toTwilioAddress("whatsapp:+14155238886")).toBe("whatsapp:+14155238886");
    expect(toTwilioAddress("WhatsApp:+1 415 523 8886")).toBe("whatsapp:+14155238886");
    expect(toTwilioAddress("14155238886")).toBe("whatsapp:+14155238886");
    expect(toMetaAddress("+14155238886")).toBe("14155238886");
  });
});

describe("alt-market cache env parsing", () => {
  it("an empty ALT_MARKET_CACHE_TTL_SECONDS keeps the default TTL", async () => {
    process.env.ALT_MARKET_CACHE_TTL_SECONDS = "";
    const { cacheDefaults } = await import("./lib/altMarket");
    expect(cacheDefaults().ttlMs).toBe(6 * 60 * 60 * 1000);
    process.env.ALT_MARKET_CACHE_TTL_SECONDS = "0";
    expect(cacheDefaults().ttlMs).toBe(0);
  });
});
