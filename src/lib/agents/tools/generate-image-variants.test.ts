import { describe, expect, it } from "vitest";
import type { ImageAsset } from "@/lib/project/assets-schema";
import {
  buildVariantPendingAssets,
  prepareVariantImageApproval,
  resolveVariantParent,
} from "./generate-image-variants";

function asset(
  partial: Partial<ImageAsset> & Pick<ImageAsset, "id">
): ImageAsset {
  return {
    prompt: partial.prompt ?? partial.id,
    src: partial.src ?? `data:image/png;base64,${partial.id}`,
    width: partial.width ?? 800,
    height: partial.height ?? 600,
    model: "t",
    createdAt: partial.createdAt ?? "2026-08-12T00:00:00.000Z",
    status: partial.status ?? "candidate",
    ...partial,
  };
}

describe("buildVariantPendingAssets", () => {
  it("reuses empty spawn slot ids under the same parent", () => {
    const assets = [
      asset({ id: "parent", src: "data:x" }),
      asset({
        id: "empty-1",
        src: "",
        parentAssetId: "parent",
        createdAt: "2026-08-12T01:00:00.000Z",
      }),
    ];
    const pending = buildVariantPendingAssets({
      assets,
      parentId: "parent",
      batchId: "batch-v",
      request: {
        prompt: "variant cooler",
        prompts: ["variant cooler", "variant warmer"],
        count: 2,
        width: 800,
        height: 600,
        parentAssetId: "parent",
        referenceImages: ["data:x"],
      },
    });
    expect(pending).toHaveLength(2);
    expect(pending[0]?.id).toBe("empty-1");
    expect(pending[0]?.status).toBe("generating");
    expect(pending[0]?.parentAssetId).toBe("parent");
    expect(pending[1]?.id).toMatch(/^pending-direct-/);
    expect(pending[1]?.status).toBe("generating");
  });
});

describe("prepareVariantImageApproval", () => {
  it("expands n=2 plus one prompt into two distinct prompts", () => {
    const plan = prepareVariantImageApproval(
      {
        targetAssetId: "pending-direct-E3DBR0SS-0",
        n: 2,
        prompt: "以父图为唯一参考，完全保留原图的构图、主体位置、样式",
      },
      { userMessage: "生成 2 个变体" }
    );
    expect(plan.confirmed).toBe(false);
    expect(plan.approvedArgs.n).toBeUndefined();
    expect(plan.preview.prompts).toHaveLength(2);
    expect(new Set(plan.preview.prompts).size).toBe(2);
    expect(plan.approvedArgs.count).toBe(2);
  });

  it("keeps one prompt when the user asked for a single variant", () => {
    const plan = prepareVariantImageApproval(
      {
        targetAssetId: "pending-direct-12d94bbc99-0",
        n: 4,
        prompt: "保留原图版式与文字，只调整风格光影",
      },
      {
        userMessage:
          "【引用素材: 远协#pending-direct-12d94bbc99-0】生成一个变体 一个图片",
      }
    );
    expect(plan.preview.prompts).toHaveLength(1);
    expect(plan.approvedArgs.count).toBe(1);
    expect(plan.preview.title).toBe("变体执行请求");
    expect(plan.preview.prompts[0]).not.toMatch(/Distinct treatment 2\/4/);
  });
});

describe("resolveVariantParent", () => {
  it("prefers cited asset over the most recent one", () => {
    const assets = [
      asset({ id: "xoptr9m4W3", src: "data:image/png;base64,ui" }),
      asset({ id: "newer-street", src: "data:image/png;base64,street" }),
    ];
    expect(resolveVariantParent(assets, undefined, "xoptr9m4W3")?.id).toBe(
      "xoptr9m4W3"
    );
  });

  it("prefers explicit target over cite", () => {
    const assets = [
      asset({ id: "cited", src: "data:image/png;base64,a" }),
      asset({ id: "target", src: "data:image/png;base64,b" }),
    ];
    expect(resolveVariantParent(assets, "target", "cited")?.id).toBe("target");
  });
});
