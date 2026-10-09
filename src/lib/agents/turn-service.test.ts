import { describe, expect, it } from "vitest";
import { buildTurnSnapshot } from "./turn-service";

describe("turn service", () => {
  it("keeps a turn running while a background job is active", () => {
    const snapshot = buildTurnSnapshot({
      turnId: "turn-1",
      projectId: "project-1",
      run: { runId: "run-1", turnId: "turn-1", threadId: "thread-1", projectId: "project-1", status: "completed", startedAt: 1, phase: "GENERATION", jobIds: [] },
      jobs: [{ id: "job-1", type: "direct_image_generation", status: "running", progress: 40 }],
    });
    expect(snapshot.status).toBe("running");
    expect(snapshot.canHandoff).toBe(false);
  });
});
