import { ProjectFileSchema } from "@/lib/project/schema";
import type { AgentTool, ToolContext, ToolResult } from "./types";

export const restoreProjectRevisionTool: AgentTool = {
  name: "restore_project_revision",
  description: "恢复项目最近一次或指定的页面修订版本。用于撤销自动修复或回到评审前状态。",
  inputPhase: ["REVIEW", "REFINEMENT", "HANDOFF"],
  outputPhase: "REVIEW",
  riskLevel: "moderate",
  requiresConfirmation: true,
  parameters: {
    type: "object",
    properties: { revisionId: { type: "string", description: "可选，缺省恢复最近一次修订前的页面" } },
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.project) throw new Error("缺少项目，无法恢复修订");
    const revisions = ctx.project.revisionHistory ?? [];
    if (revisions.length === 0) throw new Error("当前项目没有可恢复的修订");
    const requested = typeof args.revisionId === "string" ? args.revisionId : undefined;
    const revision = requested ? revisions.find((item) => item.id === requested) : revisions[revisions.length - 1];
    if (!revision) throw new Error(`修订 ${requested} 不存在`);
    const now = new Date().toISOString();
    const updated = ProjectFileSchema.parse({
      ...ctx.project,
      pages: revision.pages,
      assets: revision.assets,
      references: revision.references,
      assetPlan: revision.assetPlan,
      designContext: revision.designContext,
      critique: revision.critique,
      critiqueHistory: revision.critiqueHistory,
      approvalPolicy: revision.approvalPolicy,
      revisionHistory: revisions.filter((item) => item.id !== revision.id),
      updatedAt: now,
    });
    return {
      summary: `已恢复修订 ${revision.id}，页面回到 ${new Date(revision.createdAt).toLocaleString("zh-CN")} 前的状态。`,
      data: { revisionId: revision.id, restoredAt: now },
      updatedProject: updated,
    };
  },
};
