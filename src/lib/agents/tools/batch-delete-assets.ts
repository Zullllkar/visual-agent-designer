/**
 * batch_delete_assets 工具
 * --------------------------------------------------------------
 * 批量丢弃素材。
 */

import type { AgentTool, ToolContext, ToolResult } from "./types";
import { ProjectFileSchema } from "./utils";

export const batchDeleteAssetsTool: AgentTool = {
  name: "batch_delete_assets",
  description: "批量丢弃素材（标记为 discarded）",
  inputPhase: ["GENERATION", "REVIEW"],
  outputPhase: "REVIEW",
  riskLevel: "destructive",
  requiresConfirmation: true,
  parameters: {
    type: "object",
    properties: {
      assetIds: {
        type: "array",
        items: { type: "string" },
        description: "要丢弃的素材 ID 列表",
      },
    },
    required: ["assetIds"],
  },

  async execute(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    if (!ctx.project) throw new Error("缺少项目");
    const ids = args.assetIds as string[];
    if (!Array.isArray(ids) || ids.length === 0) {
      return { summary: "未提供要删除的素材 ID。" };
    }
    const idSet = new Set(ids);
    const assets = ctx.project.assets ?? [];
    let count = 0;
    const updatedAssets = assets.map((a) => {
      if (idSet.has(a.id) && a.status !== "discarded") {
        count++;
        return { ...a, status: "discarded" as const };
      }
      return a;
    });
    const updated = ProjectFileSchema.parse({
      ...ctx.project,
      assets: updatedAssets,
      updatedAt: new Date().toISOString(),
    });
    return {
      summary: `已批量丢弃 ${count} 个素材`,
      updatedProject: updated,
    };
  },

  async fallback(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    return this.execute(args, ctx);
  },
};
