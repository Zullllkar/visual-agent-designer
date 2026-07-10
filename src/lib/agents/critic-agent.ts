/**
 * CriticAgent (text + optional vision)
 * --------------------------------------------------------------
 * 三层评分合流：
 *   1. 几何检查（critic-checks.ts，always on）
 *   2. LLM-text 主观评审（读 canvas JSON，always on if LLM 可用）
 *   3. Vision 评审（rasterize PNG → 视觉模型，仅 ctx.providers.visionCritic=true）
 *
 * 三层 issues 用 source 字段区分（check / llm / vision）。
 * 最终分数取 min(几何分, LLM 分, Vision 分)，避免任何一层"漏判"。
 */

import type { Agent, AgentContext } from "./types";
import type { ProductBrief } from "@/lib/project/schema";
import type { CanvasPage } from "@/lib/canvas/schema";
import {
  CritiqueReportSchema,
  type CritiqueReport,
  type CritiqueIssue,
} from "./critic-schema";
import { runDeterministicChecks, geometryScore } from "./critic-checks";
import { stripJsonFence } from "@/lib/providers/llm/openai-compatible";
import { isMockLlmText } from "@/lib/providers/llm/utils";
import { rasterizePageToDataUrl } from "@/lib/canvas/rasterize";
import {
  buildCriticSystemPrompt,
  buildVisionCriticSystemPrompt,
} from "@/lib/skills/prompt-stack";
import { readDesignContextFromScratch } from "@/lib/project/design-context";

export const CriticAgent: Agent<
  { brief: ProductBrief; pages: CanvasPage[] },
  CritiqueReport[]
> = {
  name: "critic-agent",
  async run({ brief, pages }, ctx) {
    const reports: CritiqueReport[] = [];
    for (const page of pages) {
      const det = runDeterministicChecks(page);

      const llm = await tryLlmCritique(brief, page, ctx).catch(() => null);

      const vision = ctx.providers.visionCritic
        ? await tryVisionCritique(brief, page, ctx).catch(() => null)
        : null;

      const merged = mergeReport(page, det, llm, vision);
      reports.push(merged);
    }
    return reports;
  },
};

async function tryVisionCritique(
  brief: ProductBrief,
  page: CanvasPage,
  ctx: AgentContext
): Promise<CritiqueReport | null> {
  let dataUrl: string;
  try {
    dataUrl = rasterizePageToDataUrl(page, { maxWidth: 1024 });
  } catch {
    // rasterize 失败（系统无中文字体或 native binding 异常）→ 静默跳过
    return null;
  }

  const system = buildVisionCriticSystemPrompt({
    skill: ctx.skill,
    designSystem: ctx.designSystem,
    brief,
    designContext: readDesignContextFromScratch(ctx.scratch),
  });
  const out = await ctx.providers.llm.generateText({
    system,
    prompt: [
      `当前页面：id=${page.id}, ${page.width}×${page.height}, name=${page.name}。`,
      "请基于附图（页面 PNG 截图）输出评审 JSON：",
    ].join("\n"),
    schema: { type: "object" },
    images: [dataUrl],
  });

  if (isMockLlmText(out.text)) return null;
  let json: unknown;
  try {
    json = JSON.parse(stripJsonFence(out.text));
  } catch {
    return null;
  }
  const parsed = CritiqueReportSchema.safeParse(json);
  if (!parsed.success) return null;
  return { ...parsed.data, pageId: page.id };
}

async function tryLlmCritique(
  brief: ProductBrief,
  page: CanvasPage,
  ctx: AgentContext
): Promise<CritiqueReport | null> {
  const system = buildCriticSystemPrompt({
    skill: ctx.skill,
    designSystem: ctx.designSystem,
    brief,
    designContext: readDesignContextFromScratch(ctx.scratch),
  });
  const out = await ctx.providers.llm.generateText({
    system,
    prompt: [
      "待评审页面 canvas JSON：",
      JSON.stringify(page, null, 2),
      "",
      "输出评审 JSON：",
    ].join("\n"),
    schema: { type: "object" },
  });
  if (isMockLlmText(out.text)) return null;
  let json: unknown;
  try {
    json = JSON.parse(stripJsonFence(out.text));
  } catch {
    return null;
  }
  const parsed = CritiqueReportSchema.safeParse(json);
  if (!parsed.success) return null;
  // 强制 pageId 与实际一致，防止模型乱填
  return { ...parsed.data, pageId: page.id };
}

function mergeReport(
  page: CanvasPage,
  det: CritiqueIssue[],
  llm: CritiqueReport | null,
  vision: CritiqueReport | null
): CritiqueReport {
  const llmIssues = (llm?.issues ?? []).map((i) => ({
    ...i,
    source: i.source ?? "llm",
  }));
  const visionIssues = (vision?.issues ?? []).map((i) => ({
    ...i,
    source: i.source ?? "vision",
  }));
  const issues = [...det, ...llmIssues, ...visionIssues];

  // 取 min(几何, LLM, Vision)；缺失分量直接忽略，不参与 min
  const detScore = geometryScore(det);
  const candidateScores = [detScore];
  if (llm !== null) candidateScores.push(llm.score);
  if (vision !== null) candidateScores.push(vision.score);
  const finalScore = Math.min(...candidateScores);

  // Vision 总评优先于 LLM 总评（更贴近图像真实呈现）
  const summary =
    vision?.summary ??
    llm?.summary ??
    (det.length === 0
      ? "几何检查未发现问题。"
      : `几何检查发现 ${det.length} 个问题。`);

  return {
    pageId: page.id,
    score: round1(finalScore),
    summary,
    issues,
  };
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
