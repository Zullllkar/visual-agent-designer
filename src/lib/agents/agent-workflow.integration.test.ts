import { describe, expect, it } from "vitest";
import { registerAllTools, toolRegistry } from "./tools";
import type { ToolContext } from "./tools/types";

describe("formal agent workflow", () => {
  it("plans, reviews, repairs and restores a project through the canonical registry", async () => {
    registerAllTools();
    const context: ToolContext = {
      project: {
        id: "workflow-project",
        slug: "workflow-project",
        title: "Workflow",
        rawIdea: "A visual product",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        pages: [{
          id: "home",
          name: "Home",
          width: 800,
          height: 600,
          nodes: [{ id: "title", type: "text", x: -20, y: 0, width: 120, height: 30, content: "Title", fontSize: 8 }],
        }],
      } as never,
      userMessage: "build the visual",
      agentCtx: {
        projectId: "workflow-project",
        scratch: {},
        providers: { llm: {} as never, image: {} as never, visionCritic: false },
        skill: { manifest: { agent: { repairThreshold: 8, maxRepairRounds: 2 }, output: { defaultPageSize: { width: 800, height: 600 } } } } as never,
      },
    };

    const planned = await toolRegistry.execute("plan_assets", {
      items: [{ role: "hero", purpose: "Hero image", prompt: "A calm editorial hero image" }],
    }, context);
    context.project = planned.updatedProject ?? context.project;
    if (!context.project) throw new Error("workflow project missing after plan");
    expect(context.project.assetPlan?.items).toHaveLength(1);

    const reviewed = await toolRegistry.execute("review_project", {}, { ...context, project: context.project });
    context.project = reviewed.updatedProject ?? context.project;
    if (!context.project) throw new Error("workflow project missing after review");
    expect(reviewed.data).toMatchObject({ repairRecommended: true });

    const repaired = await toolRegistry.execute("repair_project", {}, { ...context, project: context.project });
    context.project = repaired.updatedProject ?? context.project;
    if (!context.project) throw new Error("workflow project missing after repair");
    expect(context.project.revisionHistory).toHaveLength(1);
    expect(context.project.critique?.overallScore).toBeGreaterThan(0);

    const restored = await toolRegistry.execute("restore_project_revision", {}, { ...context, project: context.project });
    expect(restored.updatedProject?.pages[0]?.nodes[0]?.x).toBe(-20);
    const restoredNode = restored.updatedProject?.pages[0]?.nodes[0];
    expect(restoredNode?.type === "text" ? restoredNode.fontSize : undefined).toBe(8);
  });
});
