import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./_core/env", () => ({ ENV: { forgeApiUrl: "https://forge.example", forgeApiKey: "", isProduction: false } }));
import { invokeLLM } from "./_core/llm";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
  vi.unstubAllGlobals();
});

describe("LLM credentials stay paired with their own endpoint", () => {
  it("never sends the OpenAI key to the Forge URL when only the Forge URL is configured", async () => {
    process.env.OPENAI_API_KEY = "sk-openai-secret";
    delete process.env.OPENAI_BASE_URL;
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "x", created: 1, model: "m", choices: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await invokeLLM({ messages: [{ role: "user", content: "hi" }] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain("forge.example");
    expect(String(url)).toBe("https://api.openai.com/v1/chat/completions");
    expect((init as RequestInit).headers).toMatchObject({ authorization: "Bearer sk-openai-secret" });
  });
});
