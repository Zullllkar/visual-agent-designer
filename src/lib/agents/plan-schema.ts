/**
 * Orchestrator 规划输出 Schema
 * --------------------------------------------------------------
 * LLM 以 JSON 形式输出本轮要执行的工具序列（模拟 tool-calling）。
 *
 * @author：wangjunhua
 */

import { z } from "zod";

export const OrchestratorToolNameSchema = z.enum([
  "generate_brief",
  "plan_architecture",
  "plan_design_direction",
  "generate_layout",
  "polish_content",
  "generate_images",
  "generate_image_variants",
  "restyle_page_images",
  "edit_page",
  "export_handoff",
  "critique_pages",
  "repair_page",
  "answer_question",
]);

export type OrchestratorToolName = z.infer<typeof OrchestratorToolNameSchema>;

export const OrchestratorPlanToolSchema = z.object({
  name: OrchestratorToolNameSchema,
  args: z.record(z.string(), z.unknown()).optional(),
});

export const OrchestratorPlanSchema = z.object({
  thinking: z.string(),
  tools: z.array(OrchestratorPlanToolSchema).min(1).max(12),
});

export type OrchestratorPlan = z.infer<typeof OrchestratorPlanSchema>;
