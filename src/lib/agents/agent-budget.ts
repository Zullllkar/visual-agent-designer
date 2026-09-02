import "server-only";

import { estimateToolCostUsd } from "./cost-tracker";

export interface RunBudgetLimits {
  maxToolCalls: number;
  maxEstimatedCostUsd: number;
}

export interface RunBudgetState {
  toolCallCount: number;
  estimatedCostUsd: number;
}

export const DEFAULT_RUN_BUDGET_LIMITS: RunBudgetLimits = {
  maxToolCalls: 12,
  maxEstimatedCostUsd: 0.5,
};

export function createRunBudgetState(): RunBudgetState {
  return {
    toolCallCount: 0,
    estimatedCostUsd: 0,
  };
}

export function reserveToolBudget(
  state: RunBudgetState,
  toolName: string,
  limits: RunBudgetLimits = DEFAULT_RUN_BUDGET_LIMITS
): void {
  const nextCount = state.toolCallCount + 1;
  if (nextCount > limits.maxToolCalls) {
    throw new Error(
      `Tool budget exceeded: ${nextCount}/${limits.maxToolCalls} tool calls`
    );
  }

  const nextEstimatedCost = state.estimatedCostUsd + estimateToolCostUsd(toolName);
  if (nextEstimatedCost > limits.maxEstimatedCostUsd) {
    throw new Error(
      `Cost budget exceeded: estimated $${nextEstimatedCost.toFixed(4)} / $${limits.maxEstimatedCostUsd.toFixed(2)}`
    );
  }

  state.toolCallCount = nextCount;
  state.estimatedCostUsd = nextEstimatedCost;
}
