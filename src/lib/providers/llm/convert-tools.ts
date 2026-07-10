/**
 * 工具定义格式转换
 * --------------------------------------------------------------
 * 将统一 Orchestrator 工具定义转为各厂商 API 格式。
 *
 * @author：wangjunhua
 */

import type { LlmToolDefinition, LlmToolCall } from "./tool-types";

export function toOpenAiTools(tools: LlmToolDefinition[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

export function toAnthropicTools(tools: LlmToolDefinition[]) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

export function toGeminiTools(tools: LlmToolDefinition[]) {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    },
  ];
}

export function parseToolArgsJson(raw?: string | Record<string, unknown>): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function mapAnthropicToolCalls(
  content?: Array<{
    type: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
    text?: string;
  }>
): { thinking?: string; toolCalls: LlmToolCall[] } {
  const toolCalls: LlmToolCall[] = [];
  const textParts: string[] = [];
  for (const block of content ?? []) {
    if (block.type === "tool_use" && block.name) {
      toolCalls.push({
        id: block.id ?? `call_${toolCalls.length}`,
        name: block.name,
        arguments: block.input ?? {},
      });
    } else if (block.type === "text" && block.text) {
      textParts.push(block.text);
    }
  }
  return {
    thinking: textParts.join("\n").trim() || undefined,
    toolCalls,
  };
}

export function mapGeminiToolCalls(
  parts?: Array<{
    text?: string;
    functionCall?: { name?: string; args?: Record<string, unknown> };
  }>
): { thinking?: string; toolCalls: LlmToolCall[] } {
  const toolCalls: LlmToolCall[] = [];
  const textParts: string[] = [];
  for (const part of parts ?? []) {
    if (part.functionCall?.name) {
      toolCalls.push({
        id: `call_${toolCalls.length}`,
        name: part.functionCall.name,
        arguments: part.functionCall.args ?? {},
      });
    } else if (part.text) {
      textParts.push(part.text);
    }
  }
  return {
    thinking: textParts.join("\n").trim() || undefined,
    toolCalls,
  };
}
