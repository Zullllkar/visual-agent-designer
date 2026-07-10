import { fetchWithRetry } from "@/lib/providers/fetch-with-retry";
import type { LlmProvider } from "./types";
import type { LlmGenerateWithToolsInput } from "./tool-types";
import { parseToolArgsJson } from "./convert-tools";

/**
 * OpenAI 兼容 Provider
 * --------------------------------------------------------------
 * 通过 /v1/chat/completions 接口与下列服务对话：
 *   - OpenAI       (https://api.openai.com/v1)
 *   - DeepSeek     (https://api.deepseek.com/v1)
 *   - 通义千问     (https://dashscope.aliyuncs.com/compatible-mode/v1)
 *   - OpenRouter   (https://openrouter.ai/api/v1)
 *   - Ollama       (http://localhost:11434/v1)
 *   - vLLM 等任何兼容服务
 *
 * 设计要点：
 *   - 不引入 openai SDK，纯 fetch；保持服务器轻量
 *   - 支持 JSON Mode（response_format: { type: "json_object" }）
 *   - 自动剥离 markdown ```json 围栏，再交给上游 zod 校验
 */

export interface OpenAICompatibleConfig {
  baseURL: string;
  apiKey: string;
  model: string;
}

export function createOpenAICompatibleProvider(
  cfg: OpenAICompatibleConfig
): LlmProvider {
  return {
    name: `openai-compatible::${shortHost(cfg.baseURL)}::${cfg.model}`,
    supportsToolCalling: true,
    async generateText({ system, prompt, schema, images }) {
      const url = joinURL(cfg.baseURL, "/chat/completions");
      const wantJson = !!schema;

      // OpenAI Vision 风格的 user content：text + 多张图
      const userContent =
        images && images.length > 0
          ? [
              { type: "text", text: prompt },
              ...images.map((url) => ({
                type: "image_url",
                image_url: { url },
              })),
            ]
          : prompt;

      const body: Record<string, unknown> = {
        model: cfg.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent },
        ],
        temperature: 0.4,
      };
      if (wantJson) {
        // 多数兼容服务支持 json_object，少数只支持普通 text；
        // 失败时上游会用 stripJsonFence 兜底。
        body.response_format = { type: "json_object" };
      }

      const res = await fetchWithRetry(
        url,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${cfg.apiKey}`,
          },
          body: JSON.stringify(body),
        },
        { timeoutMs: 120_000, maxAttempts: 3 }
      );

      const data = (await res.json()) as ChatCompletionResponse;
      const choice = data.choices?.[0]?.message?.content ?? "";
      const text = wantJson ? stripJsonFence(choice) : choice;

      return {
        text,
        usage: data.usage
          ? {
              inputTokens: data.usage.prompt_tokens ?? 0,
              outputTokens: data.usage.completion_tokens ?? 0,
            }
          : undefined,
      };
    },

    async *generateTextStream({ system, prompt, images }) {
      const url = joinURL(cfg.baseURL, "/chat/completions");
      const userContent =
        images && images.length > 0
          ? [
              { type: "text", text: prompt },
              ...images.map((imgUrl) => ({
                type: "image_url",
                image_url: { url: imgUrl },
              })),
            ]
          : prompt;

      const res = await fetchWithRetry(
        url,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${cfg.apiKey}`,
          },
          body: JSON.stringify({
            model: cfg.model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: userContent },
            ],
            temperature: 0.5,
            stream: true,
          }),
        },
        { timeoutMs: 120_000, maxAttempts: 2 }
      );

      if (!res.body) return;
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
          if (payload === "[DONE]") return;
          try {
            const json = JSON.parse(payload) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) yield delta;
          } catch {
            /* ignore partial */
          }
        }
      }
    },

    async generateWithTools({ system, messages, tools }) {
      const url = joinURL(cfg.baseURL, "/chat/completions");
      const body: Record<string, unknown> = {
        model: cfg.model,
        messages: [
          { role: "system", content: system },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
        tools: tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })),
        tool_choice: "auto",
        temperature: 0.3,
      };

      const res = await fetchWithRetry(
        url,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${cfg.apiKey}`,
          },
          body: JSON.stringify(body),
        },
        { timeoutMs: 120_000, maxAttempts: 3 }
      );

      const data = (await res.json()) as ChatCompletionResponse;
      const msg = data.choices?.[0]?.message;
      const toolCalls = (msg?.tool_calls ?? []).map((tc) => ({
        id: tc.id ?? `call_${Math.random().toString(36).slice(2, 10)}`,
        name: tc.function?.name ?? "answer_question",
        arguments: parseToolArgsJson(tc.function?.arguments),
      }));

      return {
        thinking: msg?.content?.trim() || undefined,
        text: msg?.content?.trim() || undefined,
        toolCalls,
        usage: data.usage
          ? {
              inputTokens: data.usage.prompt_tokens ?? 0,
              outputTokens: data.usage.completion_tokens ?? 0,
            }
          : undefined,
      };
    },
  };
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

function joinURL(base: string, path: string) {
  return base.replace(/\/+$/, "") + (path.startsWith("/") ? path : "/" + path);
}

function shortHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "unknown";
  }
}

/** LLM 经常返回 ```json ... ```，提取 JSON 主体。 */
export function stripJsonFence(s: string): string {
  const trimmed = s.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) return fence[1].trim();
  return trimmed;
}
