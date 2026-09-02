import { describe, expect, it } from "vitest";

import {
  extractImageToolThumbRefs,
  imageJobCoversToolPreview,
  mergeJobThumbRefs,
  pickGeneratingImageThumbs,
  pickImageThumbnails,
} from "@/lib/chat/image-tool-thumbnails";
import type { ImageAsset } from "@/lib/project/assets-schema";
import type { ProjectFile } from "@/lib/project/schema";

function asset(partial: Partial<ImageAsset> & Pick<ImageAsset, "id" | "src">): ImageAsset {
  return {
    prompt: "",
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
    id: "p1",
    name: "Demo",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    pages: [],
    assets,
  };
}

describe("extractImageToolThumbRefs", () => {
  it("reads pendingAssetIds and batchId from object output", () => {
    expect(
      extractImageToolThumbRefs({
        batchId: "batch_a",
        pendingAssetIds: ["a1", "a2"],
        count: 2,
      })
    ).toEqual({
      batchId: "batch_a",
      assetIds: ["a1", "a2"],
      count: 2,
    });
  });

  it("reads legacy candidateAssetIds inside {ok,summary,data} envelope", () => {
    const refs = extractImageToolThumbRefs({
      ok: true,
      summary: "已为素材生成 1 张变体",
      data: {
        parentAssetId: "YIchDjWQYj",
        candidateAssetIds: ["Lg0m_vNZA6"],
      },
    });
    expect(refs.assetIds).toEqual(["Lg0m_vNZA6"]);
    expect(refs.count).toBe(1);
  });

  it("reads from JSON string output", () => {
    const refs = extractImageToolThumbRefs(
      JSON.stringify({ pendingAssetIds: ["x"], variantGroupId: "vg1" }),
      "已提交 1 张变体"
    );
    expect(refs.batchId).toBe("vg1");
    expect(refs.assetIds).toEqual(["x"]);
    expect(refs.count).toBe(1);
  });
});

describe("pickImageThumbnails", () => {
  const assets = [
    asset({ id: "old", src: "data:old", batchId: "b1" }),
    asset({ id: "mid", src: "data:mid", batchId: "b2" }),
    asset({ id: "new", src: "data:new", batchId: "b3" }),
    asset({ id: "Lg0m_vNZA6", src: "data:variant", batchId: "b4" }),
  ];

  it("binds by pendingAssetIds instead of latest assets", () => {
    const thumbs = pickImageThumbnails(project(assets), {
      assetIds: ["old"],
      count: 1,
    });
    expect(thumbs.map((a) => a.id)).toEqual(["old"]);
    expect(thumbs[0]?.src).toBe("data:old");
  });

  it("binds legacy candidate ids", () => {
    const thumbs = pickImageThumbnails(
      project(assets),
      extractImageToolThumbRefs({
        data: { candidateAssetIds: ["Lg0m_vNZA6"] },
      })
    );
    expect(thumbs.map((a) => a.id)).toEqual(["Lg0m_vNZA6"]);
  });

  it("binds by batchId when assetIds missing", () => {
    const thumbs = pickImageThumbnails(project(assets), {
      batchId: "b2",
      assetIds: [],
      count: 1,
    });
    expect(thumbs.map((a) => a.id)).toEqual(["mid"]);
  });

  it("does not fall back to newest assets when refs are missing", () => {
    const thumbs = pickImageThumbnails(project(assets), {
      assetIds: [],
      count: 1,
    });
    expect(thumbs).toEqual([]);
  });

  it("excludes generating svg placeholders from ready thumbs", () => {
    const thumbs = pickImageThumbnails(
      project([
        asset({
          id: "pending-1",
          src: "data:image/svg+xml,generating",
          status: "generating",
          batchId: "b-gen",
        }),
      ]),
      { assetIds: ["pending-1"], count: 1 }
    );
    expect(thumbs).toEqual([]);
  });

  it("returns generating assets for sidebar loading cards", () => {
    const pending = asset({
      id: "pending-1",
      src: "data:image/svg+xml,generating",
      status: "generating",
      batchId: "b-gen",
    });
    const thumbs = pickGeneratingImageThumbs(project([pending]), {
      assetIds: ["pending-1"],
      count: 1,
    });
    expect(thumbs.map((item) => item.id)).toEqual(["pending-1"]);
  });
});

describe("imageJobCoversToolPreview", () => {
  const tool = {
    id: "tool-1",
    name: "generate_image_variants" as const,
    output: { batchId: "b-gen", pendingAssetIds: ["pending-1"] },
    summary: "已提交 1 张变体",
  };

  it("covers when job.toolCallId matches the tool", () => {
    expect(
      imageJobCoversToolPreview(tool, [
        { toolCallId: "tool-1", jobType: "image_generation", batchId: "b-gen" },
      ])
    ).toBe(true);
  });

  it("covers when job.batchId matches the tool batch", () => {
    expect(
      imageJobCoversToolPreview(tool, [
        { jobType: "direct_image_generation", batchId: "b-gen" },
      ])
    ).toBe(true);
  });

  it("does not cover an unrelated job", () => {
    expect(
      imageJobCoversToolPreview(tool, [
        { toolCallId: "other", jobType: "image_generation", batchId: "other-batch" },
      ])
    ).toBe(false);
  });
});

describe("mergeJobThumbRefs", () => {
  it("keeps tool pendingAssetIds so the job card owns the preview", () => {
    expect(
      mergeJobThumbRefs(
        { batchId: "b-gen", total: 1 },
        { output: { pendingAssetIds: ["pending-1"], batchId: "b-gen" } }
      )
    ).toEqual({
      batchId: "b-gen",
      assetIds: ["pending-1"],
      count: 1,
    });
  });
});
