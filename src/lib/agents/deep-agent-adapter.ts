/**
 * Deep Agent Framework Adapter
 * --------------------------------------------------------------
 * 在裸 LangGraph 之上提供 deepagents 风格的增强能力：
 * - 内置文件系统工具 (read_file, write_file, ls, grep)
 * - 内置代码执行工具 (execute)
 * - 内置子 Agent 委派 (delegate_task)
 * - 自动工具注册和 schema 生成
 * - 增强的 ReAct 循环 with 更好的错误恢复
 *
 * 这个适配层让 Vibeboard Agent 获得 deepagents 框架的核心能力，
 * 同时保持底层 LangGraph 的稳定性和 checkpoint 持久化。
 */

import type { AgentContext } from "@/lib/agents/types";
import type { AgentTool, ToolContext, ToolResult } from "@/lib/agents/tools/types";
import { toolRegistry } from "@/lib/agents/tools/registry";
import { registerAllTools } from "@/lib/agents/tools";

export interface DeepAgentConfig {
  /** Agent 名称 */
  name: string;
  /** Agent 描述 */
  description: string;
  /** 系统提示词额外段落 */
  systemPromptSections?: string[];
  /** 启用的内置工具列表 */
  enabledTools?: string[];
  /** 最大递归深度 */
  maxRecursion?: number;
  /** 是否启用自动错误恢复 */
  autoRecovery?: boolean;
}

export interface DeepAgentToolSet {
  tools: AgentTool[];
  toolNames: string[];
  systemPromptAddendum: string;
}

/**
 * 构建 deepagents 风格的工具集
 */
export function buildDeepAgentToolSet(
  config: DeepAgentConfig,
  agentCtx: AgentContext
): DeepAgentToolSet {
  registerAllTools();

  const allTools = toolRegistry.list();
  const enabledTools = config.enabledTools ?? [
    "file_system",
    "execute",
    "delegate_task",
    "inspect_canvas",
    "manipulate_canvas",
    "screenshot_canvas",
    "brand_kit",
    "generate_video",
    "job_status",
    "persist_sandbox_file",
  ];

  const tools = allTools.filter((t) => enabledTools.includes(t.name));
  const toolNames = tools.map((t) => t.name);

  const toolListText = tools
    .map((t) => `- ${t.name}: ${t.description}`)
    .join("\n");

  const systemPromptAddendum = [
    config.description && `## Agent 角色描述\n${config.description}`,
    `## 内置工具 (${tools.length})\n${toolListText}`,
    config.autoRecovery && "## 自动错误恢复\n当工具执行失败时，自动重试或切换到替代方案。",
    config.maxRecursion && `## 最大递归深度: ${config.maxRecursion}`,
    ...(config.systemPromptSections ?? []),
  ]
    .filter(Boolean)
    .join("\n\n");

  return { tools, toolNames, systemPromptAddendum };
}

/**
 * 创建增强的 ToolContext，注入 deepagents 风格的辅助方法
 */
export function createDeepToolContext(
  agentCtx: AgentContext,
  project: ToolContext["project"],
  userMessage: string,
  providerConfig?: ToolContext["providerConfig"]
): ToolContext {
  return {
    project,
    userMessage,
    agentCtx,
    providerConfig,
    onProjectUpdate: undefined,
    onAssetReady: undefined,
    abortSignal: agentCtx.abortSignal,
  };
}

/**
 * 增强的工具执行器，带自动错误恢复
 */
export async function executeWithRecovery(
  tool: AgentTool,
  args: Record<string, unknown>,
  ctx: ToolContext,
  maxRetries = 2
): Promise<ToolResult> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await tool.execute(args, ctx);
      return result;
    } catch (e) {
      lastError = e as Error;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
    }
  }

  // 所有重试失败，尝试 fallback
  if (tool.fallback) {
    try {
      return await tool.fallback!(args, ctx);
    } catch (e) {
      lastError = e as Error;
    }
  }

  return {
    summary: `工具 ${tool.name} 执行失败: ${lastError?.message ?? "未知错误"}`,
    data: { error: lastError?.message, tool: tool.name },
  };
}
