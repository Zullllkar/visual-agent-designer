import { z } from "zod";
import type { WorkflowType } from "./agent-coordinator";

export const SpecializedWorkflowInputSchema = z.object({
  userInput: z.string().min(1),
  workflowType: z.enum(["complete", "architecture-only", "design-only", "images-only", "quick-prototype"]),
  options: z.object({
    skipImages: z.boolean().optional(),
    maxImages: z.number().int().min(1).max(12).optional(),
    style: z.enum(["minimal", "bold", "corporate"]).optional(),
    brandKit: z.object({ primaryColor: z.string().optional(), fonts: z.array(z.string()).optional() }).optional(),
  }).optional(),
});

export const SpecializedWorkflowOutputSchema = z.object({
  metadata: z.object({
    workflowType: z.enum(["complete", "architecture-only", "design-only", "images-only", "quick-prototype"]),
    totalDuration: z.number().nonnegative(),
    agentExecutions: z.array(z.object({ agentName: z.string(), duration: z.number().nonnegative(), success: z.boolean() })),
    estimatedCostUsd: z.number().nonnegative().optional(),
    progressEvents: z.array(z.object({ stage: z.string(), status: z.enum(["started", "completed", "failed"]), at: z.number() })).optional(),
  }),
}).passthrough();

export type SpecializedWorkflowInput = z.infer<typeof SpecializedWorkflowInputSchema>;
export type SpecializedWorkflowOutput = z.infer<typeof SpecializedWorkflowOutputSchema>;

export function workflowTypeLabel(type: WorkflowType): string {
  return {
    complete: "完整设计",
    "architecture-only": "结构规划",
    "design-only": "视觉方向",
    "images-only": "图片生成",
    "quick-prototype": "快速原型",
  }[type];
}
