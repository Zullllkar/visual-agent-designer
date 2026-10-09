import { describe, expect, it } from "vitest";
import type { ImageAsset } from "@/lib/project/assets-schema";
import type { ProjectFile } from "@/lib/project/schema";
import {
  buildAssetFamilies,
  computeBoardLayout,
  familyBoardRect,
  isFamilyLayoutLoose,
  layoutAssetsByLineage,
} from "./board-layout";

function asset(
  partial: Partial<ImageAsset> & Pick<ImageAsset, "id">
): ImageAsset {
  return {
    prompt: partial.prompt ?? partial.id,
    src: `data:image/png;base64,${partial.id}`,
    width: partial.width ?? 800,
    height: partial.height ?? 600,
    model: "t",
    createdAt: partial.createdAt ?? "2026-08-10T00:00:00.000Z",
    status: partial.status ?? "starred",
    ...partial,
  };
}

describe("buildAssetFamilies", () => {
  it("groups children under visible parent", () => {
    const assets = [
      asset({ id: "mock", role: "hero" }),
      asset({
        id: "icon",
        parentAssetId: "mock",
        source: "materialized",
        role: "icon",
      }),
      asset({
        id: "bg",
        parentAssetId: "mock",
        source: "materialized",
        role: "background",
      }),
      asset({ id: "other" }),
    ];
    const families = buildAssetFamilies(assets);
    expect(families).toHaveLength(2);
    const mockFamily = families.find((f) => f.root.id === "mock")!;
    expect(mockFamily.descendants.map((d) => d.id)).toEqual(["bg", "icon"]);
    expect(families.find((f) => f.root.id === "other")?.descendants).toEqual(
      []
    );
  });
});

describe("layoutAssetsByLineage", () => {
  it("places children to the right of parent, not in a flat 3-col pile", () => {
    const assets = [
      asset({ id: "mock", width: 1280, height: 720 }),
      asset({
        id: "a",
        parentAssetId: "mock",
        source: "materialized",
        role: "icon",
        width: 256,
        height: 256,
      }),
      asset({
        id: "b",
        parentAssetId: "mock",
        source: "materialized",
        role: "background",
        width: 1024,
        height: 1024,
      }),
    ];
    const placed = layoutAssetsByLineage(assets, 0, 0);
    const mock = placed.get("mock")!;
    const a = placed.get("a")!;
    const b = placed.get("b")!;
    expect(a.x).toBeGreaterThan(mock.x + mock.w);
    expect(b.x).toBeGreaterThan(mock.x + mock.w);
    expect(a.x).toBe(b.x);
    expect(a.y).toBeGreaterThan(b.y);
  });

  it("separates two families horizontally or on next row", () => {
    const assets = [
      asset({ id: "m1", width: 800, height: 600 }),
      asset({
        id: "c1",
        parentAssetId: "m1",
        source: "materialized",
        role: "icon",
      }),
      asset({ id: "m2", width: 800, height: 600 }),
      asset({
        id: "c2",
        parentAssetId: "m2",
        source: "materialized",
        role: "icon",
      }),
    ];
    const placed = layoutAssetsByLineage(assets, 0, 0);
    const m1 = placed.get("m1")!;
    const m2 = placed.get("m2")!;
    const sameRow = Math.abs(m1.y - m2.y) < 8;
    if (sameRow) {
      expect(m2.x).toBeGreaterThan(m1.x + m1.w);
    } else {
      expect(m2.y).toBeGreaterThan(m1.y);
    }
  });
});

describe("familyBoardRect", () => {
  it("pads around the member bounding box", () => {
    const board = familyBoardRect([
      { x: 100, y: 80, w: 200, h: 120 },
      { x: 340, y: 100, w: 80, h: 80 },
    ]);
    expect(board).toEqual({
      x: 82,
      y: 32,
      w: 356,
      h: 184,
    });
  });

  it("returns null for an empty family", () => {
    expect(familyBoardRect([])).toBeNull();
  });
});

describe("isFamilyLayoutLoose", () => {
  it("flags a board that is much larger than the compact layout", () => {
    expect(
      isFamilyLayoutLoose(
        { x: 0, y: 0, w: 800, h: 600 },
        { x: 0, y: 0, w: 320, h: 200 }
      )
    ).toBe(true);
    expect(
      isFamilyLayoutLoose(
        { x: 0, y: 0, w: 330, h: 210 },
        { x: 0, y: 0, w: 320, h: 200 }
      )
    ).toBe(false);
  });
});

describe("computeBoardLayout", () => {
  it("exposes assetById keyed positions", () => {
    const project = {
      id: "p1",
      slug: "demo",
      title: "Demo",
      rawIdea: "Demo visual project",
      createdAt: "2026-08-10T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:00.000Z",
      pages: [],
      assets: [
        asset({ id: "mock" }),
        asset({
          id: "mat",
          parentAssetId: "mock",
          source: "materialized",
          role: "icon",
        }),
      ],
      references: [],
    } as ProjectFile;

    const board = computeBoardLayout(project);
    expect(board.assetById.mock).toBeTruthy();
    expect(board.assetById.mat.x).toBeGreaterThan(
      board.assetById.mock.x + board.assetById.mock.w
    );
    expect(board.assets).toHaveLength(2);
  });
});
