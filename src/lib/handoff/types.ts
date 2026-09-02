/**
 * Handoff Target 抽象（骨架）
 * --------------------------------------------------------------
 * 不同 coding agent 需要的上下文格式不同。第一阶段实现
 * MarkdownHandoffTarget；P2 加 Cursor / Claude Code / Codex。
 */

import type { ProjectFile } from "@/lib/project/schema";

export interface HandoffContext {
  project: ProjectFile;
  requestOrigin?: string;
  /** 渲染后的页面截图（base64 或本地路径）。 */
  screenshots: Array<{ pageId: string; path: string }>;
  /** 图像模型产出的参考图。 */
  aiReferenceImages: Array<{ name: string; path: string; prompt: string }>;
  /** 设计 token，JSON 字符串。 */
  designTokens?: string;
}

export interface HandoffArtifact {
  /**
   * 文件清单。content 可以是 string（文本/JSON/SVG）或 Uint8Array（PNG/JPEG/WEBP 等二进制）。
   * JSZip 同时接受这两种类型，无需特殊处理。
   */
  files: Array<{ path: string; content: string | Uint8Array }>;
}

export interface HandoffTarget {
  name: "cursor" | "claude-code" | "codex" | "markdown";
  build(input: HandoffContext): Promise<HandoffArtifact>;
}
