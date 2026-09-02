/**
 * answer_question 工具
 * --------------------------------------------------------------
 * 兼容保留：主 Agent 路径已改为直接 thinking + 文字回答。
 * 工具仍可供 fallback / 旧会话调用；stream-adapter 会把结果提升为助手消息。
 */

import { isMockLlmText } from "@/lib/providers/llm/utils";
import {
  deriveDesignContext,
  readDesignContextFromScratch,
  summarizeDesignContext,
} from "@/lib/project/design-context";
import type { ProjectFile } from "@/lib/project/schema";
import type { AgentContext } from "@/lib/agents/types";
import type { AgentTool, ToolContext, ToolResult } from "./types";

export const answerQuestionTool: AgentTool = {
  name: "answer_question",
  description: "（已弃用）纯对话请直接文字回答，勿调用此工具",
  riskLevel: "safe",
  parameters: {
    type: "object",
    properties: {
      question: { type: "string" },
    },
    required: ["question"],
  },

  async execute(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    const question = (args.question as string) ?? ctx.userMessage;
    const out = await ctx.agentCtx.providers.llm.generateText({
      system: composeAnswerSystem(ctx),
      prompt: question,
    });
    const text = isMockLlmText(out.text)
      ? `已收到你的问题："${question}"。请配置真实 LLM 以获得回答。`
      : out.text;
    return { summary: text, data: { text } };
  },

  async fallback(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    return this.execute(args, ctx);
  },
};

export function composeAnswerSystem(ctx: ToolContext): string {
  return composeAnswerSystemFromParts({
    project: ctx.project,
    agentCtx: ctx.agentCtx,
  });
}

export function composeAnswerSystemFromParts(input: {
  project: ProjectFile | null;
  agentCtx: AgentContext;
}): string {
  const { project, agentCtx } = input;
  const lines = [
    "你是产品设计师 Agent，正在和用户对话讨论当前设计项目。",
    "回答简洁，必要时引用现有 pages 的名字或 critique 结论。",
    "不要调用工具；这一轮只做文字回答。",
  ];
  if (agentCtx.skill) {
    lines.push(`当前 Skill: ${agentCtx.skill.manifest.name}`);
  }
  if (agentCtx.designSystem) {
    lines.push(`当前 DesignSystem: ${agentCtx.designSystem.manifest.name}`);
  }
  if (project) {
    const pageNames = project.pages.map((page) => page.name).filter(Boolean);
    lines.push(
      `当前项目: ${project.title}, ${project.pages.length} 页, score=${project.critique?.overallScore ?? "n/a"}`
    );
    if (pageNames.length > 0) {
      lines.push(`已有页面: ${pageNames.join("、")}`);
    }
    const assetCount = (project.assets ?? []).filter(
      (asset) => asset.status !== "discarded"
    ).length;
    if (assetCount > 0) {
      lines.push(`视觉素材: ${assetCount} 张`);
    }
  }
  const designContext = project
    ? deriveDesignContext(project)
    : readDesignContextFromScratch(agentCtx.scratch);
  if (designContext) {
    lines.push(
      `Design Context Memory:\n${summarizeDesignContext(designContext)}`
    );
  }
  return lines.join("\n");
}
