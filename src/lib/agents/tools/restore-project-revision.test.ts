import { describe, expect, it } from "vitest";
import { restoreProjectRevisionTool } from "./restore-project-revision";

describe("restore_project_revision", () => {
  it("restores project-level state together with pages", async () => {
    const project = {
      id: "p",
      slug: "p",
      title: "P",
      rawIdea: "idea",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      pages: [],
      assets: [{ id: "current", prompt: "current", src: "x", width: 256, height: 256, model: "m", createdAt: "2026-01-01T00:00:00.000Z", status: "candidate" }],
      revisionHistory: [{
        id: "rev-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        reason: "repair_project",
        pages: [],
        assets: [{ id: "old", prompt: "old", src: "x", width: 256, height: 256, model: "m", createdAt: "2026-01-01T00:00:00.000Z", status: "candidate" }],
        approvalPolicy: { generate_images: "project" },
      }],
    } as never;
    const result = await restoreProjectRevisionTool.execute({ revisionId: "rev-1" }, { project, userMessage: "restore", agentCtx: { projectId: "p", scratch: {}, providers: { llm: {} as never, image: {} as never, visionCritic: false } } });
    expect(result.updatedProject?.assets?.[0]?.id).toBe("old");
    expect(result.updatedProject?.approvalPolicy?.generate_images).toBe("project");
  });
});
