import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./_core/env", () => ({ ENV: { forgeApiUrl: "", forgeApiKey: "forge-secret", isProduction: false } }));
import { invokeLLM } from "./_core/llm";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
  vi.unstubAllGlobals();
});

describe("LLM credentials stay paired with their own endpoint (Forge key only)", () => {
  it("never sends the Forge key to OPENAI_BASE_URL", async () => {
    delete process.env.OPENAI_API_KEY;
    process.env.OPENAI_BASE_URL = "http://localhost:11434/v1";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "x", created: 1, model: "m", choices: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await invokeLLM({ messages: [{ role: "user", content: "hi" }] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain("localhost");
    expect((init as RequestInit).headers).toMatchObject({ authorization: "Bearer forge-secret" });
  });
});
