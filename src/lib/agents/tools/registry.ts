/**
 * 工具注册表
 * --------------------------------------------------------------
 * 统一注册、查询、执行工具。替代 switch-case 分发。
 * 工具执行失败时自动调用 fallback（如果存在）。
 */

import type { LlmToolDefinition } from "@/lib/providers/llm/tool-types";
import { attachProjectToToolContext } from "@/lib/agents/resolve-agent-project";
import type { AgentTool, ToolContext, ToolResult } from "./types";
import { toolContract } from "../tool-contract";
import type { ConfirmationPolicy } from "./types";
import { costTracker } from "../cost-tracker";

class ToolRegistry {
  private tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    if (this.tools.has(tool.name)) {
      console.warn(`[ToolRegistry] 工具 "${tool.name}" 已存在，将被覆盖`);
    }
    const contract = toolContract(tool.name);
    if (contract) {
      const risk = contract.risk;
      this.tools.set(tool.name, {
        ...tool,
        displayLabel: tool.displayLabel ?? contract.label,
        riskLevel: tool.riskLevel ?? risk,
        confirmationPolicy:
          tool.confirmationPolicy ?? (risk === "safe" ? "auto" : "always"),
      });
      return;
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

  displayLabel(name: string): string {
    return this.tools.get(name)?.displayLabel ?? toolContract(name)?.label ?? name;
  }

  risk(name: string) {
    return this.tools.get(name)?.riskLevel ?? toolContract(name)?.risk ?? "moderate";
  }

  confirmationPolicy(name: string): ConfirmationPolicy {
    const tool = this.tools.get(name);
    if (tool?.confirmationPolicy) return tool.confirmationPolicy;
    return this.risk(name) === "safe" ? "auto" : "always";
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
    const startedAt = Date.now();
    const phase = tool.outputPhase ?? "DISCOVERY";
    const projectId = ctx.agentCtx?.projectId ?? (ctx as ToolContext & { projectId?: string }).projectId ?? ctx.project?.id ?? "untracked";
    try {
      if (ctx.agentCtx) await attachProjectToToolContext(ctx);
      const result = await tool.execute(args, ctx);
      costTracker.record({ runId: ctx.runId ?? "untracked", projectId, toolName: name, phase, durationMs: Date.now() - startedAt, timestamp: Date.now(), success: true });
      return result;
    } catch (e) {
      if (tool.fallback) {
        console.warn(
          `[ToolRegistry] 工具 "${name}" 执行失败，启用回退:`,
          (e as Error).message
        );
        const result = await tool.fallback(args, ctx);
        costTracker.record({ runId: ctx.runId ?? "untracked", projectId, toolName: name, phase, durationMs: Date.now() - startedAt, timestamp: Date.now(), success: false, error: (e as Error).message });
        return result;
      }
      costTracker.record({ runId: ctx.runId ?? "untracked", projectId, toolName: name, phase, durationMs: Date.now() - startedAt, timestamp: Date.now(), success: false, error: (e as Error).message });
      throw e;
    }
  }
}

export const toolRegistry = new ToolRegistry();
