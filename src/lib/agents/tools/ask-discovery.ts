/**
 * ask_discovery 工具
 * --------------------------------------------------------------
 * 让 Agent 在空白项目时先向用户提出结构化问题，
 * 收集需求后再执行 generate_brief → plan_design_direction → confirm_direction。
 *
 * 工具执行时将问题存入 agentCtx.scratch.__discoveryQuestions，
 * stream-adapter 检测到该工具完成后会发射 discovery.questions 事件到前端。
 * 工具返回提示词告诉 LLM "已提问，等待用户回复"，
 * LLM 自然停止本轮对话，等用户下一条消息再继续。
 */

import type { AgentTool, ToolContext, ToolResult } from "./types";
import {
  buildDefaultDiscoveryForm,
  buildDirectionAdjustForm,
  isDirectionAdjustMessage,
} from "../discovery-gate";

export interface DiscoveryQuestion {
  id: string;
  label: string;
  type: "radio" | "checkbox" | "text" | "textarea";
  required?: boolean;
  options?: string[];
  optionLabels?: Record<string, string>;
  default?: string | string[];
  maxSelections?: number;
  placeholder?: string;
}

export interface DiscoveryFormData {
  title: string;
  description?: string;
  questions: DiscoveryQuestion[];
}

export const askDiscoveryTool: AgentTool = {
  name: "ask_discovery",
  description:
    "向用户提出结构化确认表单（进场需求或调整视觉方向）。" +
    "空白项目缺类型/风格时用需求表；用户要调整方向时用方向调整表。" +
    "每题必须带推荐 default；调用后立即停止。禁止改用助手正文编号提问。",
  inputPhase: ["INIT", "DISCOVERY", "BRIEF", "DIRECTION", "GENERATION", "REVIEW"],
  outputPhase: "DISCOVERY",
  riskLevel: "safe",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "问题表单标题，如「快速需求确认 — 30秒」" },
      description: { type: "string", description: "表单描述/引导语" },
      questions: {
        type: "array",
        description: "结构化问题列表（3-5个）",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "问题唯一标识，如 productType" },
            label: { type: "string", description: "问题标签，如「要做什么？」" },
            type: { type: "string", enum: ["radio", "checkbox", "text", "textarea"], description: "问题类型" },
            required: { type: "boolean", description: "是否必填" },
            options: { type: "array", items: { type: "string" }, description: "选项列表（radio/checkbox用）" },
            maxSelections: { type: "number", description: "最多选几项（checkbox用）" },
            placeholder: { type: "string", description: "占位提示文本" },
          },
          required: ["id", "label", "type"],
        },
      },
    },
    required: ["title", "questions"],
  },

  async execute(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    const incoming = Array.isArray(args.questions)
      ? (args.questions as DiscoveryQuestion[])
      : [];
    const fallback =
      incoming.length > 0
        ? null
        : isDirectionAdjustMessage(ctx.userMessage)
          ? buildDirectionAdjustForm(
              ctx.project?.designDirection?.summary,
              ctx.project?.targetId
            )
          : buildDefaultDiscoveryForm(ctx.userMessage, ctx.project?.targetId);
    const formData: DiscoveryFormData = {
      title: String(args.title ?? fallback?.title ?? "快速需求确认 — 30秒"),
      description: args.description
        ? String(args.description)
        : fallback?.description,
      questions: incoming.length > 0 ? incoming : (fallback?.questions ?? []),
    };

    // 存入 scratch，stream-adapter 会读取并发射事件
    ctx.agentCtx.scratch.__discoveryQuestions = formData;

    return {
      summary: `已向用户提出 ${formData.questions.length} 个需求确认问题，等待用户回复。`,
      data: {
        questionsAsked: true,
        questionCount: formData.questions.length,
      },
    };
  },
};
