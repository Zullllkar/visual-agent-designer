/**
 * 工具成本统计
 * --------------------------------------------------------------
 * 跟踪 Agent 运行中的工具调用成本（API 调用费用、执行时间等）。
 * 支持按 Run、按工具、按项目汇总成本。
 */

import "server-only";

import type { AgentPhase } from "@/lib/agents/agent-phase";

/** 单次工具调用成本记录 */
export interface ToolCostRecord {
  /** 记录 ID */
  id: string;
  /** 关联的 Run ID */
  runId: string;
  /** 项目 ID */
  projectId: string;
  /** 工具名称 */
  toolName: string;
  /** 调用阶段 */
  phase: AgentPhase;
  /** 执行时长（毫秒） */
  durationMs: number;
  /** 估算成本（美元） */
  costUsd: number;
  /** 调用时间戳 */
  timestamp: number;
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
}

/** Run 成本汇总 */
export interface RunCostSummary {
  runId: string;
  totalCostUsd: number;
  totalDurationMs: number;
  toolCallCount: number;
  byTool: Record<string, { count: number; costUsd: number; durationMs: number }>;
}

/** 项目成本汇总 */
export interface ProjectCostSummary {
  projectId: string;
  totalCostUsd: number;
  totalDurationMs: number;
  totalToolCalls: number;
  runCount: number;
  byPhase: Record<string, { count: number; costUsd: number }>;
}

/** 工具成本估算规则 */
const TOOL_COST_ESTIMATES: Record<string, { perCallUsd: number; perMsUsd?: number }> = {
  generate_images: { perCallUsd: 0.04, perMsUsd: 0.000001 },
  generate_image_variants: { perCallUsd: 0.04, perMsUsd: 0.000001 },
  restyle_page_images: { perCallUsd: 0.04, perMsUsd: 0.000001 },
  adopt_asset_style: { perCallUsd: 0.04, perMsUsd: 0.000001 },
  generate_video: { perCallUsd: 0.15, perMsUsd: 0.000002 },
  generate_brief: { perCallUsd: 0.01, perMsUsd: 0.0000005 },
  plan_design_direction: { perCallUsd: 0.01, perMsUsd: 0.0000005 },
  export_handoff: { perCallUsd: 0.005 },
  /** 基础拆解费；实际常按槽数叠加，见 estimateMaterializeCostUsd */
  materialize_mockup: { perCallUsd: 0.02, perMsUsd: 0.000002 },
  execute: { perCallUsd: 0, perMsUsd: 0.0000001 },
  delegate_task: { perCallUsd: 0.02 },
  // 默认：无 API 调用的工具
  _default: { perCallUsd: 0 },
};

export function estimateToolCostUsd(toolName: string, durationMs = 0): number {
  const estimate = TOOL_COST_ESTIMATES[toolName] ?? TOOL_COST_ESTIMATES._default;
  return estimate.perCallUsd + (estimate.perMsUsd ?? 0) * durationMs;
}

class CostTracker {
  private records: ToolCostRecord[] = [];

  /** 记录一次工具调用成本 */
  record(input: Omit<ToolCostRecord, "id" | "costUsd"> & { costUsd?: number }): void {
    const costUsd = input.costUsd ?? estimateToolCostUsd(input.toolName, input.durationMs);

    this.records.push({
      id: `${input.runId}_${input.toolName}_${input.timestamp}`,
      runId: input.runId,
      projectId: input.projectId,
      toolName: input.toolName,
      phase: input.phase,
      durationMs: input.durationMs,
      costUsd,
      timestamp: input.timestamp,
      success: input.success,
      error: input.error,
    });
  }

  /** 获取 Run 成本汇总 */
  getRunSummary(runId: string): RunCostSummary {
    const runRecords = this.records.filter((r) => r.runId === runId);
    const byTool: Record<string, { count: number; costUsd: number; durationMs: number }> = {};

    let totalCost = 0;
    let totalDuration = 0;

    for (const r of runRecords) {
      if (!byTool[r.toolName]) {
        byTool[r.toolName] = { count: 0, costUsd: 0, durationMs: 0 };
      }
      byTool[r.toolName].count++;
      byTool[r.toolName].costUsd += r.costUsd;
      byTool[r.toolName].durationMs += r.durationMs;
      totalCost += r.costUsd;
      totalDuration += r.durationMs;
    }

    return {
      runId,
      totalCostUsd: totalCost,
      totalDurationMs: totalDuration,
      toolCallCount: runRecords.length,
      byTool,
    };
  }

  /** 获取项目成本汇总 */
  getProjectSummary(projectId: string): ProjectCostSummary {
    const projectRecords = this.records.filter((r) => r.projectId === projectId);
    const runIds = new Set(projectRecords.map((r) => r.runId));
    const byPhase: Record<string, { count: number; costUsd: number }> = {};

    let totalCost = 0;
    let totalDuration = 0;

    for (const r of projectRecords) {
      if (!byPhase[r.phase]) {
        byPhase[r.phase] = { count: 0, costUsd: 0 };
      }
      byPhase[r.phase].count++;
      byPhase[r.phase].costUsd += r.costUsd;
      totalCost += r.costUsd;
      totalDuration += r.durationMs;
    }

    return {
      projectId,
      totalCostUsd: totalCost,
      totalDurationMs: totalDuration,
      totalToolCalls: projectRecords.length,
      runCount: runIds.size,
      byPhase,
    };
  }

  /** 获取所有记录 */
  getAllRecords(): ToolCostRecord[] {
    return [...this.records];
  }

  /** 清空记录 */
  clear(): void {
    this.records = [];
  }
}

export const costTracker = new CostTracker();
