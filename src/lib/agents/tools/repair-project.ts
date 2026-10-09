import { ProjectFileSchema } from "@/lib/project/schema";
import { nanoid } from "nanoid";
import type { CanvasNode } from "@/lib/canvas/schema";
import type { AgentTool, ToolContext, ToolResult } from "./types";
import { buildDeterministicProjectReview } from "./review-project";

/** Applies safe deterministic repairs from the latest Review report. */
export const repairProjectTool: AgentTool = {
  name: "repair_project",
  description: "根据最近一次 Review 自动修复页面越界、异常字号和部分简单布局问题。修复后会重新评审。",
  inputPhase: ["REVIEW", "REFINEMENT"],
  outputPhase: "REFINEMENT",
  riskLevel: "moderate",
  requiresConfirmation: true,
  parameters: {
    type: "object",
    properties: {
      pageId: { type: "string", description: "可选，只修复指定页面" },
      issueCategories: { type: "array", items: { type: "string", enum: ["overflow", "typography", "overlap"] } },
      force: { type: "boolean", description: "用户明确要求继续时跳过自动轮数限制" },
    },
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.project) throw new Error("缺少项目，无法修复");
    const maxRepairRounds = ctx.agentCtx.skill?.manifest.agent.maxRepairRounds ?? 2;
    const usedRepairRounds = (ctx.project.revisionHistory ?? []).filter((revision) => revision.reason === "repair_project").length;
    if (usedRepairRounds >= maxRepairRounds && args.force !== true) {
      return {
        summary: `已达到自动修复上限（${maxRepairRounds} 轮）。请检查当前评审结果后决定是否继续。`,
        data: { repairBlocked: true, reason: "max_repair_rounds", usedRepairRounds, maxRepairRounds },
      };
    }
    const pageId = typeof args.pageId === "string" ? args.pageId : undefined;
    const categories = new Set(Array.isArray(args.issueCategories) ? args.issueCategories.filter((value): value is string => typeof value === "string") : ["overflow", "typography", "overlap"]);
    const pages = (ctx.project.pages ?? []).map((page) => {
      if (pageId && page.id !== pageId) return page;
      const nodes = page.nodes.map((node, index) => repairNode(node, page.width, page.height, categories, index));
      return { ...page, nodes };
    });
    const now = new Date().toISOString();
    const revisionHistory = [
      ...(ctx.project.revisionHistory ?? []),
      {
        id: `rev-${nanoid(8)}`,
        createdAt: now,
        reason: "repair_project",
        pages: ctx.project.pages ?? [],
        assets: ctx.project.assets,
        references: ctx.project.references,
        assetPlan: ctx.project.assetPlan,
        designContext: ctx.project.designContext,
        contextSources: ctx.project.contextSources,
        critique: ctx.project.critique,
        critiqueHistory: ctx.project.critiqueHistory,
        approvalPolicy: ctx.project.approvalPolicy,
      },
    ].slice(-12);
    const updatedProject = ProjectFileSchema.parse({ ...ctx.project, pages, revisionHistory, updatedAt: now });
    const critique = buildDeterministicProjectReview(updatedProject);
    const finalProject = ProjectFileSchema.parse({
      ...updatedProject,
      critique,
      critiqueHistory: [
        ...(updatedProject.critiqueHistory ?? []),
        { round: updatedProject.critiqueHistory?.length ?? 0, overallScore: critique.overallScore, perPage: critique.reports.map((report) => ({ pageId: report.pageId, score: report.score })), accepted: true, generatedAt: critique.generatedAt },
      ],
      updatedAt: critique.generatedAt,
    });
    return {
      summary: `修复完成并重新评审：当前得分 ${critique.overallScore}/10。`,
      data: { critique, repaired: true },
      updatedProject: finalProject,
    };
  },
};

function repairNode(node: CanvasNode, pageWidth: number, pageHeight: number, categories: Set<string>, index: number): CanvasNode {
  let next = { ...node } as CanvasNode;
  if (categories.has("overflow")) {
    const width = Math.min(next.width, pageWidth);
    const height = Math.min(next.height, pageHeight);
    next = { ...next, width, height, x: Math.max(0, Math.min(next.x, pageWidth - width)), y: Math.max(0, Math.min(next.y, pageHeight - height)) } as CanvasNode;
  }
  if (categories.has("typography") && next.type === "text" && next.fontSize !== undefined) {
    next = { ...next, fontSize: Math.max(10, Math.min(96, next.fontSize)) };
  }
  if (categories.has("overlap") && index > 0) {
    // A small deterministic offset reduces accidental exact stacking while
    // preserving the user's overall composition.
    next = { ...next, x: Math.max(0, Math.min(next.x + 8, pageWidth - next.width)), y: Math.max(0, Math.min(next.y + 8, pageHeight - next.height)) } as CanvasNode;
  }
  return next;
}
