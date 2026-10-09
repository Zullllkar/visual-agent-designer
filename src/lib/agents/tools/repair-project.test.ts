import { describe, expect, it } from "vitest";
import { repairProjectTool } from "./repair-project";

describe("repair_project safeguards", () => {
  it("stops after the skill repair-round limit", async () => {
    const project = {
      id: "p",
      slug: "p",
      title: "P",
      rawIdea: "idea",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      pages: [],
      revisionHistory: [
        { id: "r1", createdAt: "2026-01-01T00:00:00.000Z", reason: "repair_project", pages: [] },
      ],
    } as never;
    const result = await repairProjectTool.execute({}, {
      project,
      userMessage: "repair",
      agentCtx: {
        projectId: "p",
        scratch: {},
        providers: { llm: {} as never, image: {} as never, visionCritic: false },
        skill: { manifest: { agent: { maxRepairRounds: 1 } } } as never,
      },
    });
    expect(result.data).toMatchObject({ repairBlocked: true, maxRepairRounds: 1 });
  });
});
