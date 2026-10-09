import { nanoid } from "nanoid";
import { ProjectFileSchema, type AssetPlanItem } from "@/lib/project/schema";
import type { AgentTool, ToolContext, ToolResult } from "./types";

const ROLES = new Set(["hero", "illustration", "product-shot", "background", "icon", "avatar", "decoration"]);

export const planAssetsTool: AgentTool = {
  name: "plan_assets",
  description: "在生图前建立结构化素材计划。每个素材必须有角色、用途、独立 prompt、尺寸和优先级。",
  inputPhase: ["DIRECTION", "ASSET_PLAN", "GENERATION", "REVIEW"],
  outputPhase: "ASSET_PLAN",
  riskLevel: "safe",
  confirmationPolicy: "auto",
  parameters: {
    type: "object",
    properties: {
      summary: { type: "string", description: "本轮素材计划概述" },
      items: {
        type: "array",
        description: "素材计划列表，每项生成一张候选图",
        items: {
          type: "object",
          properties: {
            role: { type: "string", enum: [...ROLES] },
            purpose: { type: "string" },
            prompt: { type: "string" },
            width: { type: "number" },
            height: { type: "number" },
            priority: { type: "string", enum: ["required", "optional"] },
            referenceIds: { type: "array", items: { type: "string" } },
          },
          required: ["role", "purpose", "prompt"],
        },
      },
    },
    required: ["items"],
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.project) throw new Error("缺少项目，无法规划素材");
    const rawItems = Array.isArray(args.items) ? args.items : [];
    if (rawItems.length === 0) throw new Error("素材计划至少需要一项");
    const now = new Date().toISOString();
    const defaults = ctx.agentCtx.skill?.manifest.output.defaultPageSize ?? { width: 1280, height: 720 };
    const items: AssetPlanItem[] = rawItems.slice(0, 12).map((raw, index) => {
      const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const role = typeof item.role === "string" && ROLES.has(item.role) ? item.role : "illustration";
      const prompt = typeof item.prompt === "string" ? item.prompt.trim() : "";
      if (!prompt) throw new Error(`素材计划第 ${index + 1} 项缺少 prompt`);
      return {
        id: typeof item.id === "string" && item.id ? item.id : `asset-plan-${nanoid(6)}`,
        role: role as AssetPlanItem["role"],
        purpose: typeof item.purpose === "string" && item.purpose ? item.purpose : `${role} visual asset`,
        prompt,
        width: clampSize(item.width, defaults.width),
        height: clampSize(item.height, defaults.height),
        priority: item.priority === "optional" ? "optional" : "required",
        referenceIds: Array.isArray(item.referenceIds) ? item.referenceIds.filter((id): id is string => typeof id === "string") : undefined,
        status: "planned",
      };
    });
    const plan = {
      version: 1 as const,
      summary: typeof args.summary === "string" && args.summary.trim() ? args.summary.trim() : `规划 ${items.length} 项视觉素材`,
      items,
      createdAt: ctx.project.assetPlan?.createdAt ?? now,
      updatedAt: now,
    };
    const updatedProject = ProjectFileSchema.parse({ ...ctx.project, assetPlan: plan, updatedAt: now });
    return {
      summary: `素材计划已建立：${items.length} 项，${items.filter((item) => item.priority === "required").length} 项必需。`,
      data: { assetPlan: plan },
      updatedProject,
    };
  },
};

function clampSize(value: unknown, fallback: number): number {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return Math.max(256, Math.min(4096, Math.round(fallback)));
  return Math.max(256, Math.min(4096, Math.round(n)));
}
