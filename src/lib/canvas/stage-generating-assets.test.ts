import { describe, expect, it } from "vitest";

import { GENERATING_PLACEHOLDER_SRC } from "@/lib/canvas/generating-placeholder";
import {
  remapPendingOntoEmptySlots,
  stageGeneratingAssets,
} from "@/lib/canvas/stage-generating-assets";
import type { ImageAsset } from "@/lib/project/assets-schema";
import type { ProjectFile } from "@/lib/project/schema";

function asset(partial: Partial<ImageAsset> & Pick<ImageAsset, "id">): ImageAsset {
  return {
    prompt: "",
    src: "",
    width: 512,
    height: 512,
    model: "test",
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "candidate",
    ...partial,
  };
}

function project(assets: ImageAsset[]): ProjectFile {
  return {
    id: "proj_1",
    name: "Demo",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    pages: [],
    assets,
  };
}

describe("stageGeneratingAssets", () => {
  it("appends generating placeholders onto the project", () => {
    const pending = [
      asset({
        id: "pending_1",
        src: GENERATING_PLACEHOLDER_SRC,
        status: "generating",
        model: "pending",
      }),
    ];
    const next = stageGeneratingAssets(project([]), pending);
    expect(next.assets).toHaveLength(1);
    expect(next.assets?.[0]?.status).toBe("generating");
    expect(next.updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
  });

  it("reuses empty spawn slots with the same parent", () => {
    const parentId = "parent_1";
    const empty = asset({
      id: "empty_slot",
      parentAssetId: parentId,
      src: "",
      status: "candidate",
      createdAt: "2026-01-01T00:00:01.000Z",
    });
    const pending = [
      asset({
        id: "pending_new",
        parentAssetId: parentId,
        src: GENERATING_PLACEHOLDER_SRC,
        status: "generating",
        model: "pending",
      }),
    ];
    const remapped = remapPendingOntoEmptySlots([empty], pending);
    expect(remapped[0]?.id).toBe("empty_slot");
    expect(remapped[0]?.status).toBe("generating");

    const staged = stageGeneratingAssets(project([empty]), pending);
    expect(staged.assets).toHaveLength(1);
    expect(staged.assets?.[0]?.id).toBe("empty_slot");
    expect(staged.assets?.[0]?.status).toBe("generating");
  });
});
