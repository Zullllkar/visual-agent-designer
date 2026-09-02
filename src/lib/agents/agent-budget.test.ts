import { describe, expect, it } from "vitest";

import {
  createRunBudgetState,
  reserveToolBudget,
  type RunBudgetLimits,
} from "./agent-budget";

describe("run tool budget", () => {
  it("tracks tool call count and estimated cost", () => {
    const state = createRunBudgetState();

    reserveToolBudget(state, "generate_brief");
    reserveToolBudget(state, "generate_images");

    expect(state.toolCallCount).toBe(2);
    expect(state.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("throws when tool call count is exceeded", () => {
    const state = createRunBudgetState();
    const limits: RunBudgetLimits = { maxToolCalls: 1, maxEstimatedCostUsd: 1 };

    reserveToolBudget(state, "generate_brief", limits);

    expect(() => reserveToolBudget(state, "plan_design_direction", limits)).toThrow(
      /Tool budget exceeded/
    );
  });

  it("throws when estimated cost is exceeded", () => {
    const state = createRunBudgetState();
    const limits: RunBudgetLimits = { maxToolCalls: 10, maxEstimatedCostUsd: 0.03 };

    expect(() => reserveToolBudget(state, "generate_images", limits)).toThrow(
      /Cost budget exceeded/
    );
  });
});
