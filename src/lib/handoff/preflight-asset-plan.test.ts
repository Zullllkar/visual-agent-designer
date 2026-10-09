import { describe, expect, it } from "vitest";
import { buildHandoffPreflight } from "./preflight";

describe("handoff asset plan gate", () => {
  it("blocks handoff while required planned assets are incomplete", () => {
    const project = {
      id: "p",
      slug: "p",
      title: "P",
      rawIdea: "idea",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
      pages: [],
      assets: [{ id: "a", prompt: "hero", src: "/api/assets/a.png", width: 512, height: 512, model: "m", status: "starred", createdAt: "2026-01-01" }],
      assetPlan: {
        version: 1,
        summary: "plan",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
        items: [{ id: "plan-1", role: "hero", purpose: "Hero", prompt: "hero", width: 512, height: 512, priority: "required", status: "planned" }],
      },
    } as never;
    const result = buildHandoffPreflight(project);
    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.id === "asset-plan")?.level).toBe("error");
  });
});
