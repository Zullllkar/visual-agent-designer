import { describe, expect, it } from "vitest";
import { SpecializedWorkflowInputSchema, SpecializedWorkflowOutputSchema } from "./contracts";

describe("specialized workflow contracts", () => {
  it("validates versioned delegated workflow payloads", () => {
    const input = SpecializedWorkflowInputSchema.parse({ userInput: "make images", workflowType: "images-only" });
    const output = SpecializedWorkflowOutputSchema.parse({
      metadata: { workflowType: input.workflowType, totalDuration: 12, agentExecutions: [{ agentName: "DesignerAgent", duration: 12, success: true }] },
      generatedImages: { images: [] },
    });
    expect(output.metadata.workflowType).toBe("images-only");
  });
});
