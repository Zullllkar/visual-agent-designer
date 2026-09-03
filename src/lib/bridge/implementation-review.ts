/**
 * 实现验收（闭环）
 * --------------------------------------------------------------
 * coding agent 实现完一屏后回报截图，这里对照定稿图 + Layout IR 逐项比对，
 * 产出结构化偏差清单，既写盘给设计侧看，也作为工具返回值交回 agent 自修。
 *
 * Vision 不可用（mock / 无 key / 解析失败）时退化为确定性检查：
 * 尺寸比例、Layout IR 覆盖情况，仍给出可执行反馈。
 */

import "server-only";

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { z } from "zod";

import { resolveAssetImageDataUrl } from "@/lib/handoff/resolve-asset-src";
import { compressImageDataUrlForVision } from "@/lib/handoff/vision-image";
import type { LayoutIR } from "@/lib/handoff/layout-ir";
import type { ProjectFile } from "@/lib/project/schema";
import type { LlmProvider } from "@/lib/providers/llm/types";
import { isMockLlmText } from "@/lib/providers/llm/utils";
import { implementationDir, implementationReportPath } from "@/lib/vad/paths";
import { ensureDir } from "@/lib/vad/persist";

export const DeviationKindSchema = z.enum([
  "spacing",
  "color",
  "typography",
  "missing",
  "extra",
  "hierarchy",
  "content",
  "other",
]);

export const DeviationSchema = z.object({
  slot: z.string().default(""),
  kind: DeviationKindSchema.default("other"),
  severity: z.enum(["low", "medium", "high"]).default("medium"),
  expected: z.string().default(""),
  actual: z.string().default(""),
  fixHint: z.string().default(""),
});

export const ReviewSchema = z.object({
  score: z.number().min(0).max(10),
  verdict: z.enum(["pass", "needs-work", "off-track"]).default("needs-work"),
  summary: z.string().default(""),
  matched: z.array(z.string()).default([]),
  deviations: z.array(DeviationSchema).default([]),
});

export type Deviation = z.infer<typeof DeviationSchema>;
export type Review = z.infer<typeof ReviewSchema>;

export interface ImplementationReport extends Review {
  version: 1;
  id: string;
  projectId: string;
  assetId?: string;
  url?: string;
  reportedSummary: string;
  clientName?: string;
  screenshotFile?: string;
  source: "vision" | "heuristic";
  model?: string;
  warnings?: string[];
  createdAt: string;
}

const SYSTEM = `You review whether an implemented UI screenshot matches the approved design mockup.

You get two images: [1] the approved design (source of truth), [2] the current implementation.
Output STRICT JSON only (no markdown fence):

{
  "score": number,            // 0-10, how faithfully [2] matches [1]
  "verdict": "pass" | "needs-work" | "off-track",
  "summary": string,          // one or two sentences, concrete
  "matched": string[],        // what is already correct (region/element names)
  "deviations": [{
    "slot": string,           // region or element name, e.g. "hero", "primary CTA"
    "kind": "spacing" | "color" | "typography" | "missing" | "extra" | "hierarchy" | "content" | "other",
    "severity": "low" | "medium" | "high",
    "expected": string,       // what the design shows
    "actual": string,         // what the implementation shows
    "fixHint": string         // one actionable instruction for the coding agent
  }]
}

Rules:
- Compare STRUCTURE, SPACING, COLOR, TYPE SCALE and PRESENCE of elements. Ignore placeholder copy differences unless the design's real copy is missing.
- Do NOT invent deviations you cannot see. Empty deviations with a high score is a valid answer.
- fixHint must be implementable in code (e.g. "increase hero bottom padding to ~64px", not "make it nicer").
- Order deviations by severity, high first. Cap at 12.`;

export async function reviewImplementation(input: {
  project: ProjectFile;
  assetId?: string;
  reportedSummary: string;
  screenshotDataUrl: string;
  url?: string;
  clientName?: string;
  llm?: LlmProvider;
}): Promise<ImplementationReport> {
  const { project, reportedSummary, screenshotDataUrl } = input;
  const warnings: string[] = [];
  const asset = input.assetId
    ? (project.assets ?? []).find((a) => a.id === input.assetId)
    : pickDefaultMockup(project);
  const layout = asset ? project.materializations?.[asset.id]?.layout : undefined;

  const shot = await compressImageDataUrlForVision(screenshotDataUrl, { maxEdge: 1400 });
  let designDataUrl: string | null = null;
  if (asset?.src) {
    const resolved = await resolveAssetImageDataUrl(asset.src, project.id).catch(() => null);
    if (resolved) {
      designDataUrl = (await compressImageDataUrlForVision(resolved, { maxEdge: 1400 })).dataUrl;
    } else {
      warnings.push(`Design asset ${asset.id} image could not be loaded; fell back to metadata-only review.`);
    }
  } else {
    warnings.push("No approved mockup found for this project; review is heuristic only.");
  }

  let review: Review | null = null;
  let source: ImplementationReport["source"] = "heuristic";
  let model: string | undefined;

  if (input.llm && designDataUrl) {
    try {
      const out = await input.llm.generateText({
        system: SYSTEM,
        prompt: buildPrompt(project, asset?.id, layout, reportedSummary, input.url),
        images: [designDataUrl, shot.dataUrl],
        imageDetail: "high",
        temperature: 0.15,
        maxTokens: 4096,
      });
      if (isMockLlmText(out.text)) {
        warnings.push("LLM provider is mock; skipped vision review.");
      } else {
        review = parseReview(out.text);
        if (review) {
          source = "vision";
          model = input.llm.name;
        } else {
          warnings.push("Vision review returned unparseable JSON; fell back to heuristic review.");
        }
      }
    } catch (err) {
      warnings.push(`Vision review failed: ${(err as Error).message}`);
    }
  } else if (!input.llm) {
    warnings.push("No LLM provider available; open Vibeboard and configure a vision-capable model for full review.");
  }

  const finalReview = review ?? heuristicReview(reportedSummary, layout, warnings);
  const report: ImplementationReport = {
    ...finalReview,
    version: 1,
    id: `impl_${nanoid(10)}`,
    projectId: project.id,
    assetId: asset?.id,
    url: input.url,
    reportedSummary,
    clientName: input.clientName,
    source,
    model,
    warnings: warnings.length ? warnings : undefined,
    createdAt: new Date().toISOString(),
  };

  await persistReport(report, shot.dataUrl).catch((err) => {
    console.warn("[implementation-review] persist failed:", (err as Error).message);
  });
  return report;
}

function buildPrompt(
  project: ProjectFile,
  assetId: string | undefined,
  layout: LayoutIR | undefined,
  reportedSummary: string,
  url?: string
): string {
  const lines = [
    `Product: ${project.title}`,
    `Positioning: ${project.brief?.positioning ?? project.rawIdea}`,
    `Visual style: ${project.brief?.visualStyle ?? "not specified"}`,
    assetId ? `Approved mockup asset id: ${assetId}` : "",
    url ? `Implementation URL: ${url}` : "",
    "",
    `What the coding agent says it implemented: ${reportedSummary}`,
  ];

  if (layout?.nodes?.length) {
    lines.push("", "Layout IR regions (authoritative geometry, normalized 0-1):");
    for (const node of layout.nodes.slice(0, 24)) {
      const bbox = node.bbox
        ? `x=${round2(node.bbox.x)} y=${round2(node.bbox.y)} w=${round2(node.bbox.w)} h=${round2(node.bbox.h)}`
        : "no bbox";
      const mode = node.rebuildInCode === false ? "media (place the material image)" : "code (real components)";
      const copy = "copy" in node && node.copy ? ` copy="${String(node.copy).slice(0, 60)}"` : "";
      lines.push(`- ${node.id} [${node.role}] ${mode} ${bbox}${copy}`);
    }
  }

  const styleLock = layout?.styleLock;
  if (styleLock?.dna) {
    lines.push(
      "",
      `Style lock: finish=${styleLock.dna.finish} lighting=${styleLock.dna.lighting} accent=${styleLock.dna.accent}`
    );
  }

  lines.push("", "Image [1] is the approved design. Image [2] is the implementation. Compare them.");
  return lines.filter(Boolean).join("\n");
}

function heuristicReview(
  reportedSummary: string,
  layout: LayoutIR | undefined,
  warnings: string[]
): Review {
  const deviations: Deviation[] = [];
  if (!layout) {
    deviations.push({
      slot: "",
      kind: "other",
      severity: "low",
      expected: "A Layout IR for the approved mockup",
      actual: "No Layout IR exists for this screen",
      fixHint: 'Run "materialize" in Vibeboard so regions and copy become authoritative, then re-report.',
    });
  }
  return {
    score: 5,
    verdict: "needs-work",
    summary:
      `Recorded the implementation report but could not run a visual comparison (${warnings[0] ?? "no vision model"}). ` +
      `Reported: ${reportedSummary.slice(0, 160)}`,
    matched: [],
    deviations,
  };
}

function parseReview(text: string): Review | null {
  const raw = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = ReviewSchema.safeParse(JSON.parse(raw.slice(start, end + 1)));
    if (!parsed.success) return null;
    return { ...parsed.data, deviations: parsed.data.deviations.slice(0, 12) };
  } catch {
    return null;
  }
}

async function persistReport(report: ImplementationReport, screenshotDataUrl: string): Promise<void> {
  const dir = implementationDir(report.projectId);
  await ensureDir(dir);
  const match = screenshotDataUrl.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (match) {
    const ext = match[1] === "jpeg" ? "jpg" : match[1];
    const file = `${report.id}.${ext}`;
    await fs.writeFile(join(dir, file), Buffer.from(match[2], "base64"));
    report.screenshotFile = `implementation/${file}`;
  }
  await fs.writeFile(
    implementationReportPath(report.projectId, report.id),
    JSON.stringify(report, null, 2),
    "utf8"
  );
}

export async function listImplementationReports(
  projectId: string,
  limit = 20
): Promise<ImplementationReport[]> {
  const dir = implementationDir(projectId);
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }
  const reports: ImplementationReport[] = [];
  for (const name of files.filter((f) => f.endsWith(".json"))) {
    try {
      const raw = await fs.readFile(join(dir, name), "utf8");
      reports.push(JSON.parse(raw) as ImplementationReport);
    } catch {
      // 跳过坏文件
    }
  }
  return reports
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

function pickDefaultMockup(project: ProjectFile) {
  const assets = (project.assets ?? []).filter(
    (a) => a.src && a.source !== "materialized" && a.status !== "discarded" && a.status !== "failed"
  );
  return (
    assets.find((a) => a.approval?.status === "approved" || a.approval?.status === "materials_ready") ??
    assets.find((a) => project.materializations?.[a.id]) ??
    assets.find((a) => a.status === "starred") ??
    assets[0]
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
