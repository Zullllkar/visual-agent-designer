/**
 * LLM Tool Calling 类型
 * --------------------------------------------------------------
 * OpenAI 兼容服务的 function calling 抽象。
 *
 * @author：wangjunhua
 */

export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LlmChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface LlmGenerateWithToolsInput {
  system: string;
  messages: LlmChatMessage[];
  tools: LlmToolDefinition[];
}

export interface LlmGenerateWithToolsOutput {
  /** 模型在调用工具前的说明（部分模型放在 content 里） */
  thinking?: string;
  text?: string;
  toolCalls: LlmToolCall[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}
