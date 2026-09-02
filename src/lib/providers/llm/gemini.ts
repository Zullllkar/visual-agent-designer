import { safeFetch } from "@/lib/utils/fetch-client";
import type { LlmProvider } from "./types";
import { stripJsonFence } from "./openai-compatible";
import type { LlmGenerateWithToolsInput } from "./tool-types";
import { mapGeminiToolCalls, toGeminiTools } from "./convert-tools";

/**
 * Google Gemini Native Provider
 * --------------------------------------------------------------
 * 通过 https://generativelanguage.googleapis.com 直接调用 Gemini 1.5 Pro / Flash / Gemini 2.0
 *
 * 设计要点：
 *   - 纯 fetch 实现，无需引入 @google/generative-ai
 *   - 支持把 systemInstruction 作为顶层参数发送（符合 Gemini 规范）
 *   - 支持 inlineData Base64 视觉输入（Vision Critic）
 *   - 针对 JSON 模式（schema）自动应用 responseMimeType: "application/json"
 */

export interface GeminiConfig {
  baseURL?: string;
  apiKey: string;
  model: string;
}

export function createGeminiProvider(cfg: GeminiConfig): LlmProvider {
  const baseURL = cfg.baseURL || "https://generativelanguage.googleapis.com";
  const defaultModel = cfg.model || "gemini-1.5-flash";

  return {
    name: `gemini::${defaultModel}`,
    supportsToolCalling: true,
    async generateText({ system, prompt, schema, images, temperature, maxTokens }) {
      // Gemini 官方 API 端点格式：
      // POST https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=YOUR_API_KEY
      const cleanModel = defaultModel.replace(/^models\//, "");
      const url = `${joinURL(baseURL, `/v1beta/models/${cleanModel}:generateContent`)}?key=${cfg.apiKey}`;
      const wantJson = !!schema;

      const parts: any[] = [{ text: prompt }];
      let embeddedImages = 0;

      if (images && images.length > 0) {
        for (const img of images) {
          const parsed = parseDataUrl(img);
          if (parsed) {
            parts.push({
              inlineData: {
                mimeType: parsed.mediaType,
                data: parsed.base64,
              },
            });
            embeddedImages += 1;
          }
        }
      }
      if (images?.length && embeddedImages === 0) {
        throw new Error(
          "Gemini vision requires data:image URL; image was not embedded"
        );
      }

      const body: Record<string, unknown> = {
        contents: [
          {
            role: "user",
            parts,
          },
        ],
        systemInstruction: {
          parts: [{ text: system }],
        },
        generationConfig: {
          temperature: typeof temperature === "number" ? temperature : 0.4,
          ...(typeof maxTokens === "number" && maxTokens > 0
            ? { maxOutputTokens: maxTokens }
            : {}),
          ...(wantJson ? { responseMimeType: "application/json" } : {}),
        },
      };

      const res = await safeFetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Gemini HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      const data = (await res.json()) as GeminiMessageResponse;
      const choice = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const text = wantJson ? stripJsonFence(choice) : choice;

      return {
        text,
        usage: data.usageMetadata
          ? {
              inputTokens: data.usageMetadata.promptTokenCount ?? 0,
              outputTokens: data.usageMetadata.candidatesTokenCount ?? 0,
            }
          : undefined,
      };
    },

    async *generateTextStream({ system, prompt, images }) {
      const cleanModel = defaultModel.replace(/^models\//, "");
      const url = `${joinURL(
        baseURL,
        `/v1beta/models/${cleanModel}:streamGenerateContent`
      )}?key=${cfg.apiKey}&alt=sse`;

      const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
        { text: prompt },
      ];
      if (images?.length) {
        for (const img of images) {
          const parsed = parseDataUrl(img);
          if (parsed) {
            parts.push({
              inlineData: { mimeType: parsed.mediaType, data: parsed.base64 },
            });
          }
        }
      }

      const res = await safeFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          systemInstruction: { parts: [{ text: system }] },
          generationConfig: { temperature: 0.5 },
        }),
      });

      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const json = JSON.parse(payload) as GeminiMessageResponse;
            const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) yield text;
          } catch {
            /* ignore */
          }
        }
      }
    },

    async generateWithTools({ system, messages, tools }: LlmGenerateWithToolsInput) {
      const cleanModel = defaultModel.replace(/^models\//, "");
      const url = `${joinURL(baseURL, `/v1beta/models/${cleanModel}:generateContent`)}?key=${cfg.apiKey}`;

      const userText = messages.map((m) => `${m.role}: ${m.content}`).join("\n\n");
      const body: Record<string, unknown> = {
        contents: [{ role: "user", parts: [{ text: userText }] }],
        systemInstruction: { parts: [{ text: system }] },
        tools: toGeminiTools(tools),
        toolConfig: { functionCallingConfig: { mode: "AUTO" } },
        generationConfig: { temperature: 0.3 },
      };

      const res = await safeFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Gemini tools HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      const data = (await res.json()) as GeminiMessageResponse;
      const parts = data.candidates?.[0]?.content?.parts;
      const mapped = mapGeminiToolCalls(parts);
      return {
        thinking: mapped.thinking,
        toolCalls: mapped.toolCalls,
        usage: data.usageMetadata
          ? {
              inputTokens: data.usageMetadata.promptTokenCount ?? 0,
              outputTokens: data.usageMetadata.candidatesTokenCount ?? 0,
            }
          : undefined,
      };
    },
  };
}

interface GeminiMessageResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        functionCall?: { name?: string; args?: Record<string, unknown> };
      }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

function joinURL(base: string, path: string) {
  return base.replace(/\/+$/, "") + (path.startsWith("/") ? path : "/" + path);
}

function parseDataUrl(url: string): { mediaType: string; base64: string } | null {
  const match = url.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return { mediaType: match[1], base64: match[2] };
  }
  return null;
}
