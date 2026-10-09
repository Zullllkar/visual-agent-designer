import { describe, expect, it } from "vitest";
import { buildDeterministicProjectReview } from "./review-project";

describe("review_project", () => {
  it("creates an actionable score and issue list without an LLM", () => {
    const report = buildDeterministicProjectReview({
      pages: [
        {
          id: "page-1",
          name: "Home",
          width: 800,
          height: 600,
          nodes: [
            { id: "a", type: "text", x: -10, y: 0, width: 100, height: 40, content: "Title", fontSize: 14 },
          ],
        },
      ],
    });
    expect(report.overallScore).toBeLessThan(10);
    expect(report.reports[0]?.issues[0]?.category).toBe("overflow");
  });

  it("uses the active skill repair threshold", async () => {
    const result = await (await import("./review-project")).reviewProjectTool.execute({}, {
      project: {
        id: "p",
        slug: "p",
        title: "P",
        rawIdea: "idea",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        pages: [{ id: "page", name: "Page", width: 100, height: 100, nodes: [] }],
      } as never,
      userMessage: "review",
      agentCtx: {
        projectId: "p",
        scratch: {},
        providers: { llm: {} as never, image: {} as never, visionCritic: false },
        skill: { manifest: { agent: { repairThreshold: 9 } } } as never,
      },
    });
    expect(result.data).toMatchObject({ repairRecommended: true, repairThreshold: 9 });
  });
});
