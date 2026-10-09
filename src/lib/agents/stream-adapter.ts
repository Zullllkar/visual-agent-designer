/**
 * 事件流适配器
 * --------------------------------------------------------------
 * 将 LangGraph 的 streamEvents 事件适配为 Vibeboard WebSocket 事件。
 * 包括：run.started、message.delta、thinking.delta、tool.started、
 *       tool.completed、project.update、run.completed。
 */

import "server-only";

import type { StreamEvent } from "@langchain/core/tracers/log_stream";
import {
  extractChatInlineAnswerText,
  isChatInlineTool,
} from "@/lib/agents/chat-inline-tools";
import type { AgentContext } from "@/lib/agents/types";
import type { ProjectFile } from "@/lib/project/schema";
import type { ToolArtifact } from "@/lib/agents/chat-schema";
import { imageToolApprovalId } from "@/lib/agents/tools/generate-images-approval";

export interface WsEvent {
  type: string;
  data: unknown;
}

export async function* adaptStreamEvents(
  stream: AsyncIterable<StreamEvent>,
  runId: string,
  agentCtx?: AgentContext,
  threadId?: string,
): AsyncGenerator<WsEvent> {
  yield { type: "run.started", data: { runId, threadId: threadId ?? runId } };
  const streamedMessageIds = new Set<string>();
  const toolRunToCallId = new Map<string, string>();

  for await (const event of stream) {
    const evt = event.event;

    if (evt === "on_chain_stream") {
      for (const interrupt of extractInterrupts(event.data)) {
        const value = interrupt.value;
        if (isRecord(value) && value.toolName) {
          yield {
            type: "tool.confirm",
            data: {
              runId,
              checkpointInterruptId:
                typeof interrupt.id === "string" ? interrupt.id : undefined,
              ...value,
            },
          };
        }
      }
    }

    if (evt === "on_chat_model_stream") {
      const chunk = (event.data as {
        chunk?: {
          id?: string;
          content?: unknown;
          content_blocks?: unknown[];
          reasoning_content?: unknown;
          additional_kwargs?: Record<string, unknown>;
        };
      }).chunk;
      const content = chunk?.content;
      const rawBlocks = chunk?.content_blocks;
      const blocks = Array.isArray(rawBlocks)
        ? rawBlocks
        : Array.isArray(content)
          ? content
          : [];
      const reasoning =
        typeof chunk?.reasoning_content === "string"
          ? chunk.reasoning_content
          : typeof chunk?.additional_kwargs?.reasoning_content === "string"
            ? chunk.additional_kwargs.reasoning_content
            : "";

      if (reasoning) {
        yield { type: "thinking.delta", data: { text: reasoning, runId } };
      }

      const messageId = isRecord(chunk) && typeof chunk.id === "string" ? chunk.id : runId;
      if (typeof content === "string" && content.length > 0 && blocks.length === 0) {
        streamedMessageIds.add(messageId);
        yield { type: "message.delta", data: { text: content, runId } };
      }

      if (blocks.length > 0) {
        for (const block of blocks) {
          if (block && typeof block === "object") {
            const b = block as { type?: string; thinking?: string; text?: string; reasoning?: string };
            if (
              (b.type === "thinking" || b.type === "reasoning") &&
              typeof (b.thinking ?? b.reasoning) === "string" &&
              (b.thinking ?? b.reasoning)
            ) {
              yield {
                type: "thinking.delta",
                data: { text: b.thinking ?? b.reasoning, runId },
              };
            } else if (b.type === "text" && typeof b.text === "string" && b.text.length > 0) {
              streamedMessageIds.add(messageId);
              yield { type: "message.delta", data: { text: b.text, runId } };
            }
          }
        }
      }
    }

    if (evt === "on_chat_model_end") {
      const output = (event.data as { output?: unknown })?.output;
      if (isRecord(output)) {
        const messageId = typeof output.id === "string" ? output.id : runId;
        const content = output.content;
        if (!streamedMessageIds.has(messageId)) {
          if (typeof content === "string" && content.length > 0) {
            yield { type: "message.delta", data: { text: content, runId } };
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (isRecord(block) && typeof block.text === "string" && block.text.length > 0) {
                yield { type: "message.delta", data: { text: block.text, runId } };
              }
            }
          }
        }
      }
    }

    if (evt === "on_tool_start") {
      const data = event.data as { name?: string; input?: unknown };
      const toolName = event.name ?? data?.name ?? "unknown";
      // Chat-inline tools are promoted to assistant text on end — hide task chrome.
      if (isChatInlineTool(toolName)) {
        resolveToolCallId(event, toolRunToCallId);
        continue;
      }
      const toolCallId = resolveToolCallId(event, toolRunToCallId);
      yield {
        type: "tool.started",
        data: {
          runId,
          ...(toolCallId ? { toolCallId } : {}),
          toolName,
          args: data?.input,
        },
      };
    }

    if (evt === "on_tool_end") {
      const data = event.data as { name?: string; output?: unknown };
      const output = parseToolOutput(data?.output);
      const toolName = event.name ?? data?.name ?? "unknown";
      const toolCallId = resolveToolCallId(event, toolRunToCallId);

      if (isChatInlineTool(toolName)) {
        const answer =
          extractChatInlineAnswerText(output) ??
          (typeof output === "string" ? output : undefined);
        if (answer) {
          yield { type: "message.delta", data: { text: answer, runId } };
        }
        continue;
      }

      const artifacts = extractArtifacts(output);
      const outputSummary = extractSummary(output);
      const outputRecord = isRecord(output) ? output : undefined;

      if (agentCtx?.scratch?.__updatedProject) {
        const project = agentCtx.scratch.__updatedProject as ProjectFile;
        yield {
          type: "project.update",
          data: { runId, project },
        };
        delete agentCtx.scratch.__updatedProject;
      }

      yield {
        type: "tool.completed",
        data: {
          runId,
          ...(toolCallId ? { toolCallId } : {}),
          toolName,
          output,
          outputSummary,
          ok: outputRecord?.ok !== false,
          ...(artifacts.length > 0 ? { artifacts } : {}),
        },
      };

      const confirmation = agentCtx?.scratch?.__toolConfirmation as
        | {
            approvalId?: string;
            toolName?: string;
            [key: string]: unknown;
          }
        | undefined;
      const isImageToolConfirm =
        confirmation?.toolName === "generate_images" ||
        confirmation?.toolName === "generate_image_variants";
      if (confirmation) {
        yield {
          type: "tool.confirm",
          data: { runId, ...confirmation },
        };
        delete agentCtx!.scratch.__toolConfirmation;
      }

      // ask_discovery 工具完成时，发射结构化问题事件到前端
      if (toolName === "ask_discovery" && agentCtx?.scratch?.__discoveryQuestions) {
        const formData = agentCtx.scratch.__discoveryQuestions as {
          title: string;
          description?: string;
          questions: unknown[];
        };
        yield {
          type: "discovery.questions",
          data: { runId, ...formData },
        };
        delete agentCtx.scratch.__discoveryQuestions;
      }

      if (
        (toolName === "confirm_direction" || toolName === "adopt_asset_style") &&
        agentCtx?.scratch?.__directionConfirmation
      ) {
        const direction = agentCtx.scratch.__directionConfirmation;
        yield {
          type: "direction.confirm",
          data: { runId, ...direction },
        };
        delete agentCtx.scratch.__directionConfirmation;
      }

      if (toolName === "generate_images" && agentCtx?.scratch?.__imageGenerationConfirmation) {
        const confirmation = agentCtx.scratch.__imageGenerationConfirmation;
        if (!isImageToolConfirm) {
          yield {
            type: "image_generation.confirm",
            data: {
              runId,
              approvalId: imageToolApprovalId(runId, "generate_images"),
              ...confirmation,
            },
          };
        }
        delete agentCtx.scratch.__imageGenerationConfirmation;
      }

      if (toolName === "manipulate_canvas") {
        yield { type: "canvas.sync", data: { runId, projectId: agentCtx?.projectId } };
      }
    }
  }

  // 正式 Agent Run 由 agent-run-service 统一发送，避免重复；独立调用保留兼容事件。
  if (!agentCtx) {
    yield { type: "run.completed", data: { runId } };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseToolOutput(output: unknown): unknown {
  if (typeof output !== "string") return output;
  const trimmed = output.trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return output;
  }
}

function extractInterrupts(data: unknown): Array<{ id?: unknown; value?: unknown }> {
  const records: Record<string, unknown>[] = [];
  if (isRecord(data)) {
    records.push(data);
    if (isRecord(data.chunk)) records.push(data.chunk);
    if (isRecord(data.output)) records.push(data.output);
  }
  for (const record of records) {
    const interrupts = record.__interrupt__;
    if (Array.isArray(interrupts)) {
      return interrupts.filter(isRecord) as Array<{ id?: unknown; value?: unknown }>;
    }
  }
  return [];
}

function resolveToolCallId(
  event: StreamEvent,
  toolRunToCallId: Map<string, string>
): string | undefined {
  const runId = typeof event.run_id === "string" ? event.run_id : undefined;
  const candidate =
    findToolCallId(event.data) ??
    findToolCallId((event as unknown as { metadata?: unknown }).metadata) ??
    findToolCallId((event as unknown as { tags?: unknown }).tags);

  if (candidate) {
    if (runId) toolRunToCallId.set(runId, candidate);
    return candidate;
  }

  return runId ? toolRunToCallId.get(runId) ?? runId : undefined;
}

function findToolCallId(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findToolCallId(item);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;

  for (const key of ["tool_call_id", "toolCallId", "tool_callId"]) {
    const found = value[key];
    if (typeof found === "string" && found.length > 0) return found;
  }

  for (const key of ["tool_call", "lg_tool_call", "toolCall"]) {
    const found = value[key];
    if (isRecord(found) && typeof found.id === "string" && found.id.length > 0) {
      return found.id;
    }
  }

  const input = value.input;
  if (input) {
    const found = findToolCallId(input);
    if (found) return found;
  }

  const message = value.message;
  if (message) {
    const found = findToolCallId(message);
    if (found) return found;
  }

  return undefined;
}

function extractArtifacts(output: unknown): ToolArtifact[] {
  if (!output || typeof output !== "object") return [];
  const obj = output as Record<string, unknown>;
  if (Array.isArray(obj.artifacts)) {
    return obj.artifacts as ToolArtifact[];
  }
  if (obj.url && obj.mimeType && typeof obj.width === "number") {
    const mimeType = obj.mimeType as string;
    return [{
      type: mimeType.startsWith("video/") ? "video" : "image",
      url: obj.url as string,
      mimeType,
      width: obj.width as number,
      height: obj.height as number,
      ...(obj.title ? { title: obj.title as string } : {}),
      ...(obj.durationSeconds ? { durationSeconds: obj.durationSeconds as number } : {}),
    }];
  }
  if (Array.isArray(obj.images)) {
    return (obj.images as Record<string, unknown>[]).map((img) => ({
      type: "image" as const,
      url: img.url as string,
      mimeType: (img.mimeType as string) ?? "image/png",
      width: (img.width as number) ?? 0,
      height: (img.height as number) ?? 0,
      ...(img.title ? { title: img.title as string } : {}),
    }));
  }
  return [];
}

function extractSummary(output: unknown): string | undefined {
  if (!output || typeof output !== "object") return undefined;
  const obj = output as Record<string, unknown>;
  if (typeof obj.summary === "string") return obj.summary;
  if (typeof obj.message === "string") return obj.message;
  return undefined;
}
