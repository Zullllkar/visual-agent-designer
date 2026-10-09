/**
 * Chat 轮次流水线日志桥接
 * --------------------------------------------------------------
 * 将 PipelineLogger 与 Chat SSE（pipeline_log 事件）及 .vad 落盘串联。
 *
 * @author：wangjunhua
 */

import { nanoid } from "nanoid";
import type { ToolCall } from "./chat-schema";
import type { ChatStreamEvent } from "./chat-schema";
import {
  PipelineLogger,
  type PipelineLogEntry,
} from "./pipeline-logger";
import { appendPipelineLogEntry } from "@/lib/vad/pipeline-log-persist";
import { toolDisplayLabel } from "@/lib/chat/live-timeline";

/** Chat 工具名 → pipeline stage id */
export const CHAT_TOOL_STAGE: Record<string, string> = {
  generate_brief: "brief",
  plan_architecture: "architecture",
  plan_design_direction: "design_direction",
  generate_layout: "layout",
  polish_content: "content",
  generate_images: "image_execute",
  generate_image_variants: "image_variants",
  restyle_page_images: "image_restyle",
  edit_page: "edit",
  export_handoff: "handoff",
  materialize_mockup: "materialize",
  critique_pages: "critique",
  repair_page: "repair",
  answer_question: "answer",
  inspect_canvas: "inspect",
  manipulate_canvas: "manipulate",
  star_asset: "star",
  batch_delete_assets: "batch_delete",
  delegate_task: "delegate",
  screenshot_canvas: "screenshot",
  brand_kit: "brand_kit",
  file_system: "file_system",
  persist_sandbox_file: "persist_file",
  execute: "execute",
  generate_video: "video",
  job_status: "job_status",
  ask_discovery: "discovery",
  confirm_direction: "direction_confirm",
  adopt_asset_style: "design_direction",
};

export interface ChatPipelineLogBridge {
  logger: PipelineLogger;
  projectId: string;
  /** 取出并清空待推送的日志条目 */
  drainEntries: () => PipelineLogEntry[];
  /** 转为 Chat SSE 事件 */
  drainEvents: () => ChatStreamEvent[];
}

export function createChatPipelineLogBridge(
  projectId: string,
  userHint?: string
): ChatPipelineLogBridge {
  const pending: PipelineLogEntry[] = [];
  // runId 须在构造前生成：PipelineLogger 构造时会同步触发 onEntry，不可引用尚未赋值的 logger
  const runId = nanoid(8);
  const logger = new PipelineLogger({
    runId,
    projectId,
    source: "chat",
    idea: userHint?.slice(0, 200),
    onEntry: (entry) => {
      pending.push(entry);
      void appendPipelineLogEntry(projectId, entry, {
        runId,
        source: "chat",
      }).catch(() => {});
    },
  });

  return {
    logger,
    projectId,
    drainEntries: () => {
      const out = [...pending];
      pending.length = 0;
      return out;
    },
    drainEvents: () =>
      drainToEvents(pending),
  };
}

function drainToEvents(pending: PipelineLogEntry[]): ChatStreamEvent[] {
  const out: ChatStreamEvent[] = [];
  while (pending.length) {
    const entry = pending.shift()!;
    out.push({ type: "pipeline_log", data: entry });
  }
  return out;
}

/** 在 async generator 中 yield 积压的 pipeline_log */
export function* flushPipelineLogEvents(
  bridge: ChatPipelineLogBridge
): Generator<ChatStreamEvent> {
  for (const ev of bridge.drainEvents()) {
    yield ev;
  }
}

export function stageForChatTool(name: ToolCall["name"]): string {
  return CHAT_TOOL_STAGE[name] ?? name;
}

export function detailForChatTool(call: ToolCall): string {
  return toolDisplayLabel(call.name);
}
