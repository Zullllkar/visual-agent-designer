/**
 * persist_sandbox_file 工具
 * --------------------------------------------------------------
 * 将 Agent 生成的文件持久化到 .vad/projects/<id>/ 目录。
 * 支持文本文件和 base64 图片文件。
 */

import { promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { AgentTool, ToolContext, ToolResult } from "./types";
import { projectDir } from "@/lib/vad/paths";
import { ensureDir } from "@/lib/vad/persist";
import { EDITABLE_PREFIXES, EDITABLE_EXTENSIONS } from "@/lib/vad/paths";

export const persistSandboxFileTool: AgentTool = {
  name: "persist_sandbox_file",
  description:
    "将生成的文件持久化到项目目录，支持文本和 base64 图片。用于保存 Agent 产出的设计稿、文档等。",
  riskLevel: "moderate",
  requiresConfirmation: true,
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "相对路径（如 design/output.md, handoff/readme.txt）",
      },
      content: {
        type: "string",
        description: "文本文件内容",
      },
      base64: {
        type: "string",
        description: "base64 编码的图片数据（不含 data: 前缀）",
      },
      mimeType: {
        type: "string",
        description: "base64 模式下的 MIME 类型（如 image/png）",
      },
    },
    required: ["path"],
  },

  async execute(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    const projectId = ctx.agentCtx.projectId;
    const relPath = args.path as string;
    const content = args.content as string | undefined;
    const base64 = args.base64 as string | undefined;
    const mimeType = args.mimeType as string | undefined;

    if (!relPath) throw new Error("persist_sandbox_file 需要 path 参数");

    // 安全检查
    const normalized = relPath.replace(/\\/g, "/");
    if (normalized.includes("..") || normalized.startsWith("/")) {
      throw new Error("invalid_path: 路径不能包含 .. 或以 / 开头");
    }

    // 检查路径是否可编辑
    const allowedPrefix = EDITABLE_PREFIXES.some((p) => normalized.startsWith(p));
    const allowedExt = EDITABLE_EXTENSIONS.some((e) => normalized.endsWith(e)) ||
      normalized.endsWith(".png") ||
      normalized.endsWith(".jpg") ||
      normalized.endsWith(".jpeg") ||
      normalized.endsWith(".webp") ||
      normalized.endsWith(".svg");
    if (!allowedPrefix && !allowedExt) {
      throw new Error(`path_not_editable: ${relPath} 不在允许的路径/扩展名范围内`);
    }

    const full = resolve(projectDir(projectId), relPath);
    const base = resolve(projectDir(projectId));
    if (!full.startsWith(base)) throw new Error("invalid_path");

    await ensureDir(dirname(full));

    if (base64) {
      const ext = mimeType?.split("/")[1] ?? "png";
      const buffer = Buffer.from(base64, "base64");
      await fs.writeFile(full, buffer);
      return {
        summary: `已持久化图片文件 ${relPath} (${buffer.length} bytes)`,
        fileWrites: [relPath],
      };
    }

    if (content !== undefined) {
      await fs.writeFile(full, content, "utf8");
      return {
        summary: `已持久化文件 ${relPath} (${content.length} 字符)`,
        fileWrites: [relPath],
      };
    }

    throw new Error("persist_sandbox_file 需要 content 或 base64 参数");
  },

  async fallback(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    return this.execute(args, ctx);
  },
};
