import { describe, expect, it } from "vitest";
import type { ImageAsset } from "@/lib/project/assets-schema";
import type { ProjectFile } from "@/lib/project/schema";
import {
  absorbIntoEmptySpawnSlots,
  isEmptySpawnSlot,
  markEmptySpawnSlotsGenerating,
  markProjectEmptySpawnSlotsGenerating,
  releaseStuckGeneratingAssets,
  shouldShowSpawnPromptComposer,
  shouldShowSpawnSlotLoading,
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
    rawIdea: "test visual project",
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
      title: "Parent 变体",
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

describe("shouldShowSpawnPromptComposer", () => {
  it("opens the prompt box only for a linked empty placeholder", () => {
    const parent = asset({ id: "parent", status: "starred" });
    const child = spawnChildAsset(project([parent]), "parent", {
      id: "empty-1",
    })!.child;
    expect(shouldShowSpawnPromptComposer(child, [parent, child])).toBe(true);
    expect(shouldShowSpawnPromptComposer(parent, [parent])).toBe(false);
    expect(
      shouldShowSpawnPromptComposer({ ...child, src: "data:image/png;base64,x" }, [
        parent,
        { ...child, src: "data:image/png;base64,x" },
      ])
    ).toBe(false);
    expect(
      shouldShowSpawnPromptComposer(
        asset({ id: "orphan", src: "", prompt: "" }),
        []
      )
    ).toBe(false);
  });

  it("hides the prompt box while the placeholder is generating", () => {
    const parent = asset({ id: "parent", status: "starred" });
    const child = spawnChildAsset(project([parent]), "parent", {
      id: "empty-1",
    })!.child;
    expect(
      shouldShowSpawnPromptComposer(
        { ...child, status: "generating" },
        [parent, { ...child, status: "generating" }]
      )
    ).toBe(false);
    expect(
      shouldShowSpawnPromptComposer(
        { ...child, status: "generating" },
        [parent, { ...child, status: "generating" }],
        { imageJobBusy: true }
      )
    ).toBe(false);
    expect(
      shouldShowSpawnPromptComposer(child, [parent, child], {
        imageJobBusy: true,
      })
    ).toBe(true);
  });
});

describe("shouldShowSpawnSlotLoading", () => {
  it("shows loading on an empty derived slot while generation is in flight", () => {
    const parent = asset({ id: "parent", status: "starred" });
    const child = spawnChildAsset(project([parent]), "parent", {
      id: "empty-1",
    })!.child;
    expect(
      shouldShowSpawnSlotLoading({
        asset: child,
        assets: [parent, child],
      })
    ).toBe(false);
    expect(
      shouldShowSpawnSlotLoading({
        asset: { ...child, status: "generating" },
        assets: [parent, { ...child, status: "generating" }],
      })
    ).toBe(true);
    expect(
      shouldShowSpawnSlotLoading({
        asset: child,
        assets: [
          parent,
          child,
          asset({
            id: "pending-direct-1",
            parentAssetId: "parent",
            status: "generating",
            src: "data:image/svg+xml,x",
          }),
        ],
      })
    ).toBe(false);
    expect(
      shouldShowSpawnSlotLoading({
        asset: child,
        assets: [parent, child],
        imageJobBusy: true,
      })
    ).toBe(false);
    expect(
      shouldShowSpawnSlotLoading({
        asset: child,
        assets: [parent, child],
        agentRunBusy: true,
      })
    ).toBe(false);
    expect(
      shouldShowSpawnSlotLoading({
        asset: parent,
        assets: [parent],
        imageJobBusy: true,
      })
    ).toBe(false);
  });

  it("does not paint a freshly cited empty slot as generating because a sibling is busy", () => {
    const parent = asset({ id: "parent", status: "starred" });
    const busy = spawnChildAsset(project([parent]), "parent", {
      id: "busy-1",
    })!.child;
    const cited = spawnChildAsset(project([parent, busy]), "parent", {
      id: "cited-1",
    })!.child;
    expect(
      shouldShowSpawnSlotLoading({
        asset: cited,
        assets: [parent, { ...busy, status: "generating" }, cited],
        imageJobBusy: true,
        agentRunBusy: true,
      })
    ).toBe(false);
  });
});

describe("releaseStuckGeneratingAssets", () => {
  it("reopens empty generating slots when no image job is live", () => {
    const parent = asset({ id: "parent", status: "starred" });
    const stuck = asset({
      id: "empty-1",
      src: "",
      parentAssetId: "parent",
      status: "generating",
    });
    const next = releaseStuckGeneratingAssets([parent, stuck], {
      hasActiveImageJob: false,
    });
    expect(next.find((a) => a.id === "empty-1")?.status).toBe("candidate");
    expect(
      shouldShowSpawnSlotLoading({
        asset: next.find((a) => a.id === "empty-1"),
        assets: next,
      })
    ).toBe(false);
  });

  it("keeps generating assets while an image job is actually running", () => {
    const pending = asset({
      id: "p1",
      src: "",
      status: "generating",
      batchId: "batch-1",
    });
    const assets = [pending];
    const next = releaseStuckGeneratingAssets(assets, {
      hasActiveImageJob: true,
    });
    expect(next).toBe(assets);
    expect(next[0]?.status).toBe("generating");
  });

  it("is idempotent for pending placeholders already released", () => {
    const leftover = asset({
      id: "job-1",
      src: "data:image/svg+xml,x",
      status: "generating",
      model: "pending",
      batchId: "batch-9",
    });
    const once = releaseStuckGeneratingAssets([leftover], {
      hasActiveImageJob: false,
      terminalBatchId: "batch-9",
    });
    expect(once[0]?.status).toBe("discarded");
    const twice = releaseStuckGeneratingAssets(once, {
      hasActiveImageJob: false,
      terminalBatchId: "batch-9",
    });
    expect(twice).toBe(once);
  });

  it("is idempotent for empty slots already back to candidate", () => {
    const stuck = asset({
      id: "empty-1",
      src: "",
      parentAssetId: "parent",
      status: "generating",
      model: "pending",
    });
    const once = releaseStuckGeneratingAssets([stuck], {
      hasActiveImageJob: false,
    });
    expect(once[0]?.status).toBe("candidate");
    const twice = releaseStuckGeneratingAssets(once, {
      hasActiveImageJob: false,
    });
    expect(twice).toBe(once);
  });

  it("discards leftover job placeholders after the job ended", () => {
    const leftover = asset({
      id: "job-1",
      src: "data:image/svg+xml,x",
      status: "generating",
      model: "pending",
      batchId: "batch-9",
    });
    const next = releaseStuckGeneratingAssets([leftover], {
      hasActiveImageJob: false,
      terminalBatchId: "batch-9",
    });
    expect(next[0]?.status).toBe("discarded");
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

describe("markEmptySpawnSlotsGenerating", () => {
  it("flips empty spawn slots to generating so the canvas shows loading", () => {
    const parent = asset({ id: "parent", status: "starred" });
    const empty = spawnChildAsset(project([parent]), "parent", {
      id: "empty-1",
    })!.child;
    const next = markEmptySpawnSlotsGenerating([parent, empty]);
    expect(next.find((a) => a.id === "empty-1")?.status).toBe("generating");
    expect(next.find((a) => a.id === "parent")?.status).toBe("starred");
    expect(
      shouldShowSpawnSlotLoading({
        asset: next.find((a) => a.id === "empty-1"),
        assets: next,
      })
    ).toBe(true);
  });

  it("marks empty spawn slots on the project so confirm click can show loading", () => {
    const parent = asset({ id: "parent", status: "starred" });
    const empty = spawnChildAsset(project([parent]), "parent", {
      id: "empty-1",
    })!.child;
    const next = markProjectEmptySpawnSlotsGenerating(project([parent, empty]));
    expect(next.assets?.find((a) => a.id === "empty-1")?.status).toBe("generating");
  });
});
