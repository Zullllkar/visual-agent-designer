/**
 * generate_brief 工具
 * --------------------------------------------------------------
 * 从用户想法生成结构化 ProductBrief。
 */

import { BriefAgent } from "@/lib/agents/brief-agent";
import { buildDesignContext } from "@/lib/project/design-context";
import type { AgentTool, ToolContext, ToolResult } from "./types";
import { nanoid, ProjectFileSchema, slugify } from "./utils";
import { getTargetRecipe } from "@/lib/targets/catalog";
import {
  extractTargetIdFromDiscoveryAnswer,
  resolveTargetId,
} from "@/lib/targets/resolve";

export const generateBriefTool: AgentTool = {
  name: "generate_brief",
  description: "按当前视觉目标裁剪字段，从用户想法生成结构化 Brief",
  inputPhase: ["INIT", "DISCOVERY"],
  outputPhase: "BRIEF",
  riskLevel: "safe",
  idempotencyKey: () => "brief",
  parameters: {
    type: "object",
    properties: {
      idea: { type: "string", description: "用户产品想法原文" },
    },
    required: ["idea"],
  },

  async execute(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    const idea = (args.idea as string) ?? ctx.userMessage;
    const targetId =
      extractTargetIdFromDiscoveryAnswer(idea) ?? resolveTargetId(ctx.project);
    const brief = await BriefAgent.run({ idea, targetId }, ctx.agentCtx);
    const now = new Date().toISOString();
    const designContext =
      ctx.project?.designContext ??
      buildDesignContext({
        brief,
        targetId,
        designSystemId: ctx.agentCtx.designSystem?.manifest.name,
        now,
      });
    ctx.agentCtx.scratch.designContext = designContext;
    const updated = ProjectFileSchema.parse({
      ...ctx.project,
      id: ctx.project?.id ?? nanoid(10),
      slug: ctx.project?.slug ?? slugify(brief.productName) ?? nanoid(10),
      title: brief.productName,
      rawIdea: ctx.project?.rawIdea || idea,
      createdAt: ctx.project?.createdAt ?? now,
      updatedAt: now,
      brief,
      designContext,
      pages: ctx.project?.pages ?? [],
      critique: ctx.project?.critique,
      critiqueHistory: ctx.project?.critiqueHistory,
      skillId: ctx.agentCtx.skill?.manifest.name ?? ctx.project?.skillId,
      designSystemId:
        ctx.agentCtx.designSystem?.manifest.name ?? ctx.project?.designSystemId,
      targetId,
      targetLocked: extractTargetIdFromDiscoveryAnswer(idea)
        ? true
        : ctx.project?.targetLocked,
      directionCardId: ctx.project?.directionCardId,
      assets: ctx.project?.assets,
      references: ctx.project?.references,
    });
    return {
      summary: `Brief 已生成：${brief.productName}（${getTargetRecipe(targetId).label}）`,
      data: { brief },
      updatedProject: updated,
      fileWrites: ["design/project.json"],
    };
  },

  async fallback(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    return this.execute(args, ctx);
  },
};
