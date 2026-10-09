/**
 * inspect_canvas 工具
 * --------------------------------------------------------------
 * 返回当前画布上的元素列表和状态，供 Agent 了解画布内容。
 */

import { summarizeCanvasNotes } from "@/lib/canvas/canvas-notes";
import { isGeneratingPlaceholderSrc } from "@/lib/canvas/generating-placeholder";
import type { ImageAsset } from "@/lib/project/assets-schema";
import type { CanvasNote } from "@/lib/project/schema";
import { displayAssetTitle } from "@/lib/project/asset-title";
import type { AgentTool, ToolContext, ToolResult } from "./types";

export type InspectedSrcKind = "image" | "placeholder" | "empty";

export interface InspectedAsset {
  id: string;
  title: string;
  role?: ImageAsset["role"];
  status: string;
  width: number;
  height: number;
  srcKind: InspectedSrcKind;
  ready: boolean;
  prompt: string;
}

export function classifyInspectAsset(asset: ImageAsset): InspectedAsset {
  const status = asset.status ?? "candidate";
  const src = asset.src ?? "";
  const srcKind: InspectedSrcKind = !src.trim()
    ? "empty"
    : isGeneratingPlaceholderSrc(src)
      ? "placeholder"
      : "image";
  const ready =
    srcKind === "image" &&
    status !== "failed" &&
    status !== "cancelled" &&
    status !== "generating" &&
    status !== "discarded";
  return {
    id: asset.id,
    title: displayAssetTitle(asset),
    role: asset.role,
    status,
    width: asset.width,
    height: asset.height,
    srcKind,
    ready,
    prompt: asset.prompt.slice(0, 80),
  };
}

export function inspectCanvasNotes(notes: CanvasNote[] | undefined) {
  return (notes ?? []).map((note) => ({
    id: note.id,
    kind: note.kind,
    title: note.title,
    bodyPreview: note.body.slice(0, 120),
    parentAssetId: note.parentAssetId ?? null,
  }));
}

export function summarizeInspectedAssets(items: InspectedAsset[]): {
  ready: number;
  generating: number;
  failed: number;
  placeholder: number;
} {
  return {
    ready: items.filter((item) => item.ready).length,
    generating: items.filter((item) => item.status === "generating").length,
    failed: items.filter((item) => item.status === "failed" || item.status === "cancelled").length,
    placeholder: items.filter((item) => item.srcKind === "placeholder").length,
  };
}

export const inspectCanvasTool: AgentTool = {
  name: "inspect_canvas",
  description:
    "检查当前画布上的所有元素和状态。以 srcKind 为准：image 是已出图，placeholder 才是生成占位。不要用 320x240 宽高判断失败。",
  riskLevel: "safe",
  parameters: {
    type: "object",
    properties: {},
  },

  async execute(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.project) {
      return { summary: "当前没有打开的项目。" };
    }

    const pages = ctx.project.pages ?? [];
    const assets = (ctx.project.assets ?? []).filter((a) => a.status !== "discarded");
    const assetSummary = assets.map(classifyInspectAsset);
    const counts = summarizeInspectedAssets(assetSummary);
    const notes = inspectCanvasNotes(ctx.project.canvasNotes);
    const noteCounts = summarizeCanvasNotes(ctx.project.canvasNotes);

    const pageSummary = pages.map((p) => ({
      id: p.id,
      name: p.name,
      width: p.width,
      height: p.height,
      nodeCount: p.nodes.length,
    }));

    const notePart =
      noteCounts.total > 0
        ? `，${noteCounts.total} 张文本卡片（脚本 ${noteCounts.byKind.script} / 文案 ${noteCounts.byKind.copy} / 规则 ${noteCounts.byKind.rule}）`
        : "";
    const summary = `画布检查：${pages.length} 个页面，${assets.length} 张素材（已出图 ${counts.ready}，生成中 ${counts.generating}，失败 ${counts.failed}）${notePart}。以 srcKind 为准：image=真实出图，placeholder=生成占位；不要用 320x240 判断失败。`;

    return {
      summary,
      data: {
        pages: pageSummary,
        assets: assetSummary,
        notes,
        noteCounts,
        counts,
        brief: ctx.project.brief
          ? {
              productName: ctx.project.brief.productName,
              platform: ctx.project.brief.platform,
              visualStyle: ctx.project.brief.visualStyle,
            }
          : null,
        designDirection: ctx.project.designDirection
          ? {
              summary: ctx.project.designDirection.summary,
              moodKeywords: ctx.project.designDirection.moodKeywords,
            }
          : null,
      },
    };
  },

  async fallback(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    return this.execute(args, ctx);
  },
};
