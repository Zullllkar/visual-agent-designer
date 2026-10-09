import { describe, expect, it } from "vitest";
import { SpecializedCheckpointStore, runSpecializedStage } from "./checkpoint-retry";

describe("specialized checkpoint recovery", () => {
  it("retries a failed stage and stores the successful output", async () => {
    const store = new SpecializedCheckpointStore();
    let calls = 0;
    const result = await runSpecializedStage(async () => {
      calls += 1;
      if (calls === 1) throw new Error("transient");
      return { ok: true };
    }, { workflowId: "w1", stage: "architect", maxRetries: 2, store });
    expect(calls).toBe(2);
    expect(result.output).toEqual({ ok: true });
    expect(result.checkpoint.status).toBe("completed");
    expect(result.checkpoint.attempt).toBe(2);
  });

  it("resumes a completed stage without invoking the worker", async () => {
    const store = new SpecializedCheckpointStore();
    await runSpecializedStage(async () => "cached", { workflowId: "w2", stage: "designer", store });
    const resumed = await runSpecializedStage(async () => { throw new Error("must not run"); }, { workflowId: "w2", stage: "designer", resume: true, store });
    expect(resumed.output).toBe("cached");
  });

  it("keeps failed checkpoints visible after exhausting retries", async () => {
    const store = new SpecializedCheckpointStore();
    await expect(runSpecializedStage(async () => { throw new Error("permanent"); }, { workflowId: "w3", stage: "images", maxRetries: 1, store })).rejects.toThrow("permanent");
    expect(store.get("w3", "images")?.status).toBe("failed");
    expect(store.get("w3", "images")?.attempt).toBe(2);
  });
});
