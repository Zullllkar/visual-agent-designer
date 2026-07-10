/**
 * LLM Provider 抽象
 * --------------------------------------------------------------
 * 支持纯文本生成与可选的 OpenAI 风格 tool calling。
 */

import type {
  LlmGenerateWithToolsInput,
  LlmGenerateWithToolsOutput,
} from "./tool-types";

export interface LlmGenerateInput {
  system: string;
  prompt: string;
  /** 期望的 JSON Schema，可选。 */
  schema?: unknown;
  /**
   * 视觉输入：data URL 或 http(s) URL 列表。
   * Provider 实现时若传了此字段，应以 OpenAI vision 风格的 multipart message
   * 发送（content blocks 含 {type:'text'} + 多个 {type:'image_url'}）。
   */
  images?: string[];
}

export interface LlmGenerateOutput {
  text: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface LlmProvider {
  name: string;
  /** 是否支持 OpenAI 兼容 function calling */
  supportsToolCalling?: boolean;
  generateText(input: LlmGenerateInput): Promise<LlmGenerateOutput>;
  /** 流式文本（编排思考等）；不支持时由调用方走非流式 */
  generateTextStream?(
    input: Omit<LlmGenerateInput, "schema">
  ): AsyncGenerator<string, void, unknown>;
  generateWithTools?(
    input: LlmGenerateWithToolsInput
  ): Promise<LlmGenerateWithToolsOutput>;
}
