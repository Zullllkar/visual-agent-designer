/**
 * Critic Schema
 * --------------------------------------------------------------
 * 设计批评的结构化输出。可来自：
 *   - 确定性几何检查（critic-checks.ts）：越界、重叠、空页等
 *   - LLM 读 canvas JSON 产出（critic-agent.ts）：层级、文案、品牌一致性
 *   - 后续：vision LLM 看 PNG 截图打分
 *
 * 三类来源用同一份 schema，便于 UI 与 Handoff 直接消费。
 */

import { z } from "zod";

export const CritiqueSeveritySchema = z.enum(["low", "medium", "high"]);

export const CritiqueCategorySchema = z.enum([
  "hierarchy", // 视觉层级：标题/正文/CTA 区分
  "spacing", // 留白与间距
  "typography", // 字号/字重/对齐
  "color", // 配色、对比度
  "content", // 文案与功能不匹配 / 占位文本
  "overlap", // 元素重叠
  "overflow", // 越界 / 超出画布
  "brand", // 品牌一致性 / 视觉风格匹配 brief.visualStyle
  "consistency", // 跨页面一致性
]);

export const CritiqueIssueSchema = z.object({
  severity: CritiqueSeveritySchema,
  category: CritiqueCategorySchema,
  message: z.string(),
  /** 受影响的节点 id 列表。 */
  affectedNodeIds: z.array(z.string()).optional(),
  /** 改进建议；可被后续 RepairAgent 使用。 */
  suggestion: z.string().optional(),
  /** 来源标签：'check' | 'llm' | 'vision'。 */
  source: z.string().optional(),
});

export const CritiqueReportSchema = z.object({
  pageId: z.string(),
  /** 0-10，10 为完美。 */
  score: z.number().min(0).max(10),
  /** 一两句总评。 */
  summary: z.string(),
  issues: z.array(CritiqueIssueSchema),
});

export const ProjectCritiqueSchema = z.object({
  reports: z.array(CritiqueReportSchema),
  /** 项目级总分（一般取各页面平均）。 */
  overallScore: z.number().min(0).max(10),
  generatedAt: z.string(),
});

/**
 * 评审历史中单一一轮的快照。
 * round=0 是初次生成，1+ 是 RepairAgent 修订后的结果。
 * 只存分数，不存全量 pages，避免 localStorage 暴涨。
 */
export const CritiqueHistoryEntrySchema = z.object({
  round: z.number().int().min(0),
  overallScore: z.number().min(0).max(10),
  perPage: z.array(
    z.object({
      pageId: z.string(),
      score: z.number().min(0).max(10),
    })
  ),
  /** 该轮是否被采纳为最终版本（即是否成为了项目当前的 pages）。 */
  accepted: z.boolean(),
  generatedAt: z.string(),
});

export type CritiqueSeverity = z.infer<typeof CritiqueSeveritySchema>;
export type CritiqueCategory = z.infer<typeof CritiqueCategorySchema>;
export type CritiqueIssue = z.infer<typeof CritiqueIssueSchema>;
export type CritiqueReport = z.infer<typeof CritiqueReportSchema>;
export type ProjectCritique = z.infer<typeof ProjectCritiqueSchema>;
export type CritiqueHistoryEntry = z.infer<typeof CritiqueHistoryEntrySchema>;
