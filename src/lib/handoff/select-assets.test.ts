import { describe, expect, it } from "vitest";

import type { ProjectFile } from "@/lib/project/schema";
import {
  defaultSelectedAssetIds,
  defaultSelectedReferenceIds,
  listSelectableHandoffAssets,
  projectWithHandoffSelection,
  projectWithSelectedAssets,
  sanitizeHandoffSelection,
} from "./select-assets";

describe("select-assets", () => {
  it("lists only exportable assets", () => {
    const project = makeProject({
      assets: [
        asset("a1", "candidate"),
        asset("a2", "starred"),
        asset("a3", "discarded"),
        asset("a4", "generating"),
        asset("a5", "failed"),
        { ...asset("a6", "candidate"), src: "" },
      ],
    });

    expect(listSelectableHandoffAssets(project).map((a) => a.id)).toEqual([
      "a1",
      "a2",
    ]);
  });

  it("defaults to starred assets when any exist", () => {
    const project = makeProject({
      assets: [asset("a1", "candidate"), asset("a2", "starred")],
    });
    expect(defaultSelectedAssetIds(project)).toEqual(["a2"]);
  });

  it("defaults to all selectable when nothing is starred", () => {
    const project = makeProject({
      assets: [asset("a1", "candidate"), asset("a2", "candidate")],
    });
    expect(defaultSelectedAssetIds(project)).toEqual(["a1", "a2"]);
  });

  it("defaults references to all selectable", () => {
    const project = makeProject({
      references: [ref("r1"), ref("r2")],
    });
    expect(defaultSelectedReferenceIds(project)).toEqual(["r1", "r2"]);
  });

  it("filters assets and references by selection", () => {
    const project = makeProject({
      assets: [asset("a1", "candidate"), asset("a2", "starred")],
      references: [ref("r1"), ref("r2")],
    });
    const scoped = projectWithHandoffSelection(project, {
      assetIds: ["a2"],
      referenceIds: ["r1"],
    });
    expect(scoped.assets?.map((a) => a.id)).toEqual(["a2"]);
    expect(scoped.references?.map((r) => r.id)).toEqual(["r1"]);
  });

  it("keeps all references when reference filter omitted", () => {
    const project = makeProject({
      assets: [asset("a1", "candidate")],
      references: [ref("r1"), ref("r2")],
    });
    const scoped = projectWithSelectedAssets(project, ["a1"]);
    expect(scoped.references?.map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("keeps materialized children and layout records for selected mockups", () => {
    const project = makeProject({
      assets: [
        asset("mock-1", "starred"),
        {
          ...asset("mat-hero", "candidate"),
          source: "materialized" as const,
          parentAssetId: "mock-1",
          materialSlotId: "hero",
        },
        {
          ...asset("mat-other", "candidate"),
          source: "materialized" as const,
          parentAssetId: "mock-2",
          materialSlotId: "hero",
        },
        asset("mock-2", "candidate"),
      ],
      materializations: {
        "mock-1": {
          mockupAssetId: "mock-1",
          layout: {
            version: 1 as const,
            mockupAssetId: "mock-1",
            width: 100,
            height: 100,
            referenceImage: "x",
            nodes: [
              {
                id: "hero",
                parentAssetId: "mock-1",
                role: "hero" as const,
                bbox: { x: 0, y: 0, w: 1, h: 1 },
                rebuildInCode: false as const,
                prompt: "hero",
                status: "ready" as const,
                materialAssetId: "mat-hero",
              },
            ],
          },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        "mock-2": {
          mockupAssetId: "mock-2",
          layout: {
            version: 1 as const,
            mockupAssetId: "mock-2",
            width: 100,
            height: 100,
            referenceImage: "x",
            nodes: [],
          },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    });

    const scoped = projectWithSelectedAssets(project, ["mock-1"]);
    expect(scoped.assets?.map((a) => a.id).sort()).toEqual([
      "mat-hero",
      "mock-1",
    ]);
    expect(Object.keys(scoped.materializations ?? {})).toEqual(["mock-1"]);
  });

  it("sanitizes stale ids and restores default assets when empty", () => {
    const project = makeProject({
      assets: [asset("a1", "candidate"), asset("a2", "starred")],
      references: [ref("r1")],
    });
    const next = sanitizeHandoffSelection(project, {
      assetIds: ["gone", "a2"],
      referenceIds: ["gone", "r1"],
    });
    expect(next.assetIds).toEqual(["a2"]);
    expect(next.referenceIds).toEqual(["r1"]);

    const emptyAssets = sanitizeHandoffSelection(project, {
      assetIds: [],
      referenceIds: [],
    });
    expect(emptyAssets.assetIds).toEqual(["a2"]);
    expect(emptyAssets.referenceIds).toEqual([]);
  });
});

function asset(
  id: string,
  status: "candidate" | "starred" | "discarded" | "generating" | "failed"
) {
  return {
    id,
    prompt: `prompt ${id}`,
    src: `data:image/png;base64,${id}`,
    width: 1280,
    height: 720,
    model: "test",
    createdAt: "2026-01-01T00:00:00.000Z",
    status,
  };
}

function ref(id: string) {
  return {
    id,
    label: `ref ${id}`,
    src: `data:image/png;base64,${id}`,
    width: 800,
    height: 600,
    source: "upload" as const,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeProject(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return {
    id: "project-1",
    slug: "project-1",
    title: "Test Project",
    rawIdea: "Build a learning app",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    pages: [],
    ...overrides,
  };
}
