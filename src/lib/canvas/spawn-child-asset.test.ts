import { describe, expect, it } from "vitest";
import type { ImageAsset } from "@/lib/project/assets-schema";
import type { ProjectFile } from "@/lib/project/schema";
import {
  absorbIntoEmptySpawnSlots,
  isEmptySpawnSlot,
  spawnChildAsset,
} from "./spawn-child-asset";

function asset(
  partial: Partial<ImageAsset> & Pick<ImageAsset, "id">
): ImageAsset {
  return {
    prompt: partial.prompt ?? partial.id,
    src: partial.src ?? `data:image/png;base64,${partial.id}`,
    width: partial.width ?? 1280,
    height: partial.height ?? 720,
    model: partial.model ?? "t",
    createdAt: partial.createdAt ?? "2026-08-12T00:00:00.000Z",
    status: partial.status ?? "candidate",
    ...partial,
  };
}

function project(assets: ImageAsset[]): ProjectFile {
  return {
    id: "p1",
    slug: "p1",
    title: "t",
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
    pages: [],
    assets,
  } as ProjectFile;
}

describe("spawnChildAsset", () => {
  it("appends an empty child linked to the parent", () => {
    const parent = asset({ id: "parent", status: "starred" });
    const before = project([parent]);
    const result = spawnChildAsset(before, "parent", {
      id: "child-1",
      now: "2026-08-12T01:00:00.000Z",
    });
    expect(result).not.toBeNull();
    expect(result!.child).toMatchObject({
      id: "child-1",
      src: "",
      prompt: "",
      status: "candidate",
      parentAssetId: "parent",
      source: "generated",
      width: 1280,
      height: 720,
      referenceAssetIds: ["parent"],
      createdAt: "2026-08-12T01:00:00.000Z",
    });
    expect(result!.project.assets?.map((a) => a.id)).toEqual([
      "parent",
      "child-1",
    ]);
    expect(result!.project.updatedAt).toBe("2026-08-12T01:00:00.000Z");
  });

  it("returns null when parent is missing or not spawnable", () => {
    const empty = asset({ id: "empty", src: "" });
    const generating = asset({ id: "gen", status: "generating" });
    expect(spawnChildAsset(project([empty]), "empty")).toBeNull();
    expect(spawnChildAsset(project([generating]), "gen")).toBeNull();
    expect(spawnChildAsset(project([empty]), "nope")).toBeNull();
  });
});

describe("isEmptySpawnSlot", () => {
  it("detects placeholder child with no preview", () => {
    expect(
      isEmptySpawnSlot(
        asset({ id: "c", src: "", parentAssetId: "p", status: "candidate" })
      )
    ).toBe(true);
    expect(isEmptySpawnSlot(asset({ id: "p", src: "data:x" }))).toBe(false);
  });
});

describe("absorbIntoEmptySpawnSlots", () => {
  it("fills empty child with same-parent generated sibling and drops donor", () => {
    const parent = asset({ id: "parent", status: "starred" });
    const spawned = spawnChildAsset(project([parent]), "parent", {
      id: "empty-1",
      now: "2026-08-12T01:00:00.000Z",
    })!;
    const donor = asset({
      id: "new-1",
      parentAssetId: "parent",
      src: "data:image/png;base64,NEW",
      prompt: "variant prompt",
      createdAt: "2026-08-12T01:01:00.000Z",
      source: "edited",
    });
    const next = absorbIntoEmptySpawnSlots([
      ...(spawned.project.assets ?? []),
      donor,
    ]);
    expect(next.map((a) => a.id)).toEqual(["parent", "empty-1"]);
    expect(isEmptySpawnSlot(next[1]!)).toBe(false);
    expect(next[1]).toMatchObject({
      id: "empty-1",
      src: "data:image/png;base64,NEW",
      prompt: "variant prompt",
      parentAssetId: "parent",
      source: "edited",
    });
  });

  it("fills multiple empties in creation order and keeps leftover donors", () => {
    const parent = asset({ id: "parent" });
    const e1 = asset({
      id: "e1",
      src: "",
      parentAssetId: "parent",
      createdAt: "2026-08-12T01:00:00.000Z",
    });
    const e2 = asset({
      id: "e2",
      src: "",
      parentAssetId: "parent",
      createdAt: "2026-08-12T01:00:01.000Z",
    });
    const d1 = asset({
      id: "d1",
      parentAssetId: "parent",
      createdAt: "2026-08-12T02:00:00.000Z",
    });
    const d2 = asset({
      id: "d2",
      parentAssetId: "parent",
      createdAt: "2026-08-12T02:00:01.000Z",
    });
    const d3 = asset({
      id: "d3",
      parentAssetId: "parent",
      createdAt: "2026-08-12T02:00:02.000Z",
    });
    const next = absorbIntoEmptySpawnSlots([parent, e1, e2, d1, d2, d3]);
    expect(next.map((a) => a.id)).toEqual(["parent", "e1", "e2", "d3"]);
    expect(next.find((a) => a.id === "e1")?.src).toBe(d1.src);
    expect(next.find((a) => a.id === "e2")?.src).toBe(d2.src);
  });

  it("is a no-op when there is no empty slot", () => {
    const assets = [
      asset({ id: "parent" }),
      asset({ id: "child", parentAssetId: "parent" }),
    ];
    expect(absorbIntoEmptySpawnSlots(assets)).toEqual(assets);
  });
});
