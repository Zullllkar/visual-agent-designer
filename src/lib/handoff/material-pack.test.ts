import { describe, expect, it } from "vitest";
import type { ProjectFile } from "@/lib/project/schema";
import { appendMaterializationFiles } from "./material-pack";
import type { MaterializationRecord } from "./layout-ir";

function mockRecord(): MaterializationRecord {
  return {
    mockupAssetId: "mock-1",
    styleLock: {
      palette: ["#111111", "#39FF14"],
      mood: "dark neon",
      materials: "glass + metal",
      doNot: ["generic SaaS purple"],
      summary: "Dark hardcore landing",
    },
    layout: {
      version: 1,
      mockupAssetId: "mock-1",
      width: 1280,
      height: 720,
      referenceImage: "assets/final/mock-1.png",
      screenType: "landing",
      nodes: [
        {
          id: "hero",
          parentAssetId: "mock-1",
          role: "hero",
          bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.45 },
          rebuildInCode: false,
          prompt: "isolated hero art",
          status: "ready",
          materialAssetId: "mat-hero",
          media: "assets/materials/mock-1/hero.png",
        },
        {
          id: "cta",
          role: "cta",
          bbox: { x: 0.35, y: 0.7, w: 0.3, h: 0.1 },
          rebuildInCode: true,
          copy: "Start now",
        },
      ],
      meta: {
        source: "heuristic",
        createdAt: "2026-07-22T00:00:00.000Z",
      },
    },
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
  };
}

function mockProject(): ProjectFile {
  return {
    id: "p1",
    slug: "demo",
    title: "Demo Game",
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
    rawIdea: "dark game landing",
    pages: [],
    assets: [
      {
        id: "mock-1",
        prompt: "landing",
        src: "data:image/png;base64,mock",
        width: 1280,
        height: 720,
        model: "test",
        createdAt: "2026-07-22T00:00:00.000Z",
        status: "starred",
      },
      {
        id: "mat-hero",
        prompt: "hero",
        src: "data:image/png;base64,hero",
        width: 1024,
        height: 576,
        model: "test",
        createdAt: "2026-07-22T00:00:00.000Z",
        status: "candidate",
        source: "materialized",
        materialSlotId: "hero",
      },
    ],
    materializations: {
      "mock-1": mockRecord(),
    },
  } as ProjectFile;
}

describe("appendMaterializationFiles", () => {
  it("writes DESIGN / LAYOUT / MATERIAL_MAP / SKILL / assembly + materials", async () => {
    const files: Array<{ path: string; content: string | Uint8Array }> = [];
    const warnings: string[] = [];
    const stats = await appendMaterializationFiles(
      mockProject(),
      files,
      async (src) => ({
        content: `embedded:${src.slice(0, 24)}`,
        ext: "png",
      }),
      warnings
    );

    expect(stats.layoutCount).toBe(1);
    expect(stats.materialCount).toBe(1);
    expect(stats.readyMockups).toEqual(["mock-1"]);
    expect(warnings).toEqual([]);

    const paths = files.map((f) => f.path);
    expect(paths).toContain("DESIGN.md");
    expect(paths).toContain("LAYOUT.md");
    expect(paths).toContain("MATERIAL_MAP.md");
    expect(paths).toContain("skills/design-to-code/SKILL.md");
    expect(paths).toContain("preview/assembly.html");
    expect(paths).toContain("design/layouts/mock-1.json");
    expect(paths).toContain("design/layouts/index.json");
    expect(paths).toContain("assets/materials/mock-1/hero.png");

    const design = files.find((f) => f.path === "DESIGN.md")?.content;
    expect(String(design)).toContain("Style lock");
    expect(String(design)).toContain("#39FF14");

    const map = files.find((f) => f.path === "MATERIAL_MAP.md")?.content;
    expect(String(map)).toContain("hero");
    expect(String(map)).toContain("rebuildInCode");

    const skill = files.find(
      (f) => f.path === "skills/design-to-code/SKILL.md"
    )?.content;
    expect(String(skill)).toContain("rebuildInCode: false");

    const assembly = files.find((f) => f.path === "preview/assembly.html")
      ?.content;
    expect(String(assembly)).toContain("assets/materials/mock-1/hero.png");
  });

  it("no-ops when project has no materializations", async () => {
    const files: Array<{ path: string; content: string | Uint8Array }> = [];
    const project = { ...mockProject(), materializations: undefined };
    const stats = await appendMaterializationFiles(
      project,
      files,
      async () => null,
      []
    );
    expect(stats).toEqual({
      materialCount: 0,
      layoutCount: 0,
      readyMockups: [],
    });
    expect(files).toEqual([]);
  });

  it("embeds materials after selection scoping keeps materialized children", async () => {
    const { projectWithSelectedAssets } = await import("./select-assets");
    const scoped = projectWithSelectedAssets(mockProject(), ["mock-1"]);
    expect(scoped.assets?.some((a) => a.id === "mat-hero")).toBe(true);

    const files: Array<{ path: string; content: string | Uint8Array }> = [];
    const warnings: string[] = [];
    const stats = await appendMaterializationFiles(
      scoped,
      files,
      async () => ({ content: "img", ext: "png" }),
      warnings
    );

    expect(stats.materialCount).toBe(1);
    expect(stats.layoutCount).toBe(1);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("assets/materials/mock-1/hero.png");
    expect(paths).toContain("LAYOUT.md");
    expect(paths).toContain("MATERIAL_MAP.md");
    expect(paths).toContain("design/layouts/mock-1.json");
    expect(warnings.some((w) => w.includes("missing asset"))).toBe(false);
  });
});
