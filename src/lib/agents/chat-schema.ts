/**
 * Chat Session schema
 * --------------------------------------------------------------
 * 用户与设计 Agent 的持续对话。
 *
 * - 一个 project 一个 chat session（messages 按时间线追加）
 * - 每条 message 可能是 user / assistant / tool 三种角色
 * - 流式响应阶段（SSE）的 event 也会被保存成 message，让 UI 能"回放"
 *
 * 这个 schema 同时给 Route Handler 和 Chat Pane（client）用，
 * 所以保持纯数据 + zod，不引入服务端依赖。
 */

import { z } from "zod";
import type { ProjectFile } from "@/lib/project/schema";
import type { PipelineLogEntry } from "./pipeline-logger";
import { TOOL_NAMES, type ToolName } from "./tool-contract";

/** 流式事件类型 —— Open Design 也是这套（thinking/tool/file/done） */
export const ChatEventTypeSchema = z.enum([
  "thinking",
  "tool_call",
  "tool_result",
  "file_write",
  "code_diff",
  "project_preview",
  "agent_plan",
  "pipeline_log",
  "assistant_text",
  "handoff_download",
  "done",
  "error",
  "run.started",
  "message.delta",
  "thinking.delta",
  "llm.requested",
  "llm.started",
  "llm.completed",
  "llm.failed",
  "agent.fallback",
  "tool.started",
  "tool.completed",
  "tool.confirm",
  "project.update",
  "canvas.sync",
  "run.completed",
  "run.waiting_user",
  "run.cancelling",
  "run.failed",
  "run.cancelled",
  "job.queued",
  "job.started",
  "job.progress",
  "job.completed",
  "job.failed",
  "job.cancelled",
  "command.ack",
  "discovery.questions",
  "direction.confirm",
  "image_generation.confirm",
]);
export type ChatEventType = z.infer<typeof ChatEventTypeSchema>;

/** 工具调用 —— 把 Brief/Layout/Critic/Repair 等 Agent 包装成 tool */
export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.enum(TOOL_NAMES),
  /** 工具入参（自由 json，每个工具自己 zod 校验） */
  args: z.record(z.string(), z.unknown()).default({}),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type CanonicalToolName = ToolName;

/** @提及类型 */
export const MentionSchema = z.object({
  type: z.enum(["model", "brand_asset", "skill", "asset", "page"]),
  id: z.string(),
  label: z.string().optional(),
});
export type Mention = z.infer<typeof MentionSchema>;

/** 单条聊天消息 */
export const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "tool"]),
  /** 文本内容（user / assistant 用） */
  content: z.string().optional(),
  /** 消息附件（用户上传的图片等） */
  attachments: z
    .array(
      z.object({
        id: z.string(),
        type: z.enum(["image", "file"]),
        url: z.string(),
        mimeType: z.string().optional(),
        name: z.string().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
      })
    )
    .optional(),
  /** @提及列表 */
  mentions: z.array(MentionSchema).optional(),
  /** 工具调用 / 结果（assistant / tool 用） */
  toolCall: ToolCallSchema.optional(),
  /** 工具返回的简明结果（tool 用；如 "生成 3 页" / "评分 7.2"） */
  toolResult: z
    .object({
      ok: z.boolean(),
      summary: z.string().optional(),
      data: z.unknown().optional(),
    })
    .optional(),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/** 完整 chat session（按 projectId 关联） */
export const ChatSessionSchema = z.object({
  projectId: z.string(),
  messages: z.array(ChatMessageSchema),
  /** 当前激活的 skill / design-system；用户可在 UI 切换 */
  activeSkillId: z.string().optional(),
  activeDesignSystemId: z.string().optional(),
});
export type ChatSession = z.infer<typeof ChatSessionSchema>;

// ──────────────────────────────────────────────────────────────────
// SSE 事件 wire 格式
// ──────────────────────────────────────────────────────────────────
// 服务端 enqueue：`event: <type>\ndata: <json>\n\n`
// 客户端用 EventSource 或手解 stream，解析后映射回这里的类型。
export interface ChatStreamEvent {
  type: ChatEventType;
  data: unknown;
}

/** 各事件的 data 形状（让前端类型收窄） */
export type ThinkingEventData = { text: string };
export type ToolCallEventData = { id: string; name: ToolCall["name"]; args?: Record<string, unknown> };
export type ToolResultEventData = {
  id: string;
  name?: ToolCall["name"];
  toolName?: ToolCall["name"];
  ok: boolean;
  summary?: string;
  data?: unknown;
  artifacts?: ToolArtifact[];
};
export type FileWriteEventData = { path: string; bytes?: number };
export type CodeDiffEventData = {
  path: string;
  language?: string;
  oldText?: string;
  newText?: string;
  summary?: string;
  /** 关联的工具调用 id，用于预览确认 */
  toolCallId?: string;
  diffId?: string;
};
export type ProjectPreviewEventData = {
  toolCallId: string;
  project: ProjectFile;
};
export type AgentPlanEventData = {
  thinking?: string;
  tools: ToolCall[];
};
export type PipelineLogEventData = PipelineLogEntry;
export type AssistantTextEventData = { text: string };
export type DoneEventData = { reason: "complete" | "cancelled"; projectId?: string };
export type ErrorEventData = {
  message: string;
  code?: string;
  retryable?: boolean;
  details?: unknown;
  /** Billing 相关：积分不足等 */
  billing?: {
    type: "insufficient_credits" | "plan_limit" | "generation_refund";
    creditsNeeded?: number;
    creditsRemaining?: number;
    plan?: string;
  };
};
export type HandoffDownloadEventData = {
  target: "cursor" | "claude-code" | "codex" | "markdown";
  fileCount: number;
};

// ──────────────────────────────────────────────────────────────────
// WebSocket 事件 data 类型
// ──────────────────────────────────────────────────────────────────

export type MessageDeltaEventData = { text: string; runId: string };
export type ThinkingDeltaEventData = { text: string; runId: string };
export type ToolStartedEventData = {
  runId: string;
  toolCallId?: string;
  toolName: string;
  args?: unknown;
};
export type ToolCompletedEventData = {
  runId: string;
  toolCallId?: string;
  toolName: string;
  output?: unknown;
  outputSummary?: string;
  ok?: boolean;
  artifacts?: ToolArtifact[];
};
export type ProjectUpdateEventData = { runId: string; project: ProjectFile };
export type CanvasSyncEventData = { runId?: string; projectId?: string; data?: unknown };
export type RunStartedEventData = { runId: string; threadId: string };
export type RunCompletedEventData = { runId: string };
export type RunFailedEventData = {
  runId: string;
  error?: string;
  code?: string;
  retryable?: boolean;
};
export type RunCancelledEventData = { runId: string };
export type CommandAckEventData = { runId: string; threadId: string };
export type ImageGenerationConfirmEventData = {
  runId?: string;
  title: string;
  prompt: string;
  reason: string;
  count: number;
  width: number;
  height: number;
  role?: string;
};

// ──────────────────────────────────────────────────────────────────
// Tool Artifact — 工具输出的结构化产物
// ──────────────────────────────────────────────────────────────────

export interface ImageArtifact {
  type: "image";
  title?: string;
  url: string;
  mimeType: string;
  width: number;
  height: number;
}

export interface VideoArtifact {
  type: "video";
  title?: string;
  url: string;
  mimeType: string;
  width: number;
  height: number;
  durationSeconds?: number;
}

export type ToolArtifact = ImageArtifact | VideoArtifact;
