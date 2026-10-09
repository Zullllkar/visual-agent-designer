import { describe, expect, it } from "vitest";
import { specializedWorkflowSubAgent } from "./specialized-workflow-sub-agent";

describe("specialized workflow cancellation", () => {
  it("does not start when the parent run is already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(specializedWorkflowSubAgent.run({
      task: "图片生成",
      project: null,
      providerConfig: { llm: { kind: "mock" }, image: { kind: "mock" } },
      agentCtx: { projectId: "p", scratch: {}, providers: { llm: {} as never, image: {} as never, visionCritic: false } },
      abortSignal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
  });
});
