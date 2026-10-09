/**
 * Sub-Agent 接口定义
 * --------------------------------------------------------------
 * Sub-Agent 是主 Agent 的下属 Agent，负责特定领域的子任务。
 * 主 Agent 通过 handoff 机制将任务委托给 Sub-Agent。
 */

import type { AgentContext } from "@/lib/agents/types";
import type { ProjectFile } from "@/lib/project/schema";
import type { ProviderConfig } from "@/lib/providers/registry";

export interface SubAgentInput {
  task: string;
  project: ProjectFile | null;
  agentCtx: AgentContext;
  providerConfig: ProviderConfig;
  abortSignal?: AbortSignal;
}

export interface SubAgentOutput {
  contractVersion?: 1;
  status?: "completed" | "failed";
  workflowType?: string;
  durationMs?: number;
  summary: string;
  updatedProject?: ProjectFile | null;
  data?: unknown;
}

export interface SubAgent {
  name: string;
  description: string;
  /**该 Sub-Agent 擅长的任务关键词，用于路由 */
  keywords: string[];
  run(input: SubAgentInput): Promise<SubAgentOutput>;
}
