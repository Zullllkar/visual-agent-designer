import type { CritiqueIssue, ProjectCritique } from "./critic-schema";

export interface QualityGateSuggestion {
  id: string;
  pageId: string;
  category: CritiqueIssue["category"];
  severity: CritiqueIssue["severity"];
  title: string;
  rationale: string;
  action: "repair_project" | "review_project" | "manual";
  args: Record<string, unknown>;
}

/** Turns critique issues into safe, reviewable actions for the Handoff gate. */
export function buildQualityGateSuggestions(critique?: ProjectCritique): QualityGateSuggestion[] {
  if (!critique) return [];
  return critique.reports.flatMap((report) => report.issues.map((issue, index) => {
    const repairable = issue.category === "overflow" || issue.category === "typography" || issue.category === "overlap";
    return {
      id: `${report.pageId}:${issue.category}:${index}`,
      pageId: report.pageId,
      category: issue.category,
      severity: issue.severity,
      title: issue.suggestion || defaultTitle(issue.category),
      rationale: issue.message,
      action: repairable ? "repair_project" : "manual",
      args: repairable ? { pageId: report.pageId, issueCategories: [issue.category] } : {},
    };
  }));
}

function defaultTitle(category: CritiqueIssue["category"]): string {
  return {
    overflow: "将节点移回画布边界",
    typography: "统一字号并限制极端值",
    overlap: "错开重叠节点",
    hierarchy: "调整标题与正文层级",
    spacing: "重新平衡间距",
    color: "检查颜色对比度",
    content: "补齐或精简文案",
    brand: "对齐品牌视觉方向",
    consistency: "统一跨页面样式",
  }[category];
}
