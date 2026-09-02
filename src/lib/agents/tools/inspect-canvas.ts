/**
 * inspect_canvas 工具
 * --------------------------------------------------------------
 * 返回当前画布上的元素列表和状态，供 Agent 了解画布内容。
 */

import type { AgentTool, ToolContext, ToolResult } from "./types";

export const inspectCanvasTool: AgentTool = {
  name: "inspect_canvas",
  description: "检查当前画布上的所有元素和状态",
  riskLevel: "safe",
  parameters: {
    type: "object",
    properties: {},
  },

  async execute(
    _args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    if (!ctx.project) {
      return { summary: "当前没有打开的项目。" };
    }

    const pages = ctx.project.pages ?? [];
    const assets = (ctx.project.assets ?? []).filter(
      (a) => a.status !== "discarded"
    );

    const pageSummary = pages.map((p) => ({
      id: p.id,
      name: p.name,
      width: p.width,
      height: p.height,
      nodeCount: p.nodes.length,
    }));

    const assetSummary = assets.map((a) => ({
      id: a.id,
      role: a.role,
      status: a.status,
      width: a.width,
      height: a.height,
      prompt: a.prompt.slice(0, 80),
    }));

    const summary = `画布检查：${pages.length} 个页面，${assets.length} 张素材。`;

    return {
      summary,
      data: {
        pages: pageSummary,
        assets: assetSummary,
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

  async fallback(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    return this.execute(args, ctx);
  },
};
