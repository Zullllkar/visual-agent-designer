/**
 * 将 Chat 消息 + SSE 实时事件合并为 Cursor 风格时间线
 * --------------------------------------------------------------
 * @author：wangjunhua
 */

import type { ChatMessage, ToolCall } from "@/lib/agents/chat-schema";
import type { PipelineLogEntry } from "@/lib/agents/pipeline-logger";
import type { ChatLiveEvent } from "./chat-live-event";

export type TimelineItem =
  | {
      kind: "user";
      id: string;
      content: string;
      createdAt?: string;
    }
  | {
      kind: "thought";
      id: string;
      content: string;
      streaming: boolean;
      startedAt: number;
      durationMs?: number;
    }
  | {
      kind: "activity";
      id: string;
      text: string;
    }
  | {
      kind: "agent_plan";
      id: string;
      thinking?: string;
      steps: Array<{
        id: string;
        name: ToolCall["name"];
        label: string;
        status: "waiting" | "running" | "done" | "error";
        args?: Record<string, unknown>;
        summary?: string;
        startedAt?: number;
        durationMs?: number;
      }>;
    }
  | {
      kind: "tool";
      id: string;
      name: ToolCall["name"];
      label: string;
      status: "running" | "done" | "error";
      args?: Record<string, unknown>;
      summary?: string;
      ok?: boolean;
      startedAt: number;
      durationMs?: number;
    }
  | {
      kind: "file";
      id: string;
      path: string;
      at: number;
    }
  | {
      kind: "assistant";
      id: string;
      content: string;
      streaming: boolean;
    }
  | {
      kind: "handoff";
      id: string;
      target: string;
      fileCount: number;
    }
  | {
      kind: "error";
      id: string;
      message: string;
    }
  | {
      kind: "pipeline_log";
      id: string;
      entry: PipelineLogEntry;
    }
  | {
      kind: "code_diff";
      id: string;
      path: string;
      language?: string;
      oldText?: string;
      newText?: string;
      summary?: string;
      toolCallId?: string;
      diffId?: string;
    };

const TOOL_LABEL: Record<ToolCall["name"], string> = {
  generate_brief: "分析设计需求",
  plan_architecture: "（已跳过）信息架构",
  plan_design_direction: "定义视觉方向",
  generate_layout: "（已跳过）页面结构",
  polish_content: "（已跳过）文案润色",
  generate_images: "生成视觉素材",
  generate_image_variants: "生成素材变体",
  restyle_page_images: "统一素材风格",
  edit_page: "（已跳过）页面编辑",
  export_handoff: "编译素材交付包",
  critique_pages: "（已跳过）页面评审",
  repair_page: "（已跳过）页面修复",
  answer_question: "回答问题",
};

export function toolDisplayLabel(name: ToolCall["name"]): string {
  return TOOL_LABEL[name] ?? name;
}

function chunkThinking(text: string, maxLen = 48): string[] {
  if (!text) return [];
  const parts: string[] = [];
  let i = 0;
  while (i < text.length) {
    parts.push(text.slice(i, i + maxLen));
    i += maxLen;
  }
  return parts;
}

/** 服务端可把长 thinking 拆成多帧，便于流式展示 */
export function emitThinkingChunks(thinking: string): { text: string }[] {
  if (thinking.length <= 120) return [{ text: thinking }];
  const byLine = thinking.split(/(?<=[。！？\n])/);
  const out: { text: string }[] = [];
  for (const line of byLine) {
    if (!line) continue;
    for (const c of chunkThinking(line, 64)) {
      out.push({ text: c });
    }
  }
  return out.length ? out : [{ text: thinking }];
}

/**
 * 历史消息 → 时间线条目（不含本轮未落库的 live 事件）
 */
export function messagesToTimeline(messages: ChatMessage[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const m of messages) {
    if (m.role === "user" && m.content) {
      items.push({
        kind: "user",
        id: m.id,
        content: m.content,
        createdAt: m.createdAt,
      });
    } else if (m.role === "assistant" && m.content) {
      if (m.content.startsWith("💭 ")) {
        items.push({
          kind: "thought",
          id: m.id,
          content: m.content.slice(2).trim(),
          streaming: false,
          startedAt: new Date(m.createdAt).getTime(),
        });
      } else {
        items.push({
          kind: "assistant",
          id: m.id,
          content: m.content,
          streaming: false,
        });
      }
    } else if (m.role === "tool" && m.toolCall) {
      items.push({
        kind: "tool",
        id: m.toolCall.id,
        name: m.toolCall.name,
        label: toolDisplayLabel(m.toolCall.name),
        status: m.toolResult?.ok === false ? "error" : "done",
        args: m.toolCall.args,
        summary: m.toolResult?.summary,
        ok: m.toolResult?.ok,
        startedAt: new Date(m.createdAt).getTime(),
      });
    }
  }
  return items;
}

/**
 * 在历史时间线末尾合并本轮 SSE 事件（流式进行中）
 */
export function appendLiveEvents(
  base: TimelineItem[],
  events: ChatLiveEvent[],
  isStreaming: boolean
): TimelineItem[] {
  const items = [...base];
  const thoughtIds = new Map<string, string>();
  const toolMap = new Map<string, TimelineItem & { kind: "tool" }>();
  let activePlanId: string | null = null;
  const assistantId = "live-assistant";
  let assistantText = "";
  const updatePlanStep = (
    toolId: string,
    patch: Partial<Extract<TimelineItem, { kind: "agent_plan" }>["steps"][number]>
  ) => {
    const planIdx = activePlanId
      ? items.findIndex((x) => x.kind === "agent_plan" && x.id === activePlanId)
      : findLastIndex(items, (x) => x.kind === "agent_plan");
    if (planIdx < 0 || items[planIdx].kind !== "agent_plan") return;
    const plan = items[planIdx] as Extract<TimelineItem, { kind: "agent_plan" }>;
    items[planIdx] = {
      ...plan,
      steps: plan.steps.map((step) =>
        step.id === toolId ? { ...step, ...patch } : step
      ),
    };
  };
  const ensureThought = (at: number): string => {
    const existing = [...thoughtIds.entries()].find(([, tid]) => {
      const t = items.find((x) => x.id === tid);
      return t?.kind === "thought" && (t as { streaming?: boolean }).streaming;
    });
    if (existing) return existing[1];
    const id = `thought-${at}`;
    items.push({
      kind: "thought",
      id,
      content: "",
      streaming: true,
      startedAt: at,
    });
    thoughtIds.set("current", id);
    return id;
  };

  for (const ev of events) {
    if (ev.type === "thinking") {
      const text = String((ev.data as { text?: string })?.text ?? "");
      if (!text) continue;
      const tid = ensureThought(ev.at);
      const idx = items.findIndex((x) => x.id === tid);
      if (idx >= 0 && items[idx].kind === "thought") {
        const prev = items[idx] as Extract<TimelineItem, { kind: "thought" }>;
        items[idx] = {
          ...prev,
          content: prev.content + text,
          streaming: isStreaming,
        };
      }
    } else if (ev.type === "agent_plan") {
      const d = ev.data as { thinking?: string; tools?: ToolCall[] };
      const tools = d.tools ?? [];
      if (tools.length === 0) continue;
      const id = `agent-plan-${ev.at}`;
      activePlanId = id;
      items.push({
        kind: "agent_plan",
        id,
        thinking: d.thinking,
        steps: tools.map((tool) => ({
          id: tool.id,
          name: tool.name,
          label: toolDisplayLabel(tool.name),
          status: "waiting",
          args: tool.args,
        })),
      });
    } else if (ev.type === "tool_call") {
      const d = ev.data as {
        id: string;
        name: ToolCall["name"];
        args?: Record<string, unknown>;
      };
      updatePlanStep(d.id, {
        status: "running",
        startedAt: ev.at,
        args: d.args,
      });
      if (items.some((x) => x.kind === "tool" && x.id === d.id)) continue;
      const toolItem: TimelineItem = {
        kind: "tool",
        id: d.id,
        name: d.name,
        label: toolDisplayLabel(d.name),
        status: "running",
        args: d.args,
        startedAt: ev.at,
      };
      toolMap.set(d.id, toolItem as TimelineItem & { kind: "tool" });
      items.push(toolItem);
    } else if (ev.type === "tool_result") {
      const d = ev.data as {
        id: string;
        ok: boolean;
        summary?: string;
        data?: unknown;
      };
      const idx = items.findIndex(
        (x) => x.kind === "tool" && x.id === d.id
      );
      let durationMs: number | undefined;
      if (idx >= 0 && items[idx].kind === "tool") {
        const prev = items[idx];
        durationMs = ev.at - prev.startedAt;
        items[idx] = {
          ...prev,
          status: d.ok ? "done" : "error",
          summary: d.summary,
          ok: d.ok,
          durationMs,
        };
      }
      updatePlanStep(d.id, {
        status: d.ok ? "done" : "error",
        summary: d.summary,
        durationMs,
      });
      toolMap.delete(d.id);
    } else if (ev.type === "file_write") {
      const path = String((ev.data as { path?: string })?.path ?? "");
      if (path) {
        items.push({
          kind: "file",
          id: `file-${ev.at}-${path}`,
          path,
          at: ev.at,
        });
      }
    } else if (ev.type === "assistant_text") {
      const text = String((ev.data as { text?: string })?.text ?? "");
      assistantText = assistantText ? `${assistantText}\n\n${text}` : text;
    } else if (ev.type === "handoff_download") {
      const d = ev.data as { target?: string; fileCount?: number };
      items.push({
        kind: "handoff",
        id: `handoff-${ev.at}`,
        target: d.target ?? "markdown",
        fileCount: d.fileCount ?? 0,
      });
    } else if (ev.type === "error") {
      items.push({
        kind: "error",
        id: `err-${ev.at}`,
        message: String((ev.data as { message?: string })?.message ?? "未知错误"),
      });
    } else if (ev.type === "pipeline_log") {
      const entry = ev.data as PipelineLogEntry;
      if (entry?.id) {
        items.push({
          kind: "pipeline_log",
          id: `plog-${entry.id}-${ev.at}`,
          entry,
        });
      }
    } else if (ev.type === "code_diff") {
      const d = ev.data as {
        path?: string;
        language?: string;
        oldText?: string;
        newText?: string;
        summary?: string;
        toolCallId?: string;
        diffId?: string;
      };
      if (d.path) {
        items.push({
          kind: "code_diff",
          id: d.diffId ?? `diff-${ev.at}-${d.path}`,
          path: d.path,
          language: d.language,
          oldText: d.oldText,
          newText: d.newText,
          summary: d.summary,
          toolCallId: d.toolCallId,
          diffId: d.diffId,
        });
      }
    }
  }

  // 关闭进行中的 thought 流
  for (const item of items) {
    if (item.kind === "thought" && item.streaming && !isStreaming) {
      item.streaming = false;
      if (item.startedAt) {
        item.durationMs = Date.now() - item.startedAt;
      }
    }
  }

  if (assistantText) {
    const alreadyPersisted = items.some(
      (x) =>
        x.kind === "assistant" &&
        x.id !== assistantId &&
        x.content.trim() === assistantText.trim()
    );
    const existingIdx = items.findIndex(
      (x) => x.kind === "assistant" && x.id === assistantId
    );
    const block: TimelineItem = {
      kind: "assistant",
      id: assistantId,
      content: assistantText,
      streaming: isStreaming,
    };
    if (alreadyPersisted) {
      if (existingIdx >= 0) items.splice(existingIdx, 1);
    } else if (existingIdx >= 0) items[existingIdx] = block;
    else items.push(block);
  }

  return items;
}

function findLastIndex<T>(items: T[], pred: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (pred(items[i])) return i;
  }
  return -1;
}

export function buildChatTimeline(
  messages: ChatMessage[],
  liveEvents: ChatLiveEvent[],
  isStreaming: boolean
): TimelineItem[] {
  const base = messagesToTimeline(messages);
  if (liveEvents.length === 0) return base;
  return appendLiveEvents(base, liveEvents, isStreaming);
}
