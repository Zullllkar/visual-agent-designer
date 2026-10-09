import { describe, expect, it } from "vitest";
import { ensureProjectBrief } from "./ensure-brief";
import type { ProjectFile } from "./schema";

describe("ensureProjectBrief", () => {
  it("keeps an existing brief", () => {
    const project = {
      id: "p1",
      slug: "p1",
      title: "App",
      rawIdea: "idea",
      createdAt: "2026-09-18T00:00:00.000Z",
      updatedAt: "2026-09-18T00:00:00.000Z",
      pages: [],
      assets: [],
      brief: {
        productName: "Kept",
        positioning: "pos",
        targetUser: "users",
        scenarios: [],
        coreFeatures: [],
        platform: "web",
        visualStyle: "clean",
        outputTargets: ["markdown"],
      },
    } as ProjectFile;
    expect(ensureProjectBrief(project).brief?.productName).toBe("Kept");
  });

  it("synthesizes a brief from title and prompt for canvas-only projects", () => {
    const project = {
      id: "omni-1",
      slug: "omni-1",
      title: "omni1.0.3",
      rawIdea: "生成不同设计的版本出来",
      createdAt: "2026-09-18T00:00:00.000Z",
      updatedAt: "2026-09-18T00:00:00.000Z",
      pages: [],
      assets: [],
    } as ProjectFile;
    const next = ensureProjectBrief(project, {
      prompt: "Dark theme OmniTab home",
    });
    expect(next.brief?.productName).toBe("omni1.0.3");
    expect(next.brief?.positioning).toContain("生成不同设计");
  });
});
