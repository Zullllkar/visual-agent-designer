/**
 * Orchestrator 工具定义（OpenAI function calling）
 * --------------------------------------------------------------
 * Lovart 式：Brief → 视觉方向 → 生图素材 → Handoff。
 * 网页结构工具保留在 schema 枚举中以兼容旧计划，但规划器不再暴露。
 *
 * @author：wangjunhua
 */

import type { LlmToolDefinition } from "@/lib/providers/llm/tool-types";

export const ORCHESTRATOR_TOOL_DEFINITIONS: LlmToolDefinition[] = [
  {
    name: "generate_brief",
    description: "从用户想法生成结构化 ProductBrief",
    parameters: {
      type: "object",
      properties: {
        idea: { type: "string", description: "用户产品想法原文" },
      },
      required: ["idea"],
    },
  },
  {
    name: "plan_design_direction",
    description: "定义视觉方向与设计系统建议（不生成网页结构）",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "generate_images",
    description: "在无限画布上生成独立高保真视觉素材图（非网页结构框）",
    parameters: {
      type: "object",
      properties: {
        count: { type: "number", description: "生成张数，默认 4，范围 2–8" },
        n: { type: "number", description: "同 count" },
      },
    },
  },
  {
    name: "generate_image_variants",
    description: "为已有视觉素材生成多张变体候选",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "变体/重绘指令" },
        targetAssetId: { type: "string", description: "父素材 id" },
        n: { type: "number", description: "候选数量，默认 4" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "restyle_page_images",
    description: "按指令为现有素材批量换风格（兼容旧工具名）",
    parameters: {
      type: "object",
      properties: {
        instruction: { type: "string", description: "统一风格指令" },
        n: { type: "number" },
      },
      required: ["instruction"],
    },
  },
  {
    name: "export_handoff",
    description: "编译视觉素材交付包（assets + prompts + Brief/tokens）给 coding 工具",
    parameters: {
      type: "object",
      properties: {
        target: {
          type: "string",
          enum: ["cursor", "claude-code", "codex", "markdown"],
        },
      },
    },
  },
  {
    name: "answer_question",
    description: "纯对话回答，不修改项目",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string" },
      },
      required: ["question"],
    },
  },
];

/** 编排规划用工具列表（仅活跃工具） */
export const ORCHESTRATOR_TOOLS_FOR_PLANNER = ORCHESTRATOR_TOOL_DEFINITIONS;
