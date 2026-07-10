import { safeFetch } from "@/lib/utils/fetch-client";
import type { LlmProvider } from "./types";
import { stripJsonFence } from "./openai-compatible";
import type { LlmGenerateWithToolsInput } from "./tool-types";
import { mapAnthropicToolCalls, toAnthropicTools } from "./convert-tools";

/**
 * Anthropic (Claude) Native Provider
 * --------------------------------------------------------------
 * 通过 https://api.anthropic.com/v1/messages 直接调用 Claude 3.5 Sonnet / Haiku
 *
 * 设计要点：
 *   - 纯 fetch 实现，无需引入 @anthropic-ai/sdk
 *   - 支持把 system prompt 作为顶层参数发送（符合 Anthropic 规范）
 *   - 支持多模态 Base64 视觉输入（Vision Critic）
 */

export interface AnthropicConfig {
  baseURL?: string;
  apiKey: string;
  model: string;
}

export function createAnthropicProvider(cfg: AnthropicConfig): LlmProvider {
  const baseURL = cfg.baseURL || "https://api.anthropic.com";
  const defaultModel = cfg.model || "claude-3-5-sonnet-20241022";

  return {
    name: `anthropic::${defaultModel}`,
    supportsToolCalling: true,
    async generateText({ system, prompt, schema, images }) {
      const url = joinURL(baseURL, "/v1/messages");
      const wantJson = !!schema;

      // 组装 content 块（Anthropic 图像只能是 base64 形式，且需拆解 media_type 和 raw base64）
      let userContent: unknown;
      if (images && images.length > 0) {
        const blocks: any[] = [{ type: "text", text: prompt }];
        for (const img of images) {
          const parsed = parseDataUrl(img);
          if (parsed) {
            blocks.push({
              type: "image",
              source: {
                type: "base64",
                media_type: parsed.mediaType,
                data: parsed.base64,
              },
            });
          }
        }
        userContent = blocks;
      } else {
        userContent = prompt;
      }

      const body: Record<string, unknown> = {
        model: defaultModel,
        system, // Anthropic 系统提示词在根节点
        messages: [{ role: "user", content: userContent }],
        max_tokens: 4096,
        temperature: 0.4,
      };

      const res = await safeFetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": cfg.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Anthropic HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      const data = (await res.json()) as AnthropicMessageResponse;
      const choice = data.content?.[0]?.text ?? "";
      const text = wantJson ? stripJsonFence(choice) : choice;

      return {
        text,
        usage: data.usage
          ? {
              inputTokens: data.usage.input_tokens ?? 0,
              outputTokens: data.usage.output_tokens ?? 0,
            }
          : undefined,
      };
    },

    async *generateTextStream({ system, prompt, images }) {
      const url = joinURL(baseURL, "/v1/messages");
      let userContent: unknown;
      if (images && images.length > 0) {
        const blocks: Array<{ type: string; text?: string; source?: unknown }> = [
          { type: "text", text: prompt },
        ];
        for (const img of images) {
          const parsed = parseDataUrl(img);
          if (parsed) {
            blocks.push({
              type: "image",
              source: {
                type: "base64",
                media_type: parsed.mediaType,
                data: parsed.base64,
              },
            });
          }
        }
        userContent = blocks;
      } else {
        userContent = prompt;
      }

      const res = await safeFetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": cfg.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: defaultModel,
          system,
          messages: [{ role: "user", content: userContent }],
          max_tokens: 2048,
          temperature: 0.5,
          stream: true,
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
          if (!payload) continue;
          try {
            const json = JSON.parse(payload) as {
              type?: string;
              delta?: { type?: string; text?: string };
            };
            const text = json.delta?.text;
            if (
              text &&
              (json.type === "content_block_delta" ||
                json.delta?.type === "text_delta")
            ) {
              yield text;
            }
          } catch {
            /* ignore */
          }
        }
      }
    },

    async generateWithTools({ system, messages, tools }: LlmGenerateWithToolsInput) {
      const url = joinURL(baseURL, "/v1/messages");
      const body: Record<string, unknown> = {
        model: defaultModel,
        system,
        messages: messages.map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        })),
        tools: toAnthropicTools(tools),
        tool_choice: { type: "auto" },
        max_tokens: 4096,
        temperature: 0.3,
      };

      const res = await safeFetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": cfg.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Anthropic tools HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      const data = (await res.json()) as AnthropicMessageResponse;
      const mapped = mapAnthropicToolCalls(data.content);
      return {
        thinking: mapped.thinking,
        toolCalls: mapped.toolCalls,
        usage: data.usage
          ? {
              inputTokens: data.usage.input_tokens ?? 0,
              outputTokens: data.usage.output_tokens ?? 0,
            }
          : undefined,
      };
    },
  };
}

interface AnthropicMessageResponse {
  content?: Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
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
