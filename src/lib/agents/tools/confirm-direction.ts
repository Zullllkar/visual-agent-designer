/**
 * confirm_direction 工具
 * --------------------------------------------------------------
 * 在视觉方向生成后暂停 Agent，请用户确认或提出调整意见。
 */

import type { AgentTool, ToolContext, ToolResult } from "./types";

export interface DirectionConfirmationData {
  title: string;
  summary: string;
  tone?: string;
  palette?: string;
  typography?: string;
  imageStyle?: string;
}

export const confirmDirectionTool: AgentTool = {
  name: "confirm_direction",
  description:
    "展示视觉方向摘要并请求用户确认。plan_design_direction 完成后、generate_images 前必须调用。" +
    "调用后停止其他工具，等待用户确认；用户要求调整时重新调用 plan_design_direction。",
  inputPhase: ["BRIEF", "DIRECTION"],
  outputPhase: "DIRECTION",
  riskLevel: "safe",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "确认卡片标题" },
      summary: { type: "string", description: "视觉方向完整摘要" },
      tone: { type: "string", description: "视觉调性" },
      palette: { type: "string", description: "配色方向" },
      typography: { type: "string", description: "字体方向" },
      imageStyle: { type: "string", description: "图片/插画风格" },
    },
    required: ["summary"],
  },

  async execute(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    const direction: DirectionConfirmationData = {
      title: String(args.title ?? "视觉方向确认"),
      summary: String(
        args.summary ??
          ctx.project?.designDirection?.summary ??
          ctx.agentCtx.scratch.designDirectionSummary ??
          ""
      ),
      tone: args.tone
        ? String(args.tone)
        : Array.isArray(ctx.project?.designDirection?.moodKeywords)
          ? ctx.project.designDirection.moodKeywords.join("、")
          : undefined,
      palette: args.palette ? String(args.palette) : undefined,
      typography: args.typography
        ? String(args.typography)
        : ctx.project?.designDirection?.typographyNotes,
      imageStyle: args.imageStyle ? String(args.imageStyle) : undefined,
    };

    ctx.agentCtx.scratch.__directionConfirmation = direction;

    return {
      summary: "视觉方向已展示，等待用户确认或调整。",
      data: { confirmationRequired: true },
    };
  },
};
