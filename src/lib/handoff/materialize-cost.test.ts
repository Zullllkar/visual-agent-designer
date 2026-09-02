import { describe, expect, it } from "vitest";
import { estimateMaterializeCostUsd } from "./materialize-cost";

describe("estimateMaterializeCostUsd", () => {
  it("charges per generate slot plus optional decompose", () => {
    expect(
      estimateMaterializeCostUsd({
        mediaSlotCount: 3,
        needsDecompose: true,
        generateSlotCount: 3,
      })
    ).toEqual({
      estimatedUsd: 0.14,
      decomposeUsd: 0.02,
      generationUsd: 0.12,
      generateSlotCount: 3,
    });
  });

  it("can estimate regenerate-one-slot only", () => {
    const cost = estimateMaterializeCostUsd({
      mediaSlotCount: 5,
      generateSlotCount: 1,
    });
    expect(cost.estimatedUsd).toBe(0.04);
    expect(cost.generateSlotCount).toBe(1);
  });
});
