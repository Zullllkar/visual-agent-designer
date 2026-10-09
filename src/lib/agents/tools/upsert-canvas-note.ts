/**
 * 在画布上创建或更新脚本 / 文案 / 规则卡片
 */

import {
  isCanvasNoteKind,
  spawnCitedTextNote,
  spawnStandaloneNote,
  upsertCanvasNote,
  type CanvasNoteKind,
} from "@/lib/canvas/canvas-notes";
import { ProjectFileSchema } from "./utils";
import type { AgentTool, ToolContext, ToolResult } from "./types";

export const upsertCanvasNoteTool: AgentTool = {
  name: "upsert_canvas_note",
  description:
    "在画布上创建或更新文本卡片（脚本 / 文案 / 规则 / 笔记）。引用图片生成文字后必须把完整内容写到对应 noteId，不要只停在对话里。",
  inputPhase: ["GENERATION", "REVIEW"],
  outputPhase: "REVIEW",
  riskLevel: "safe",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "已有卡片 id；省略则新建" },
      kind: {
        type: "string",
        enum: ["script", "copy", "rule", "note"],
        description: "卡片类型",
      },
      title: { type: "string", description: "卡片标题" },
      body: { type: "string", description: "卡片正文" },
      parentAssetId: {
        type: "string",
        description: "引用的图片 asset id，新建时可选",
      },
    },
    required: ["body"],
  },

  async execute(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    if (!ctx.project) throw new Error("缺少项目");
    const body = String(args.body ?? "");
    const kindRaw = typeof args.kind === "string" ? args.kind : "note";
    const kind: CanvasNoteKind = isCanvasNoteKind(kindRaw) ? kindRaw : "note";
    const title = typeof args.title === "string" ? args.title : undefined;
    const id = typeof args.id === "string" && args.id.trim() ? args.id.trim() : undefined;
    const parentAssetId =
      typeof args.parentAssetId === "string" && args.parentAssetId.trim()
        ? args.parentAssetId.trim()
        : undefined;
    const now = new Date().toISOString();

    let next = ctx.project;
    let noteId = id;

    if (id && (next.canvasNotes ?? []).some((note) => note.id === id)) {
      next = upsertCanvasNote(next, { id, kind, title, body, now });
    } else if (parentAssetId) {
      const spawned = spawnCitedTextNote(next, parentAssetId, {
        kind,
        id,
        title,
        body,
        now,
      });
      if (!spawned) {
        const standalone = spawnStandaloneNote(next, { kind, id, title, body, now });
        next = standalone.project;
        noteId = standalone.note.id;
      } else {
        next = spawned.project;
        noteId = spawned.note.id;
      }
    } else {
      const standalone = spawnStandaloneNote(next, { kind, id, title, body, now });
      next = standalone.project;
      noteId = standalone.note.id;
    }

    const updated = ProjectFileSchema.parse(next);
    const note = (updated.canvasNotes ?? []).find((item) => item.id === noteId);
    return {
      summary: `已更新画布${note?.kind === "script" ? "脚本" : note?.kind === "copy" ? "文案" : note?.kind === "rule" ? "规则" : "笔记"}卡片 ${noteId?.slice(0, 8)}`,
      updatedProject: updated,
      data: { noteId, kind: note?.kind, title: note?.title },
    };
  },

  async fallback(args, ctx) {
    return this.execute(args, ctx);
  },
};
