/**
 * delegate_task 工具
 * --------------------------------------------------------------
 * 主 Agent 通过此工具将子任务委派给专门的 Sub-Agent。
 */

import { nanoid } from "nanoid";
import type { AgentTool, ToolContext, ToolResult } from "./types";
import { subAgentRegistry, registerAllSubAgents } from "@/lib/agents/sub-agents";
import { saveRun } from "@/lib/agents/run-persist";
import type { AgentRun } from "@/lib/agents/agent-run-service";

export const delegateTaskTool: AgentTool = {
  name: "delegate_task",
  description: "将复杂子任务委派给专门的子 Agent（如批量生图、Handoff 导出）",
  riskLevel: "moderate",
  requiresConfirmation: true,
  parameters: {
    type: "object",
    properties: {
      subAgent: {
        type: "string",
        description: "Sub-Agent 名称",
      },
      instruction: {
        type: "string",
        description: "给 Sub-Agent 的任务指令",
      },
    },
    required: ["subAgent", "instruction"],
  },

  async execute(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    registerAllSubAgents();

    const subAgentName = args.subAgent as string;
    const instruction = args.instruction as string;

    const agent = subAgentRegistry.get(subAgentName);
    if (!agent) {
      const available = subAgentRegistry
        .list()
        .map((a) => a.name)
        .join(", ");
      throw new Error(`未知 Sub-Agent: ${subAgentName}。可用: ${available}`);
    }

    // 创建独立子 Run 追踪
    const subRunId = nanoid(12);
    const subRun: AgentRun = {
      runId: subRunId,
      threadId: ctx.agentCtx.projectId,
      projectId: ctx.agentCtx.projectId,
      status: "running",
      startedAt: Date.now(),
      phase: "GENERATION",
      lastHeartbeatAt: Date.now(),
      jobIds: [],
    };
    // 持久化子 Run 状态
    saveRun(ctx.agentCtx.projectId, subRun).catch(() => {});

    try {
      const result = await agent.run({
        task: instruction,
        project: ctx.project,
        agentCtx: ctx.agentCtx,
        providerConfig: ctx.providerConfig ?? {},
      });

      // 更新子 Run 状态为完成
      subRun.status = "completed";
      subRun.endedAt = Date.now();
      saveRun(ctx.agentCtx.projectId, subRun).catch(() => {});

      return {
        summary: result.summary,
        data: { ...(result.data as Record<string, unknown> ?? {}), subRunId },
        updatedProject: result.updatedProject ?? undefined,
      };
    } catch (e) {
      subRun.status = "failed";
      subRun.endedAt = Date.now();
      subRun.error = (e as Error).message;
      saveRun(ctx.agentCtx.projectId, subRun).catch(() => {});
      throw e;
    }
  },

  async fallback(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    return this.execute(args, ctx);
  },
};
