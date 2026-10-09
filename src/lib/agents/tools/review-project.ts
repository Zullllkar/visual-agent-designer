import { ProjectFileSchema } from "./utils";
import type { AgentTool, ToolContext, ToolResult } from "./types";
import { runDeterministicChecks, geometryScore } from "../critic-checks";
import type { CritiqueHistoryEntry, ProjectCritique } from "../critic-schema";
import { runVisionCritic } from "../vision-critic";
import { buildQualityGateSuggestions } from "../quality-gate";

export function buildDeterministicProjectReview(project: ProjectFileLike): ProjectCritique {
  const pages = project.pages ?? [];
  const reports = pages.map((page) => {
    const issues = runDeterministicChecks(page);
    return {
      pageId: page.id,
      score: geometryScore(issues),
      summary: issues.length === 0 ? "结构检查通过，可继续进行视觉评审。" : `发现 ${issues.length} 个需要关注的问题。`,
      issues,
    };
  });
  const overallScore = reports.length === 0 ? 0 : Math.round((reports.reduce((sum, report) => sum + report.score, 0) / reports.length) * 10) / 10;
  return { reports, overallScore, generatedAt: new Date().toISOString() };
}

type ProjectFileLike = { pages?: Parameters<typeof runDeterministicChecks>[0][] };

/** Deterministic review that always works, even when a vision model is unavailable. */
export const reviewProjectTool: AgentTool = {
  name: "review_project",
  description: "评审当前项目的画布结构、越界、重叠、空页面和文字可读性，并返回可执行的修复建议。生成或修改后应调用。",
  inputPhase: ["GENERATION", "REVIEW", "REFINEMENT"],
  outputPhase: "REVIEW",
  riskLevel: "safe",
  confirmationPolicy: "auto",
  parameters: {
    type: "object",
    properties: {
      pageId: { type: "string", description: "可选，只评审指定页面" },
    },
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.project) throw new Error("缺少项目，无法评审");
    const requested = typeof args.pageId === "string" ? args.pageId : undefined;
    const pages = (ctx.project.pages ?? []).filter((page) => !requested || page.id === requested);
    if (pages.length === 0) throw new Error("没有找到可评审的页面");
    const deterministic = buildDeterministicProjectReview({ pages });
    const visionReports = await Promise.all(
      pages.map(async (page) => {
        try {
          return await runVisionCritic(page, ctx.agentCtx);
        } catch (error) {
          console.warn(`[review_project] vision critic failed for ${page.id}:`, error);
          return null;
        }
      }),
    );
    const reports = deterministic.reports.map((report, index) => {
      const vision = visionReports[index];
      if (!vision) return report;
      return {
        ...report,
        score: Math.round(((report.score + vision.score) / 2) * 10) / 10,
        summary: `${report.summary} ${vision.summary}`.trim(),
        issues: [...report.issues, ...vision.issues],
      };
    });
    const critique: ProjectCritique = {
      reports,
      overallScore: reports.length ? Math.round((reports.reduce((sum, report) => sum + report.score, 0) / reports.length) * 10) / 10 : 0,
      generatedAt: new Date().toISOString(),
    };
    const overallScore = critique.overallScore;
    const previous = ctx.project.critiqueHistory ?? [];
    const history: CritiqueHistoryEntry[] = [
      ...previous,
      {
        round: previous.length,
        overallScore,
        perPage: reports.map((report) => ({ pageId: report.pageId, score: report.score })),
        accepted: true,
        generatedAt: critique.generatedAt,
      },
    ];
    const updatedProject = ProjectFileSchema.parse({
      ...ctx.project,
      critique,
      critiqueHistory: history,
      updatedAt: critique.generatedAt,
    });
    return {
      summary: `评审完成：${overallScore}/10，${reports.reduce((sum, report) => sum + report.issues.length, 0)} 个问题。`,
      data: {
        critique,
        qualityGate: {
          status: overallScore >= (ctx.agentCtx.skill?.manifest.agent.repairThreshold ?? 8) ? "pass" : "needs-repair",
          suggestions: buildQualityGateSuggestions(critique),
        },
        repairable: reports.some((report) => report.issues.length > 0),
        repairRecommended: overallScore < (ctx.agentCtx.skill?.manifest.agent.repairThreshold ?? 8),
        repairThreshold: ctx.agentCtx.skill?.manifest.agent.repairThreshold ?? 8,
      },
      updatedProject,
    };
  },
};
