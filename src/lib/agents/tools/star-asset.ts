/**
 * star_asset 工具
 * --------------------------------------------------------------
 * 收藏或取消收藏素材，批量操作。
 */

import type { AgentTool, ToolContext, ToolResult } from "./types";
import { ProjectFileSchema } from "./utils";

export const starAssetTool: AgentTool = {
  name: "star_asset",
  description: "收藏或取消收藏素材",
  inputPhase: ["GENERATION", "REVIEW"],
  outputPhase: "REVIEW",
  riskLevel: "safe",
  parameters: {
    type: "object",
    properties: {
      assetId: { type: "string", description: "素材 ID" },
      starred: { type: "boolean", description: "true 收藏，false 取消收藏" },
    },
    required: ["assetId"],
  },

  async execute(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    if (!ctx.project) throw new Error("缺少项目");
    const assetId = args.assetId as string;
    const starred = args.starred !== false;
    const assets = ctx.project.assets ?? [];
    const idx = assets.findIndex((a) => a.id === assetId);
    if (idx === -1) throw new Error(`素材 ${assetId} 不存在`);

    const updatedAssets = [...assets];
    updatedAssets[idx] = {
      ...updatedAssets[idx],
      status: starred ? "starred" : "candidate",
    };
    const updated = ProjectFileSchema.parse({
      ...ctx.project,
      assets: updatedAssets,
      updatedAt: new Date().toISOString(),
    });
    return {
      summary: starred
        ? `已收藏素材 ${assetId.slice(0, 8)}`
        : `已取消收藏素材 ${assetId.slice(0, 8)}`,
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
