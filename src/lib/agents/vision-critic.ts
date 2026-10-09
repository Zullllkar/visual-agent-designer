import "server-only";

import { rasterizePageToDataUrl } from "@/lib/canvas/rasterize";
import type { CanvasPage } from "@/lib/canvas/schema";
import type { AgentContext } from "./types";
import type { CritiqueIssue } from "./critic-schema";

export interface VisionCritiqueResult {
  score: number;
  summary: string;
  issues: CritiqueIssue[];
}

/** Optional multimodal critic. It is deliberately isolated so providers can be swapped without changing review_project. */
export async function runVisionCritic(page: CanvasPage, ctx: AgentContext): Promise<VisionCritiqueResult | null> {
  if (!ctx.providers.visionCritic) return null;
  const image = rasterizePageToDataUrl(page, { maxWidth: 1200 });
  const response = await ctx.providers.llm.generateText({
    system: [
      "You are a senior visual design critic.",
      "Review the screenshot against the project brief and design direction.",
      "Return JSON only: {score: number 0-10, summary: string, issues: [{severity:'low'|'medium'|'high', category, message, suggestion}]}.",
      "Focus on hierarchy, spacing, typography, color, content, brand consistency and visual polish.",
      "Do not invent implementation details that cannot be seen in the screenshot.",
    ].join("\n"),
    prompt: `Page: ${page.name}\nCanvas: ${page.width}x${page.height}`,
    images: [image],
    imageDetail: "high",
    temperature: 0.15,
    maxTokens: 3000,
  });
  const parsed = parseVisionResponse(response.text);
  if (!parsed) return null;
  return {
    score: clampScore(parsed.score),
    summary: parsed.summary || "视觉评审完成。",
    issues: Array.isArray(parsed.issues)
      ? parsed.issues.map((issue) => ({
          severity: issue.severity === "high" || issue.severity === "medium" ? issue.severity : "low",
          category: normalizeCategory(issue.category),
          message: String(issue.message ?? "视觉问题"),
          affectedNodeIds: Array.isArray(issue.affectedNodeIds)
            ? issue.affectedNodeIds.filter((id): id is string => typeof id === "string")
            : undefined,
          suggestion: issue.suggestion ? String(issue.suggestion) : undefined,
          source: "vision",
        }))
      : [],
  };
}

function parseVisionResponse(text: string): { score?: number; summary?: string; issues?: Array<Record<string, unknown>> } | null {
  const raw = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" ? value as { score?: number; summary?: string; issues?: Array<Record<string, unknown>> } : null;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as { score?: number; summary?: string; issues?: Array<Record<string, unknown>> };
    } catch {
      return null;
    }
  }
}

function clampScore(value: unknown): number {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(10, Math.round(score * 10) / 10)) : 0;
}

function normalizeCategory(value: unknown): CritiqueIssue["category"] {
  const categories: CritiqueIssue["category"][] = ["hierarchy", "spacing", "typography", "color", "content", "overlap", "overflow", "brand", "consistency"];
  return typeof value === "string" && categories.includes(value as CritiqueIssue["category"]) ? value as CritiqueIssue["category"] : "hierarchy";
}
