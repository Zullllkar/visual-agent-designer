import { describe, expect, it, vi, afterEach } from "vitest";
import { createOpenAICompatibleProvider } from "./openai-compatible";
import { createAnthropicProvider } from "./anthropic";
import { createGeminiProvider } from "./gemini";

const image = "data:image/png;base64,AA==";

afterEach(() => vi.unstubAllGlobals());

describe("vision provider wire integrations", () => {
  it("sends OpenAI compatible vision content and parses usage", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.messages[1].content).toEqual([
        { type: "image_url", image_url: { url: image, detail: "high" } },
        { type: "text", text: "review" },
      ]);
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"score":8}' } }],
        usage: { prompt_tokens: 12, completion_tokens: 4 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = createOpenAICompatibleProvider({ baseURL: "http://vision.test/v1", apiKey: "key", model: "vision-model" });
    const result = await provider.generateText({ system: "critic", prompt: "review", images: [image], imageDetail: "high", schema: {} });
    expect(result.text).toBe('{"score":8}');
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 4 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("embeds a data URL in the Anthropic vision request", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const content = body.messages[0].content;
      expect(content).toContainEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: "AA==" } });
      expect(content).toContainEqual({ type: "text", text: "review" });
      return new Response(JSON.stringify({ content: [{ type: "text", text: '{"score":9}' }], usage: { input_tokens: 8, output_tokens: 3 } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = createAnthropicProvider({ baseURL: "http://anthropic.test", apiKey: "key", model: "claude-vision" });
    const result = await provider.generateText({ system: "critic", prompt: "review", images: [image], schema: {} });
    expect(result.text).toBe('{"score":9}');
    expect(result.usage).toEqual({ inputTokens: 8, outputTokens: 3 });
  });

  it("maps a data URL to Gemini inlineData", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.contents[0].parts).toContainEqual({ inlineData: { mimeType: "image/png", data: "AA==" } });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"score":7}' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = createGeminiProvider({ baseURL: "http://gemini.test", apiKey: "key", model: "gemini-vision" });
    const result = await provider.generateText({ system: "critic", prompt: "review", images: [image], schema: {} });
    expect(result.text).toBe('{"score":7}');
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 2 });
  });

  const live = process.env.VAD_LIVE_PROVIDER_TESTS === "true";
  it.skipIf(!live)("can call a configured live OpenAI-compatible vision endpoint", async () => {
    const baseURL = process.env.VAD_VISION_BASE_URL;
    const apiKey = process.env.VAD_VISION_API_KEY;
    const model = process.env.VAD_VISION_MODEL;
    if (!baseURL || !apiKey || !model) throw new Error("Set VAD_VISION_BASE_URL, VAD_VISION_API_KEY and VAD_VISION_MODEL for live provider tests");
    const provider = createOpenAICompatibleProvider({ baseURL, apiKey, model });
    const result = await provider.generateText({ system: "Return JSON only with a score between 0 and 10.", prompt: "Score this one pixel image.", images: [image], imageDetail: "low", schema: {} });
    expect(result.text).toMatch(/score/i);
  }, 120_000);
});
