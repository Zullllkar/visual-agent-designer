/**
 * plan_design_direction 工具
 * --------------------------------------------------------------
 * 定义视觉方向与设计系统建议。
 */

import { DesignDirectorAgent } from "@/lib/agents/design-director-agent";
import { buildDesignContext } from "@/lib/project/design-context";
import type { AgentTool, ToolContext, ToolResult } from "./types";
import { ProjectFileSchema } from "./utils";

export const planDesignDirectionTool: AgentTool = {
  name: "plan_design_direction",
  description: "定义视觉方向与设计系统建议（不生成网页结构）",
  inputPhase: ["BRIEF"],
  outputPhase: "DIRECTION",
  riskLevel: "safe",
  idempotencyKey: () => "direction",
  parameters: { type: "object", properties: {} },

  async execute(
    _args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    if (!ctx.project?.brief) throw new Error("缺少 brief");
    const architecture = ctx.project.architecture ?? {
      pages: [
        {
          id: "asset-board",
          name: "视觉素材",
          purpose: "画布生图交付",
          priority: "primary" as const,
        },
      ],
      userFlows: ["描述想法 → 生成视觉素材 → 导出交付"],
      summary: "素材交付工作台",
    };
    const designDirection = await DesignDirectorAgent.run(
      { brief: ctx.project.brief, architecture },
      ctx.agentCtx
    );
    ctx.agentCtx.scratch.designDirectionSummary = designDirection.summary;
    const designContext = buildDesignContext({
      brief: ctx.project.brief,
      designDirection,
      designSystemId: ctx.agentCtx.designSystem?.manifest.name,
    });
    ctx.agentCtx.scratch.designContext = designContext;
    const updated = ProjectFileSchema.parse({
      ...ctx.project,
      architecture,
      designDirection,
      designContext,
      updatedAt: new Date().toISOString(),
    });
    return {
      summary: `视觉方向：${designDirection.summary.slice(0, 60)}…`,
      data: { designDirection },
      updatedProject: updated,
      fileWrites: ["design/direction.json"],
    };
  },

  async fallback(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    return this.execute(args, ctx);
  },
};
