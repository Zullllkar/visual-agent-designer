/**
 * 灏?Chat 娑堟伅 + SSE 瀹炴椂浜嬩欢鍚堝苟涓?Cursor 椋庢牸鏃堕棿绾?
 * --------------------------------------------------------------
 * @author锛歸angjunhua
 */

import type { ChatMessage, ToolCall } from "@/lib/agents/chat-schema";
import {
  extractChatInlineAnswerText,
  isChatInlineTool,
} from "@/lib/agents/chat-inline-tools";
import type { PipelineLogEntry } from "@/lib/agents/pipeline-logger";
import { isChatTechnicalNoise } from "./chat-content-noise";
import { formatChatValue } from "./format-chat-value";
import type { ChatLiveEvent } from "./chat-live-event";
import {
  isThoughtMessageContent,
  stripThoughtMessagePrefix,
} from "./thought-message";

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
      tone?: "info" | "warning";
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
      output?: unknown;
      artifacts?: Array<{ type?: string; url?: string; title?: string; mimeType?: string }>;
      ok?: boolean;
      startedAt: number;
      durationMs?: number;
    }
  | {
      kind: "job";
      id: string;
      jobId: string;
      jobType: string;
      batchId?: string;
      toolCallId?: string;
      /** mockup / 源图 assetId（拆解、生图关联） */
      assetId?: string;
      status: "queued" | "running" | "completed" | "failed" | "cancelled";
      progress: number;
      completed: number;
      failed: number;
      total: number;
      stage?: string;
      message?: string;
      error?: string;
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
      /** 连续 pipeline_log 折叠后的摘要块（默认一行，可展开） */
      kind: "pipeline_logs";
      id: string;
      entries: PipelineLogEntry[];
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
    }
  | {
      kind: "discovery";
      id: string;
      title: string;
      description?: string;
      questions: Array<{
        id: string;
        label: string;
        type: "radio" | "checkbox" | "text" | "textarea";
        required?: boolean;
        options?: string[];
        optionLabels?: Record<string, string>;
        default?: string | string[];
        maxSelections?: number;
        placeholder?: string;
      }>;
      answered: boolean;
    }
  | {
      kind: "direction";
      id: string;
      title: string;
      summary: string;
      tone?: string;
      palette?: string;
      typography?: string;
      imageStyle?: string;
      confirmed: boolean;
    }
  | {
      kind: "image_confirm";
      id: string;
      title: string;
      prompt: string;
      /** 多类型时每条不同提示词 */
      prompts?: string[];
      reason: string;
      count: number;
      width: number;
      height: number;
      role?: string;
      confirmed: boolean;
    }
  | {
      kind: "tool_confirm";
      id: string;
      title: string;
      runId?: string;
      approvalId?: string;
      toolName: string;
      toolCallId?: string;
      riskLevel: "safe" | "moderate" | "destructive";
      args?: Record<string, unknown>;
      reason: string;
      confirmed: boolean;
    };

export interface TimelineTurn {
  id: string;
  user?: Extract<TimelineItem, { kind: "user" }>;
  items: TimelineItem[];
  status: "running" | "waiting" | "failed" | "cancelled" | "completed" | "idle";
  title: string;
  startedAt?: number;
  counts: {
    tools: number;
    jobs: number;
    files: number;
    changes: number;
    errors: number;
  };
}

const TOOL_LABEL: Record<ToolCall["name"], string> = {
  generate_brief: "Analyze brief",
  plan_architecture: "Skip architecture",
  plan_design_direction: "Define visual direction",
  generate_layout: "Skip layout",
  polish_content: "Skip content polish",
  generate_images: "Generate visual assets",
  generate_image_variants: "Generate asset variants",
  restyle_page_images: "Restyle page images",
  edit_page: "Edit page",
  export_handoff: "Export handoff",
  materialize_mockup: "拆解方案",
  materialize_slots: "拆成素材",
  critique_pages: "Review pages",
  repair_page: "Repair page",
  answer_question: "Answer question",
  inspect_canvas: "Inspect canvas",
  manipulate_canvas: "Edit canvas",
  star_asset: "Star asset",
  batch_delete_assets: "Delete assets",
  delegate_task: "Delegate task",
  screenshot_canvas: "Capture canvas",
  brand_kit: "Brand kit",
  file_system: "File system",
  persist_sandbox_file: "Persist file",
  execute: "Execute code",
  generate_video: "Generate video",
  job_status: "Job status",
  ask_discovery: "Ask discovery",
  confirm_direction: "Confirm direction",
  adopt_asset_style: "Adopt picture style",
};

export function toolDisplayLabel(name: ToolCall["name"]): string {
  return TOOL_LABEL[name] ?? name;
}

function normalizeTimelineText(text: string): string {
  if (!text.includes("LangGraph Agent")) return text;
  return text.replace(
    /[^\n]*LangGraph Agent[^\n]*(?:\n|$)/g,
    "\nLLM \u8bf7\u6c42\u4e0d\u53ef\u7528\uff0c\u5df2\u5207\u6362\u5230\u672c\u5730\u89c4\u5219\u6d41\u7a0b\u7ee7\u7eed\u6267\u884c\u3002\n"
  );
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

/** 鏈嶅姟绔彲鎶婇暱 thinking 鎷嗘垚澶氬抚锛屼究浜庢祦寮忓睍绀?*/
export function emitThinkingChunks(thinking: string): { text: string }[] {
  if (thinking.length <= 120) return [{ text: thinking }];
  const byLine = thinking.split(/(?<=[銆傦紒锛焅n])/);
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
 * 鍘嗗彶娑堟伅 鈫?鏃堕棿绾挎潯鐩紙涓嶅惈鏈疆鏈惤搴撶殑 live 浜嬩欢锛?
 */
export function messagesToTimeline(messages: ChatMessage[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const m of messages) {
    if (m.role === "user" && m.content) {
      items.push({
        kind: "user",
        id: m.id,
        content: normalizeTimelineText(formatChatValue(m.content)),
        createdAt: m.createdAt,
      });
    } else if (m.role === "assistant" && m.content) {
      if (isThoughtMessageContent(m.content)) {
        const thought = normalizeTimelineText(
          formatChatValue(stripThoughtMessagePrefix(m.content))
        );
        if (!thought.trim() || isChatTechnicalNoise(thought)) continue;
        items.push({
          kind: "thought",
          id: m.id,
          content: thought,
          streaming: false,
          startedAt: new Date(m.createdAt).getTime(),
        });
      } else {
        const content = normalizeTimelineText(formatChatValue(m.content));
        if (!content.trim() || isChatTechnicalNoise(content)) continue;
        const confirmation = imageConfirmationFromAssistantText(m.id, content);
        items.push(
          confirmation ?? {
            kind: "assistant",
            id: m.id,
            content,
            streaming: false,
          }
        );
      }
    } else if (m.role === "tool" && m.toolCall) {
      // 历史 answer_question 结果提升为助手气泡，避免再显示任务卡
      if (
        isChatInlineTool(m.toolCall.name) &&
        m.toolResult?.ok !== false
      ) {
        const answer =
          (m.toolResult?.summary
            ? formatChatValue(m.toolResult.summary)
            : undefined) ??
          extractChatInlineAnswerText(m.toolResult?.data);
        if (answer) {
          items.push({
            kind: "assistant",
            id: m.id,
            content: normalizeTimelineText(answer),
            streaming: false,
          });
          continue;
        }
      }
      items.push({
        kind: "tool",
        id: m.toolCall.id,
        name: m.toolCall.name,
        label: toolDisplayLabel(m.toolCall.name),
        status: m.toolResult?.ok === false ? "error" : "done",
        args: m.toolCall.args,
        summary: m.toolResult?.summary
          ? formatChatValue(m.toolResult.summary)
          : undefined,
        output: m.toolResult?.data,
        ok: m.toolResult?.ok,
        startedAt: new Date(m.createdAt).getTime(),
      });
    }
  }
  return items;
}

/**
 * 鍦ㄥ巻鍙叉椂闂寸嚎鏈熬鍚堝苟鏈疆 SSE 浜嬩欢锛堟祦寮忚繘琛屼腑锛?
 */
export function appendLiveEvents(
  base: TimelineItem[],
  events: ChatLiveEvent[],
  isStreaming: boolean
): TimelineItem[] {
  const items = [...base];
  const thoughtIds = new Map<string, string>();
  const toolMap = new Map<string, TimelineItem & { kind: "tool" }>();
  const jobMap = new Map<string, number>();
  const resolvedApprovals = collectResolvedToolApprovals(events);
  const visibleApprovalKeys = new Set<string>();
  let activePlanId: string | null = null;
  const assistantId = "live-assistant";
  let assistantText = "";
  const pushError = (id: string, message: string) => {
    const normalized = normalizeErrorMessage(message);
    if (!normalized) return;
    const duplicate = findLastIndex(
      items,
      (item) =>
        item.kind === "error" &&
        normalizeErrorMessage(item.message) === normalized
    );
    if (duplicate >= 0) return;
    items.push({ kind: "error", id, message });
  };
  const updatePlanStep = (
    toolId: string,
    toolName: ToolCall["name"] | undefined,
    patch: Partial<Extract<TimelineItem, { kind: "agent_plan" }>["steps"][number]>
  ) => {
    const planIdx = activePlanId
      ? items.findIndex((x) => x.kind === "agent_plan" && x.id === activePlanId)
      : findLastIndex(items, (x) => x.kind === "agent_plan");
    if (planIdx < 0 || items[planIdx].kind !== "agent_plan") return;
    const plan = items[planIdx] as Extract<TimelineItem, { kind: "agent_plan" }>;
    let matched = false;
    const steps = plan.steps.map((step) => {
      if (step.id === toolId || (toolName && !matched && step.name === toolName && step.status !== "done" && step.status !== "error")) {
        matched = true;
        return { ...step, ...patch };
      }
      return step;
    });
    items[planIdx] = { ...plan, steps };
  };
  const ensureThought = (at: number, eventId: string): string => {
    const existing = [...thoughtIds.entries()].find(([, tid]) => {
      const t = items.find((x) => x.id === tid);
      return t?.kind === "thought" && (t as { streaming?: boolean }).streaming;
    });
    if (existing) return existing[1];
    const id = `thought-${eventId}`;
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

  const seenEventIds = new Set<string>();
  for (const [eventIndex, ev] of events.entries()) {
    const eventId = ev.id ?? `${ev.type}:${ev.at}:${eventIndex}`;
    if (seenEventIds.has(eventId)) continue;
    seenEventIds.add(eventId);
    if (ev.type === "thinking") {
      const text = normalizeTimelineText(formatChatValue((ev.data as { text?: unknown })?.text));
      if (!text) continue;
      const tid = ensureThought(ev.at, eventId);
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
      const id = `agent-plan-${eventId}`;
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
    } else if (ev.type === "run.cancelling") {
      items.push({
        kind: "activity",
        id: `cancelling-${eventId}`,
        text: "Cancelling run...",
      });
    } else if (ev.type === "run.waiting_user") {
      const runningIndexes = items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.kind === "tool" && item.status === "running");
      for (const { item, index } of runningIndexes) {
        if (item.kind !== "tool") continue;
        items[index] = {
          ...item,
          status: "done",
          ok: true,
          summary: "Waiting for user input",
          durationMs: Math.max(0, ev.at - item.startedAt),
        };
        updatePlanStep(item.id, item.name, {
          status: "done",
          summary: "Waiting for user input",
          durationMs: items[index].kind === "tool" ? items[index].durationMs : undefined,
        });
      }
    } else if (
      ev.type === "run.failed" ||
      ev.type === "run.cancelled" ||
      ev.type === "run.interrupted"
    ) {
      const failed = ev.type === "run.failed" || ev.type === "run.interrupted";
      const failure = ev.data as { error?: string };
      const runningIndexes = items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.kind === "tool" && item.status === "running");
      for (const { item, index } of runningIndexes) {
        if (item.kind !== "tool") continue;
        items[index] = {
          ...item,
          status: failed ? "error" : "done",
          ok: !failed,
          summary: failed ? "Failed" : "Cancelled",
          durationMs: Math.max(0, ev.at - item.startedAt),
        };
        updatePlanStep(item.id, item.name, {
          status: failed ? "error" : "done",
          summary: items[index].kind === "tool" ? items[index].summary : undefined,
          durationMs: items[index].kind === "tool" ? items[index].durationMs : undefined,
        });
      }
      if (failed) {
        items.push({
          kind: "error",
          id: `err-${eventId}`,
          message: failure.error ?? "Agent run failed",
        });
      } else {
        items.push({
          kind: "activity",
          id: `cancelled-${eventId}`,
          text: "Run cancelled.",
        });
      }
    } else if (ev.type.startsWith("job.")) {
      const data = ev.data as {
        jobId?: string;
        jobType?: string;
        batchId?: string;
        toolCallId?: string;
        assetId?: string;
        progress?: number;
        error?: string;
        result?: { mockupAssetId?: string; assetId?: string };
        detail?: {
          stage?: string;
          completed?: number;
          failed?: number;
          total?: number;
          message?: string;
        };
      };
      if (!data.jobId) continue;
      const id = `job-${data.jobId}`;
      let idx = jobMap.get(data.jobId) ?? items.findIndex((item) => item.id === id);
      const previous: Extract<TimelineItem, { kind: "job" }> | undefined =
        idx >= 0 && items[idx]?.kind === "job"
          ? (items[idx] as Extract<TimelineItem, { kind: "job" }>)
          : undefined;
      const status = ev.type === "job.completed"
        ? "completed"
        : ev.type === "job.failed"
          ? "failed"
          : ev.type === "job.cancelled"
            ? "cancelled"
            : ev.type === "job.queued"
              ? "queued"
              : "running";
      const resultAssetId =
        typeof data.result?.mockupAssetId === "string"
          ? data.result.mockupAssetId
          : typeof data.result?.assetId === "string"
            ? data.result.assetId
            : undefined;
      const next: Extract<TimelineItem, { kind: "job" }> = {
        kind: "job",
        id,
        jobId: data.jobId,
        jobType: data.jobType ?? previous?.jobType ?? "custom",
        batchId: data.batchId ?? previous?.batchId,
        toolCallId: data.toolCallId ?? previous?.toolCallId,
        assetId: data.assetId ?? resultAssetId ?? previous?.assetId,
        status,
        progress: data.progress ?? previous?.progress ?? 0,
        completed: data.detail?.completed ?? previous?.completed ?? 0,
        failed: data.detail?.failed ?? previous?.failed ?? 0,
        total: data.detail?.total ?? previous?.total ?? 0,
        stage: data.detail?.stage ?? previous?.stage,
        message: data.detail?.message ?? previous?.message,
        error: data.error,
        startedAt: previous?.startedAt ?? ev.at,
        durationMs:
          status === "completed" || status === "failed" || status === "cancelled"
            ? Math.max(0, ev.at - (previous?.startedAt ?? ev.at))
            : undefined,
      };
      if (idx >= 0) items[idx] = next;
      else {
        idx = items.length;
        items.push(next);
      }
      jobMap.set(data.jobId, idx);
    } else if (ev.type === "tool_call") {
      const d = ev.data as {
        id: string;
        name: ToolCall["name"];
        args?: Record<string, unknown>;
      };
      // Chat-inline：不展示 ToolBlock，等 tool_result 提升为助手正文
      if (isChatInlineTool(d.name)) {
        updatePlanStep(d.id, d.name, {
          status: "running",
          startedAt: ev.at,
          args: d.args,
        });
        continue;
      }
      updatePlanStep(d.id, d.name, {
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
        name?: ToolCall["name"];
        toolName?: ToolCall["name"];
        summary?: string;
        data?: unknown;
      };
      const inlineName = d.toolName ?? d.name;
      if (isChatInlineTool(inlineName) && d.ok !== false) {
        const answer =
          (d.summary ? formatChatValue(d.summary) : undefined) ??
          extractChatInlineAnswerText(d.data);
        if (answer) {
          assistantText += normalizeTimelineText(answer);
        }
        updatePlanStep(d.id, inlineName, {
          status: "done",
          summary: answer?.slice(0, 120),
          durationMs: 0,
        });
        toolMap.delete(d.id);
        continue;
      }
      let idx = items.findIndex(
        (x) => x.kind === "tool" && x.id === d.id
      );
      if (idx < 0) {
        const completedToolName = (d as { toolName?: string; name?: string }).toolName
          ?? (d as { name?: string }).name;
        if (completedToolName) {
          idx = findLastIndex(
            items,
            (x) => x.kind === "tool" && x.name === completedToolName && x.status === "running"
          );
        }
      }
      const completedToolName = d.toolName ?? d.name;
      const confirmation = imageConfirmationFromToolResult(d.data);
      if (completedToolName === "generate_images" && confirmation) {
        const previousTool =
          idx >= 0 && items[idx]?.kind === "tool"
            ? (items[idx] as Extract<TimelineItem, { kind: "tool" }>)
            : undefined;
        const durationMs = previousTool ? ev.at - previousTool.startedAt : undefined;
        if (idx >= 0) items.splice(idx, 1);
        updatePlanStep(d.id, completedToolName, {
          status: "done",
          summary: "Waiting for user approval before image generation.",
          durationMs,
        });
        toolMap.delete(d.id);
        continue;
      }
      let durationMs: number | undefined;
      const previousItem = idx >= 0 ? items[idx] : undefined;
      if (previousItem?.kind === "tool") {
        durationMs = ev.at - previousItem.startedAt;
        items[idx] = {
          ...previousItem,
          status: d.ok ? "done" : "error",
          summary: d.summary,
          output: d.data,
          artifacts: Array.isArray((d as { artifacts?: unknown[] }).artifacts)
            ? (d as unknown as { artifacts: Array<{ type?: string; url?: string; title?: string; mimeType?: string }> }).artifacts
            : undefined,
          ok: d.ok,
          durationMs,
        };
      }
      if (idx < 0) {
        const toolName = (d as { toolName?: ToolCall["name"]; name?: ToolCall["name"] }).toolName
          ?? (d as { name?: ToolCall["name"] }).name;
        if (toolName) {
          items.push({
            kind: "tool",
            id: d.id,
            name: toolName,
            label: toolDisplayLabel(toolName),
            status: d.ok ? "done" : "error",
            summary: d.summary,
            output: d.data,
            artifacts: Array.isArray((d as { artifacts?: unknown[] }).artifacts)
              ? (d as unknown as { artifacts: Array<{ type?: string; url?: string; title?: string; mimeType?: string }> }).artifacts
              : undefined,
            ok: d.ok,
            startedAt: ev.at,
            durationMs: 0,
          });
        }
      }
      updatePlanStep(d.id, (d as { name?: ToolCall["name"]; toolName?: ToolCall["name"] }).toolName ?? (d as { name?: ToolCall["name"] }).name, {
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
          id: `file-${eventId}-${path}`,
          path,
          at: ev.at,
        });
      }
    } else if (ev.type === "assistant_text") {
      const text = normalizeTimelineText(
        formatChatValue((ev.data as { text?: unknown })?.text)
      );
      if (text && !isChatTechnicalNoise(text)) {
        assistantText += text;
      }
    } else if (ev.type === "agent.fallback") {
      const fallback = describeFallbackActivity(
        ev.data as { text?: string; reason?: string }
      );
      items.push({
        kind: "activity",
        id: `fallback-${eventId}`,
        text: fallback.text,
        tone: fallback.tone,
      });
    } else if (ev.type === "handoff_download") {
      const d = ev.data as { target?: string; fileCount?: number };
      items.push({
        kind: "handoff",
          id: `handoff-${eventId}`,
        target: d.target ?? "markdown",
        fileCount: d.fileCount ?? 0,
      });
    } else if (ev.type === "error") {
      items.push({
        kind: "error",
        id: `err-${eventId}`,
        message: String((ev.data as { message?: string })?.message ?? "鏈煡閿欒"),
      });
    } else if (ev.type === "pipeline_log") {
      const entry = ev.data as PipelineLogEntry;
      if (entry?.id) {
        items.push({
          kind: "pipeline_log",
          id: `plog-${entry.id}-${eventId}`,
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
          id: d.diffId ?? `diff-${eventId}-${d.path}`,
          path: d.path,
          language: d.language,
          oldText: d.oldText,
          newText: d.newText,
          summary: d.summary,
          toolCallId: d.toolCallId,
          diffId: d.diffId,
        });
      }
    } else if (ev.type === "direction.confirm") {
      const d = ev.data as {
        title?: string;
        summary?: string;
        tone?: string;
        palette?: string;
        typography?: string;
        imageStyle?: string;
      };
      if (d.summary) {
        items.push({
          kind: "direction",
          id: `direction-${eventId}`,
          title: d.title ?? "瑙嗚鏂瑰悜纭",
          summary: d.summary,
          tone: d.tone,
          palette: d.palette,
          typography: d.typography,
          imageStyle: d.imageStyle,
          confirmed: false,
        });
      }
    } else if (ev.type === "image_generation.confirm") {
      const d = ev.data as {
        title?: string;
        prompt?: string;
        reason?: string;
        count?: number;
        width?: number;
        height?: number;
        role?: string;
      };
      if (d.prompt) {
        const count = d.count ?? 1;
        if (
          !items.some(
            (x) =>
              x.kind === "image_confirm" &&
              x.prompt === d.prompt &&
              x.count === count
          )
        ) {
          items.push({
            kind: "image_confirm",
            id: `image-confirm-${eventId}`,
            title: d.title ?? "生图执行请求",
            prompt: d.prompt,
            reason: d.reason ?? "执行前请确认要发送给生图模型的提示词。",
            count,
            width: d.width ?? 1280,
            height: d.height ?? 720,
            role: d.role,
            confirmed: false,
          });
        }
      }
    } else if (ev.type === "tool.confirm") {
      const d = ev.data as {
        title?: string;
        runId?: string;
        approvalId?: string;
        toolName?: string;
        toolCallId?: string;
        riskLevel?: "safe" | "moderate" | "destructive";
        args?: Record<string, unknown>;
        reason?: string;
      };
      if (d.toolName) {
        if (isSafeReadOnlyToolConfirmation(d.toolName, d.args)) {
          continue;
        }
        const approvalKey = d.approvalId ?? `${d.runId ?? ""}:${d.toolName}`;
        if (
          (d.approvalId &&
            (resolvedApprovals.byApprovalId.has(d.approvalId) ||
              resolvedApprovals.byRunTool.has(`${d.runId ?? ""}:${d.toolName}`))) ||
          visibleApprovalKeys.has(approvalKey)
        ) {
          continue;
        }
        visibleApprovalKeys.add(approvalKey);
        const safeArgs = sanitizeToolConfirmArgs(d.toolName, d.args);
        items.push({
          kind: "tool_confirm",
          id: `tool-confirm-${eventId}-${d.toolName}`,
          title: d.title ?? `执行 ${d.toolName}`,
          runId: d.runId,
          approvalId: d.approvalId,
          toolName: d.toolName,
          toolCallId: d.toolCallId,
          riskLevel: d.riskLevel ?? "moderate",
          args: safeArgs,
          reason: d.reason ?? "该工具执行前需要确认。",
          confirmed: false,
        });
      }
    } else if (ev.type === "discovery.questions") {
      const d = ev.data as {
        title?: string;
        description?: string;
        questions?: Array<{
          id: string;
          label: string;
          type: "radio" | "checkbox" | "text" | "textarea";
          required?: boolean;
          options?: string[];
          optionLabels?: Record<string, string>;
          default?: string | string[];
          maxSelections?: number;
          placeholder?: string;
        }>;
      };
      if (d.questions && d.questions.length > 0) {
        items.push({
          kind: "discovery",
            id: `discovery-${eventId}`,
          title: d.title ?? "Discovery",
          description: d.description,
          questions: d.questions,
          answered: false,
        });
      }
    }
  }

  // 鍏抽棴杩涜涓殑 thought 娴?
  for (const item of items) {
    if (item.kind === "thought" && item.streaming && !isStreaming) {
      item.streaming = false;
      if (item.startedAt) {
        item.durationMs = Date.now() - item.startedAt;
      }
    }
  }

  if (assistantText && !isChatTechnicalNoise(assistantText)) {
    const confirmation = imageConfirmationFromAssistantText(assistantId, assistantText);
    if (confirmation) {
      const existingIdx = items.findIndex((x) => x.id === assistantId);
      if (existingIdx >= 0) items.splice(existingIdx, 1);
      if (
        !items.some(
          (x) =>
            x.kind === "image_confirm" &&
            x.prompt === confirmation.prompt &&
            x.count === confirmation.count
        )
      ) {
        items.push(confirmation);
      }
      return items;
    }
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

function collectResolvedToolApprovals(events: ChatLiveEvent[]): {
  byApprovalId: Set<string>;
  byRunTool: Set<string>;
} {
  const byApprovalId = new Set<string>();
  const byRunTool = new Set<string>();
  for (const event of events) {
    if (
      event.type !== "tool.completed" &&
      event.type !== "run.completed" &&
      event.type !== "run.cancelled"
    ) {
      continue;
    }
    const data =
      event.data && typeof event.data === "object"
        ? (event.data as Record<string, unknown>)
        : {};
    const approvalId =
      typeof data.approvalId === "string" ? data.approvalId : undefined;
    if (approvalId) byApprovalId.add(approvalId);
    const runId = typeof data.runId === "string" ? data.runId : undefined;
    const toolName =
      typeof data.toolName === "string"
        ? data.toolName
        : typeof data.approvedTool === "string"
          ? data.approvedTool
          : undefined;
    if (runId && toolName && (data.approved === true || event.type !== "tool.completed")) {
      byRunTool.add(`${runId}:${toolName}`);
    }
  }
  return { byApprovalId, byRunTool };
}

function findLastIndex<T>(items: T[], pred: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (pred(items[i])) return i;
  }
  return -1;
}

function normalizeErrorMessage(message: string): string {
  return message.trim().replace(/\s+/g, " ").toLowerCase();
}

function dedupeTimelineErrors(items: TimelineItem[]): TimelineItem[] {
  const seen = new Set<string>();
  const result: TimelineItem[] = [];
  for (const item of items) {
    if (item.kind !== "error") {
      result.push(item);
      continue;
    }
    const key = normalizeErrorMessage(item.message);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function groupCurrentTurn(items: TimelineItem[]): TimelineItem[] {
  const userIndex = findLastIndex(items, (item) => item.kind === "user");
  if (userIndex < 0) return groupTurnItems(items);

  const prefix = items.slice(0, userIndex + 1);
  const tail = items.slice(userIndex + 1);
  // 保持时序穿插（Cursor 风），不再把工具整段提到正文前
  return [...prefix, ...groupTurnItems(tail)];
}

export function buildChatTimeline(
  messages: ChatMessage[],
  liveEvents: ChatLiveEvent[],
  isStreaming: boolean
): TimelineItem[] {
  const base = messagesToTimeline(messages);
  if (liveEvents.length === 0) return dedupeTimelineErrors(groupCurrentTurn(base));
  return dedupeTimelineErrors(groupCurrentTurn(appendLiveEvents(base, liveEvents, isStreaming)));
}

export function buildChatTimelineTurns(
  messages: ChatMessage[],
  liveEvents: ChatLiveEvent[],
  isStreaming: boolean
): TimelineTurn[] {
  const base = messagesToTimeline(messages);
  const timeline = dedupeTimelineErrors(
    liveEvents.length === 0 ? base : appendLiveEvents(base, liveEvents, isStreaming)
  );
  return groupTimelineTurns(timeline, isStreaming);
}

function groupTimelineTurns(items: TimelineItem[], isStreaming: boolean): TimelineTurn[] {
  const turns: TimelineTurn[] = [];
  let current: { user?: Extract<TimelineItem, { kind: "user" }>; items: TimelineItem[] } | null = null;

  for (const item of items) {
    if (item.kind === "user") {
      if (current) turns.push(buildTurn(current, isStreaming, turns.length));
      current = { user: item, items: [] };
      continue;
    }
    if (!current) current = { items: [] };
    current.items.push(item);
  }

  if (current) turns.push(buildTurn(current, isStreaming, turns.length));
  return turns;
}

function buildTurn(
  turn: { user?: Extract<TimelineItem, { kind: "user" }>; items: TimelineItem[] },
  isStreaming: boolean,
  index: number
): TimelineTurn {
  const status = inferTurnStatus(turn.items, isStreaming);
  const content = turn.user?.content.trim();
  const title = content ? truncateOneLine(content, 72) : `Task ${index + 1}`;
  return {
    id: turn.user?.id ?? `turn-${index}`,
    user: turn.user,
    items: groupTurnItems(turn.items),
    status,
    title,
    startedAt: turn.user?.createdAt ? new Date(turn.user.createdAt).getTime() : inferStartedAt(turn.items),
    counts: {
      tools: turn.items.filter((item) => item.kind === "tool").length,
      jobs: turn.items.filter((item) => item.kind === "job").length,
      files: turn.items.filter((item) => item.kind === "file").length,
      changes: turn.items.filter((item) => item.kind === "code_diff").length,
      errors: turn.items.filter((item) => item.kind === "error").length,
    },
  };
}

/**
 * 对话风编排：保留事件到达顺序；仅
 * 1) 合并 thought（落在首条 thought 位置）
 * 2) 连续 pipeline_log → 一组（默认一行摘要）
 * 3) 把挂在 toolCallId 上的 job 贴到对应 tool 后
 * 不再把整段工具提到 assistant 正文之前。
 */
function groupTurnItems(items: TimelineItem[]): TimelineItem[] {
  return attachJobsBesideTools(
    compactPipelineLogsInPlace(compactThoughtsInPlace(items))
  );
}

/** 把连续的 pipeline_log 压成 pipeline_logs，保留与 tool/assistant 的穿插位置 */
function compactPipelineLogsInPlace(items: TimelineItem[]): TimelineItem[] {
  const result: TimelineItem[] = [];
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    if (item.kind !== "pipeline_log") {
      result.push(item);
      i += 1;
      continue;
    }
    const entries: PipelineLogEntry[] = [];
    const startId = item.id;
    while (i < items.length && items[i].kind === "pipeline_log") {
      entries.push(
        (items[i] as Extract<TimelineItem, { kind: "pipeline_log" }>).entry
      );
      i += 1;
    }
    result.push({
      kind: "pipeline_logs",
      id: `${startId}:group:${entries.length}`,
      entries,
    });
  }
  return result;
}

const CONNECTING_LLM_NOISE =
  /正在连接\s*LLM|准备规划任务|Connecting to LLM/i;

function sanitizeThoughtContent(content: string): string {
  return content
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !CONNECTING_LLM_NOISE.test(line))
    .join("\n\n")
    .trim();
}

function compactThoughtsInPlace(items: TimelineItem[]): TimelineItem[] {
  const thoughtIndexes: number[] = [];
  for (let i = 0; i < items.length; i += 1) {
    if (items[i].kind === "thought") thoughtIndexes.push(i);
  }
  if (thoughtIndexes.length === 0) return items;

  const thoughts = thoughtIndexes.map(
    (i) => items[i] as Extract<TimelineItem, { kind: "thought" }>
  );
  const content = sanitizeThoughtContent(
    thoughts.map((item) => item.content).join("\n\n")
  );
  const first = thoughts[0];
  const last = thoughts[thoughts.length - 1];
  const streaming = thoughts.some((item) => item.streaming);
  // 纯「正在连接 LLM」噪音：流式中保留一条轻量占位，结束后丢弃
  if (!content && !streaming) {
    return items.filter((item) => item.kind !== "thought");
  }

  const merged: Extract<TimelineItem, { kind: "thought" }> = {
    ...first,
    id:
      thoughts.length > 1
        ? `${first.id}:compact:${thoughts.length}`
        : first.id,
    content,
    streaming,
    durationMs: last.durationMs ?? first.durationMs,
  };

  const result: TimelineItem[] = [];
  const firstIdx = thoughtIndexes[0];
  for (let i = 0; i < items.length; i += 1) {
    if (items[i].kind === "thought") {
      if (i === firstIdx) result.push(merged);
      continue;
    }
    result.push(items[i]);
  }
  return result;
}

function attachJobsBesideTools(items: TimelineItem[]): TimelineItem[] {
  const jobsByTool = new Map<string, Extract<TimelineItem, { kind: "job" }>[]>();
  for (const item of items) {
    if (item.kind !== "job" || !item.toolCallId) continue;
    const list = jobsByTool.get(item.toolCallId) ?? [];
    list.push(item);
    jobsByTool.set(item.toolCallId, list);
  }

  const consumed = new Set<string>();
  const ordered: TimelineItem[] = [];
  for (const item of items) {
    if (item.kind === "job" && item.toolCallId) continue;
    ordered.push(item);
    if (item.kind === "tool") {
      for (const job of jobsByTool.get(item.id) ?? []) {
        if (consumed.has(job.jobId)) continue;
        ordered.push(job);
        consumed.add(job.jobId);
      }
    }
  }
  for (const item of items) {
    if (item.kind !== "job") continue;
    if (consumed.has(item.jobId)) continue;
    ordered.push(item);
  }
  return ordered;
}

function inferTurnStatus(items: TimelineItem[], isStreaming: boolean): TimelineTurn["status"] {
  if (items.some((item) => item.kind === "error")) return "failed";
  if (items.some((item) => item.kind === "activity" && item.text === "Run cancelled.")) {
    return "cancelled";
  }
  if (
    items.some(
      (item) =>
        item.kind === "discovery" ||
        item.kind === "direction" ||
        item.kind === "image_confirm" ||
        item.kind === "tool_confirm"
    )
  ) {
    return "waiting";
  }
  if (items.some((item) => item.kind === "tool" && item.status === "error")) return "failed";
  if (items.some((item) => item.kind === "job" && item.status === "failed")) return "failed";

  // 流式中即便还没有任何 thinking/tool 事件，也算执行中（避免侧栏空白像「没在跑」）
  // Agent run 结束后后台 job（生图）仍在跑时，同样保持 running
  const stillWorking =
    isStreaming ||
    items.some(
      (item) =>
        (item.kind === "tool" && item.status === "running") ||
        (item.kind === "job" &&
          (item.status === "queued" || item.status === "running")) ||
        (item.kind === "thought" && item.streaming) ||
        (item.kind === "assistant" && item.streaming)
    );
  if (stillWorking) return "running";

  return items.length > 0 ? "completed" : "idle";
}

function inferStartedAt(items: TimelineItem[]): number | undefined {
  for (const item of items) {
    if ("startedAt" in item && typeof item.startedAt === "number") return item.startedAt;
    if ("at" in item && typeof item.at === "number") return item.at;
  }
  return undefined;
}

function truncateOneLine(value: string, max: number): string {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}...` : line;
}

function imageConfirmationFromToolResult(value: unknown):
  | Extract<TimelineItem, { kind: "image_confirm" }>
  | null {
  if (!isRecord(value)) return null;
  const nested = isRecord(value.data) ? value.data : null;
  const payload =
    value.confirmationRequired === true
      ? value
      : nested?.confirmationRequired === true
        ? nested
        : null;
  if (!payload) return null;
  const prompts = Array.isArray(payload.prompts)
    ? payload.prompts
        .filter((p): p is string => typeof p === "string")
        .map((p) => p.trim())
        .filter(Boolean)
    : undefined;
  const prompt =
    (typeof payload.prompt === "string" && payload.prompt.trim()
      ? payload.prompt.trim()
      : prompts?.[0]) ?? "";
  if (!prompt) return null;
  return {
    kind: "image_confirm",
    id: "image-confirm-from-tool",
    title:
      typeof payload.title === "string" && payload.title.trim()
        ? payload.title
        : "生图执行请求",
    prompt,
    prompts: prompts && prompts.length > 0 ? prompts : [prompt],
    reason:
      typeof payload.reason === "string" && payload.reason.trim()
        ? payload.reason
        : "执行前请确认要发送给生图模型的提示词。",
    count: toPositiveInt(
      payload.count,
      prompts && prompts.length > 1 ? prompts.length : 1
    ),
    width: toPositiveInt(payload.width, 1280),
    height: toPositiveInt(payload.height, 720),
    role: typeof payload.role === "string" ? payload.role : undefined,
    confirmed: false,
  };
}

function toPositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeToolConfirmArgs(
  toolName: string,
  args?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (toolName !== "generate_images" || !args) return args;
  const prompt = typeof args.prompt === "string" ? args.prompt : "";
  if (!looksLikeInternalPromptLeak(prompt)) return args;
  return {
    ...args,
    prompt:
      "Blocked internal agent instructions from being sent to the image model. Please edit this field into the actual visual prompt before running.",
    confirmed: false,
  };
}

function isSafeReadOnlyToolConfirmation(
  toolName: string,
  args?: Record<string, unknown>
): boolean {
  if (toolName !== "file_system") return false;
  return args?.action !== "write";
}

function looksLikeInternalPromptLeak(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return [
    "never show a prompt preview",
    "normal assistant text",
    "use generate_images",
    "render an execution approval card",
    "run/cancel/edit controls",
    "tool approval card",
    "[image_generation_confirmed]",
  ].some((marker) => normalized.includes(marker));
}

function imageConfirmationFromAssistantText(
  id: string,
  content: string
): Extract<TimelineItem, { kind: "image_confirm" }> | null {
  if (!/(提示词预览|prompt\s*preview|将发送给生图模型的提示词)/i.test(content)) {
    return null;
  }
  if (!/(确认后|立刻生成|马上生成|执行|run|generate)/i.test(content)) {
    return null;
  }

  const prompt = extractPromptPreview(content);
  if (!prompt) return null;
  const title =
    content
      .split(/\r?\n/)
      .map((line) => line.replace(/^#+\s*/, "").trim())
      .find((line) => line && !/(提示词预览|prompt\s*preview)/i.test(line))
      ?.slice(0, 60) || "生图执行请求";
  const count = inferCountFromAssistantText(content);
  const isUi = /app|ui|首页|主页|详情页|页面|screen|mobile|phone|手机/i.test(
    `${title}\n${prompt}`
  );
  const isVertical = /vertical|9\s*:\s*16|手机|mobile|phone|app/i.test(prompt);

  return {
    kind: "image_confirm",
    id: `image-confirm-${id}`,
    title,
    prompt,
    reason: isUi
      ? "Agent 准备提交生图模型生成 UI 图。执行前请确认这确实是你要的界面、数量和提示词。"
      : "Agent 准备提交生图模型。执行前请确认提示词和数量。",
    count,
    width: isVertical ? 1024 : 1280,
    height: isVertical ? 1792 : 720,
    role: isUi ? "product-shot" : "hero",
    confirmed: false,
  };
}

function extractPromptPreview(content: string): string | null {
  const fenced = content.match(
    /(?:提示词预览|prompt\s*preview|将发送给生图模型的提示词)\s*[:：]?\s*```(?:\w+)?\s*([\s\S]*?)```/i
  );
  if (fenced?.[1]?.trim()) return fenced[1].trim();

  const afterLabel = content.match(
    /(?:提示词预览|prompt\s*preview|将发送给生图模型的提示词)\s*[:：]?\s*([\s\S]*)/i
  )?.[1];
  if (!afterLabel) return null;
  const prompt = afterLabel
    .split(/\n\s*---\s*\n|\n\s*你觉得|\n\s*确认后|\n\s*或者你想|\n\s*如果你/i)[0]
    .trim()
    .replace(/^```(?:\w+)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  return prompt.length > 20 ? prompt : null;
}

function inferCountFromAssistantText(content: string): number {
  const digit = content.match(/(?:生成|create|generate)\s*(\d+)\s*(?:张|个|image|images)?/i);
  if (digit?.[1]) return Math.min(8, Math.max(1, Number.parseInt(digit[1], 10)));
  if (/一\s*张|1\s*张|one\s+image/i.test(content)) return 1;
  if (/两\s*张|二\s*张|2\s*张|two\s+images/i.test(content)) return 2;
  return 1;
}

export function describeFallbackActivity(data: {
  text?: string;
  reason?: string;
}): { text: string; tone: "info" | "warning" } {
  const raw = typeof data.text === "string" ? data.text.trim() : "";
  const reason = data.reason;
  if (reason === "checkpoint_reset" || /incomplete tool-call checkpoint/i.test(raw)) {
    return { tone: "info", text: "会话记忆不完整，已重置并自动重试。" };
  }
  if (reason === "context_reset" || /上下文.*过大|context length|会话记忆过大/i.test(raw)) {
    return {
      tone: "info",
      text: raw && /[\u4e00-\u9fff]/.test(raw) ? raw : "会话记忆过大，已清空并重试。",
    };
  }
  if (reason === "llm_unavailable" || /LLM 请求不可用|LLM unavailable|local rule engine/i.test(raw)) {
    return { tone: "warning", text: "模型请求失败，已改用本地规则流程继续。" };
  }
  if (raw) {
    return { tone: "info", text: raw };
  }
  return { tone: "info", text: "已切换备用流程继续执行。" };
}
