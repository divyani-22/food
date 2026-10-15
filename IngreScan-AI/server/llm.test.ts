import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeLLM, LLMUnavailableError } from "./_core/llm";

const msgs = [{ role: "user" as const, content: "hello" }];
const env = { ...process.env };

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.BUILT_IN_FORGE_API_KEY;
  delete process.env.ALLOW_LOCAL_LLM_FALLBACK;
});

afterEach(() => {
  process.env = { ...env };
  vi.unstubAllGlobals();
});

describe("invokeLLM fallback policy", () => {
  it("uses the local engine without a key outside production", async () => {
    process.env.NODE_ENV = "development";
    const r = await invokeLLM({ messages: msgs });
    expect(r.model).toBe("local-nutrition-intelligence");
  });

  it("throws without a key in production", async () => {
    process.env.NODE_ENV = "production";
    await expect(invokeLLM({ messages: msgs })).rejects.toBeInstanceOf(LLMUnavailableError);
  });

  it("allows the local engine in production only when explicitly enabled", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_LOCAL_LLM_FALLBACK = "true";
    const r = await invokeLLM({ messages: msgs });
    expect(r.model).toBe("local-nutrition-intelligence");
  });

  it("throws (no fake analysis) when a configured API returns an error", async () => {
    process.env.NODE_ENV = "development";
    process.env.OPENAI_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 500 })));
    await expect(invokeLLM({ messages: msgs })).rejects.toBeInstanceOf(LLMUnavailableError);
  });

  it("throws on network errors when a key is configured", async () => {
    process.env.NODE_ENV = "development";
    process.env.OPENAI_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    await expect(invokeLLM({ messages: msgs })).rejects.toBeInstanceOf(LLMUnavailableError);
  });
});
