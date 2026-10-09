import { describe, expect, it } from "vitest";
import { TOOL_CONTRACTS, TOOL_NAMES, toolContract } from "./tool-contract";
import { registerAllTools, toolRegistry } from "./tools";

describe("canonical tool contract", () => {
  it("covers every registered tool with a label and phase", () => {
    registerAllTools();
    for (const name of toolRegistry.names()) {
      const contract = toolContract(name);
      expect(contract, `${name} is missing from the canonical contract`).toBeTruthy();
      expect(contract?.label).toBeTruthy();
      expect(contract?.phase).toBeTruthy();
    }
  });

  it("exposes stable names for replayed tool calls", () => {
    expect(TOOL_NAMES).toContain("review_project");
    expect(TOOL_CONTRACTS.generate_images.risk).toBe("moderate");
  });
});
