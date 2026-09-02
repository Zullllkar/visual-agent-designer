import { describe, expect, it } from "vitest";
import { ImagePlannerAgent } from "./image-planner-agent";

describe("ImagePlannerAgent confirmed prompts", () => {
  it("creates one task per distinct prompt", async () => {
    const plan = await ImagePlannerAgent.run(
      {
        brief: {
          productName: "Neon Hub",
          positioning: "cyberpunk assets",
          targetUser: "designers",
          scenarios: [],
          coreFeatures: [],
          platform: "web",
          visualStyle: "neon",
          outputTargets: ["cursor"],
        },
        pages: [],
        standaloneCount: 3,
        standalonePrompt: "shared fallback",
        standalonePrompts: [
          "Hero neon cityscape",
          "UI card grid mockup",
          "Foggy alley background",
        ],
      },
      {
        projectId: "p1",
        scratch: {},
        providers: {
          llm: { kind: "mock" } as never,
          image: { kind: "mock" } as never,
          visionCritic: false,
        },
      }
    );

    expect(plan.tasks).toHaveLength(3);
    expect(plan.tasks.map((t) => t.imagePrompt)).toEqual([
      "Hero neon cityscape",
      "UI card grid mockup",
      "Foggy alley background",
    ]);
  });

  it("clones a single prompt by count", async () => {
    const plan = await ImagePlannerAgent.run(
      {
        brief: {
          productName: "Neon Hub",
          positioning: "cyberpunk assets",
          targetUser: "designers",
          scenarios: [],
          coreFeatures: [],
          platform: "web",
          visualStyle: "neon",
          outputTargets: ["cursor"],
        },
        pages: [],
        standaloneCount: 3,
        standalonePrompt: "Same hero visual",
      },
      {
        projectId: "p1",
        scratch: {},
        providers: {
          llm: { kind: "mock" } as never,
          image: { kind: "mock" } as never,
          visionCritic: false,
        },
      }
    );

    expect(plan.tasks).toHaveLength(3);
    expect(plan.tasks.every((t) => t.imagePrompt === "Same hero visual")).toBe(
      true
    );
  });
});
