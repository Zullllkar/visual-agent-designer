import { AgentCoordinator, type WorkflowType } from "@/lib/agents/specialized/agent-coordinator";
import type { SubAgent } from "./types";
import { SpecializedWorkflowInputSchema, SpecializedWorkflowOutputSchema, workflowTypeLabel } from "@/lib/agents/specialized/contracts";

/**
 * Adapter that keeps the specialized coordinator behind delegate_task.
 * LangGraph remains the top-level decision maker; this fixed workflow is
 * invoked only when the parent explicitly delegates a bounded job.
 */
export const specializedWorkflowSubAgent: SubAgent = {
  name: "specialized_workflow",
  description: "运行固定的 Architect / Designer / Image Executor 专业工作流",
  keywords: ["architect", "designer", "image planner", "specialized", "专业工作流", "批量规划"],
  async run(input) {
    if (input.abortSignal?.aborted) throw abortError();
    const startedAt = Date.now();
    const workflow = resolveWorkflow(input.task);
    const llm = input.providerConfig.llm;
    const apiKey = llm && "apiKey" in llm ? String(llm.apiKey ?? "") : "";
    const coordinator = new AgentCoordinator(apiKey);
    const progressEvents: Array<{ stage: string; status: "started" | "completed" | "failed"; at: number }> = [];
    coordinator.setToolContext({
      project: input.project,
      userMessage: input.task,
      agentCtx: input.agentCtx,
      providerConfig: input.providerConfig,
    });
    const request = SpecializedWorkflowInputSchema.parse({
      userInput: input.task,
      workflowType: workflow,
      onProgress: undefined,
    });
    const result = await coordinator.execute({ ...request, onProgress: (event) => {
      progressEvents.push(event);
      const sink = input.agentCtx.scratch.__subAgentProgress;
      if (typeof sink === "function") sink({ ...event, workflowType: workflow });
    } });
    if (input.abortSignal?.aborted) throw abortError();
    const validated = SpecializedWorkflowOutputSchema.parse(result);
    const durationMs = Date.now() - startedAt;
    return {
      contractVersion: 1,
      status: "completed",
      workflowType: workflow,
      durationMs,
      summary: `${workflowTypeLabel(workflow)}专业工作流完成。`,
      data: { ...validated, progressEvents },
    };
  },
};

function abortError(): Error {
  const error = new Error("Specialized Agent 已取消");
  error.name = "AbortError";
  return error;
}

function resolveWorkflow(task: string): WorkflowType {
  const lower = task.toLowerCase();
  if (lower.includes("image") || task.includes("图片") || task.includes("生图")) return "images-only";
  if (lower.includes("direction") || task.includes("视觉方向")) return "design-only";
  if (lower.includes("architecture") || task.includes("架构")) return "architecture-only";
  return "complete";
}
