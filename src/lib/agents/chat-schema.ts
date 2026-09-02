/**
 * Chat Session schema
 * --------------------------------------------------------------
 * 鐢ㄦ埛涓庤璁?Agent 鐨勬寔缁璇濄€? *
 * - 涓€涓?project 涓€涓?chat session锛坢essages 鎸夋椂闂寸嚎杩藉姞锛? * - 姣忔潯 message 鍙兘鏄?user / assistant / tool 涓夌瑙掕壊
 * - 娴佸紡鍝嶅簲闃舵锛圫SE锛夌殑 event 涔熶細琚繚瀛樻垚 message锛岃 UI 鑳?鍥炴斁"
 *
 * 杩欎釜 schema 鍚屾椂缁?Route Handler 鍜?Chat Pane锛坈lient锛夌敤锛? * 鎵€浠ヤ繚鎸佺函鏁版嵁 + zod锛屼笉寮曞叆鏈嶅姟绔緷璧栥€? */

import { z } from "zod";
import type { ProjectFile } from "@/lib/project/schema";
import type { PipelineLogEntry } from "./pipeline-logger";

/** 娴佸紡浜嬩欢绫诲瀷 鈥斺€?Open Design 涔熸槸杩欏锛坱hinking/tool/file/done锛?*/
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

/** 宸ュ叿璋冪敤 鈥斺€?鎶?Brief/Layout/Critic/Repair 绛?Agent 鍖呰鎴?tool */
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
    "materialize_mockup",
    "critique_pages",
    "repair_page",
    "answer_question",
    "inspect_canvas",
    "manipulate_canvas",
    "star_asset",
    "batch_delete_assets",
    "delegate_task",
    "screenshot_canvas",
    "brand_kit",
    "file_system",
    "persist_sandbox_file",
    "execute",
    "generate_video",
    "job_status",
    "ask_discovery",
    "confirm_direction",
    "adopt_asset_style",
  ]),
  /** 宸ュ叿鍏ュ弬锛堣嚜鐢?json锛屾瘡涓伐鍏疯嚜宸?zod 鏍￠獙锛?*/
  args: z.record(z.string(), z.unknown()).optional(),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

/** @鎻愬強绫诲瀷 */
export const MentionSchema = z.object({
  type: z.enum(["model", "brand_asset", "skill", "asset", "page"]),
  id: z.string(),
  label: z.string().optional(),
});
export type Mention = z.infer<typeof MentionSchema>;

/** 鍗曟潯鑱婂ぉ娑堟伅 */
export const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "tool"]),
  /** 鏂囨湰鍐呭锛坲ser / assistant 鐢級 */
  content: z.string().optional(),
  /** 娑堟伅闄勪欢锛堢敤鎴蜂笂浼犵殑鍥剧墖绛夛級 */
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
  /** @鎻愬強鍒楄〃 */
  mentions: z.array(MentionSchema).optional(),
  /** 宸ュ叿璋冪敤 / 缁撴灉锛坅ssistant / tool 鐢級 */
  toolCall: ToolCallSchema.optional(),
  /** 宸ュ叿杩斿洖鐨勭畝鏄庣粨鏋滐紙tool 鐢紱濡?"鐢熸垚 3 椤? / "璇勫垎 7.2"锛?*/
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

/** 瀹屾暣 chat session锛堟寜 projectId 鍏宠仈锛?*/
export const ChatSessionSchema = z.object({
  projectId: z.string(),
  messages: z.array(ChatMessageSchema),
  /** 褰撳墠婵€娲荤殑 skill / design-system锛涚敤鎴峰彲鍦?UI 鍒囨崲 */
  activeSkillId: z.string().optional(),
  activeDesignSystemId: z.string().optional(),
});
export type ChatSession = z.infer<typeof ChatSessionSchema>;

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// SSE 浜嬩欢 wire 鏍煎紡
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// 鏈嶅姟绔?enqueue锛歚event: <type>\ndata: <json>\n\n`
// 瀹㈡埛绔敤 EventSource 鎴栨墜瑙?stream锛岃В鏋愬悗鏄犲皠鍥炶繖閲岀殑绫诲瀷銆?
export interface ChatStreamEvent {
  type: ChatEventType;
  data: unknown;
}

/** 鍚勪簨浠剁殑 data 褰㈢姸锛堣鍓嶇绫诲瀷鏀剁獎锛?*/
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
  /** 鍏宠仈鐨勫伐鍏疯皟鐢?id锛岀敤浜庨瑙堢‘璁?*/
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
  /** Billing 鐩稿叧锛氱Н鍒嗕笉瓒崇瓑 */
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

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// WebSocket 浜嬩欢 data 绫诲瀷
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

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

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// Tool Artifact 鈥?宸ュ叿杈撳嚭鐨勭粨鏋勫寲浜х墿
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

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
