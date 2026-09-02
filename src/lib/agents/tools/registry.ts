/**
 * 工具注册表
 * --------------------------------------------------------------
 * 统一注册、查询、执行工具。替代 switch-case 分发。
 * 工具执行失败时自动调用 fallback（如果存在）。
 */

import type { LlmToolDefinition } from "@/lib/providers/llm/tool-types";
import type { AgentTool, ToolContext, ToolResult } from "./types";

class ToolRegistry {
  private tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    if (this.tools.has(tool.name)) {
      console.warn(`[ToolRegistry] 工具 "${tool.name}" 已存在，将被覆盖`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  list(): AgentTool[] {
    return [...this.tools.values()];
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  toToolDefinitions(): LlmToolDefinition[] {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`未知工具: ${name}`);
    }
    try {
      return await tool.execute(args, ctx);
    } catch (e) {
      if (tool.fallback) {
        console.warn(
          `[ToolRegistry] 工具 "${name}" 执行失败，启用回退:`,
          (e as Error).message
        );
        return tool.fallback(args, ctx);
      }
      throw e;
    }
  }
}

export const toolRegistry = new ToolRegistry();
