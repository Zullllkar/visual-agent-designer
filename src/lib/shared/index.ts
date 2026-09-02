/**
 * @vad/shared — 前后端共享类型
 * --------------------------------------------------------------
 * 统一导出所有前后端共用的 Zod schema 和 TypeScript 类型。
 * 避免前后端类型定义重复，确保 WebSocket 消息、画布节点、
 * 项目文件等结构在两端保持一致。
 *
 * 使用方式：
 *   import { CanvasNodeSchema, ChatMessageSchema, WsEventSchema } from "@/lib/shared";
 */

// ── Canvas Schema ──────────────────────────────────────────────────
export {
  CanvasNodeSchema,
  CanvasPageSchema,
  FrameNodeSchema,
  TextNodeSchema,
  ImageNodeSchema,
  ButtonNodeSchema,
  CardNodeSchema,
  LineNodeSchema,
  ShapeNodeSchema,
  type CanvasNode,
  type CanvasPage,
  type CanvasNodeType,
  type FrameNode,
  type TextNode,
  type ImageNode,
  type ButtonNode,
  type CardNode,
  type LineNode,
  type ShapeNode,
} from "@/lib/canvas/schema";

// ── Project Schema ─────────────────────────────────────────────────
export {
  ProjectFileSchema,
  type ProjectFile,
  type CanvasSnapshot,
  type BrandKit,
} from "@/lib/project/schema";

// ── Brand Kit Schema ───────────────────────────────────────────────
export type {
  BrandKit as BrandKitType,
  BrandColor,
  BrandTypography,
} from "@/lib/project/brand-kit-schema";
export {
  BrandKitSchema,
  BrandColorSchema,
  BrandTypographySchema,
} from "@/lib/project/brand-kit-schema";

// ── Assets Schema ──────────────────────────────────────────────────
export type {
  ImageAsset,
  ReferenceAsset,
} from "@/lib/project/assets-schema";
export {
  ImageAssetSchema,
  ReferenceAssetSchema,
} from "@/lib/project/assets-schema";

// ── Chat Schema ────────────────────────────────────────────────────
export type {
  ChatMessage,
  ChatSession,
  ToolCall,
  Mention,
  ToolArtifact as ToolArtifactType,
  ImageArtifact as ImageArtifactType,
  VideoArtifact as VideoArtifactType,
  ErrorEventData as ErrorEventDataType,
} from "@/lib/agents/chat-schema";
export {
  ChatMessageSchema,
  ChatSessionSchema,
  ToolCallSchema,
  MentionSchema,
} from "@/lib/agents/chat-schema";
export type { ToolArtifact, ImageArtifact, VideoArtifact, ErrorEventData } from "@/lib/agents/chat-schema";

// ── WebSocket Schema ───────────────────────────────────────────────
export type {
  WsCommand,
  WsEvent,
} from "@/lib/ws/types";
export {
  WsCommandSchema,
  WsEventSchema,
  WsRpcResponseSchema,
} from "@/lib/ws/types";

// ── Vibeboard File Types ─────────────────────────────────────────────────
export type { VadFileNode } from "@/lib/vad/types";

// ── Provider Config ────────────────────────────────────────────────
export type { ProviderConfig, ResolvedProviders } from "@/lib/providers/registry";

// ── Video Provider Types ───────────────────────────────────────────
export type {
  VideoGenerateInput,
  VideoGenerateOutput,
  VideoProvider,
  VideoJobStatus,
} from "@/lib/providers/video/types";
