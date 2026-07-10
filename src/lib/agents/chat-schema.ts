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

/** 流式事件类型 —— Open Design 也是这套（thinking/tool/file/done） */
export const ChatEventTypeSchema = z.enum([
  "thinking", // 文本片段：Agent 思考中
  "tool_call", // Agent 决定调一个工具
  "tool_result", // 工具返回结果
  "file_write", // 工具写入文件（pages.json / assets/...）
  "code_diff", // 文件变更预览（Cursor 式 diff 块）
  "project_preview", // 工具执行后的完整项目快照（IDE 确认后再应用）
  "agent_plan", // 本轮 Agent 执行计划
  "pipeline_log", // 流水线阶段日志（与首页 generate/stream 的 log 同结构）
  "assistant_text", // Agent 给用户的最终回复
  "handoff_download", // 提示客户端下载 Handoff ZIP
  "done", // 本轮结束
  "error", // 出错
]);
export type ChatEventType = z.infer<typeof ChatEventTypeSchema>;

/** 工具调用 —— 把 Brief/Layout/Critic/Repair 等 Agent 包装成 tool */
export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.enum([
    "generate_brief",
    "plan_architecture",
    "plan_design_direction",
    "generate_layout",
    "polish_content",
    "generate_images",
    "generate_image_variants",
    "restyle_page_images",
    "edit_page",
    "export_handoff",
    "critique_pages",
    "repair_page",
    "answer_question",
  ]),
  /** 工具入参（自由 json，每个工具自己 zod 校验） */
  args: z.record(z.string(), z.unknown()).optional(),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

/** 单条聊天消息 */
export const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "tool"]),
  /** 文本内容（user / assistant 用） */
  content: z.string().optional(),
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
export type ToolResultEventData = { id: string; ok: boolean; summary?: string; data?: unknown };
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
export type ErrorEventData = { message: string };
export type HandoffDownloadEventData = {
  target: "cursor" | "claude-code" | "codex" | "markdown";
  fileCount: number;
};
