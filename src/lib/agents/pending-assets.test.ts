import { describe, expect, it } from "vitest";
import { GENERATING_PLACEHOLDER_SRC } from "@/lib/canvas/generating-placeholder";
import { buildPendingAssets, mergeAssetAfterGenerate } from "./pending-assets";
import type { ImageAsset } from "@/lib/project/assets-schema";
import type { ImagePlan } from "./image-planner-agent";

describe("buildPendingAssets", () => {
  it("gives each pending image a human title instead of the generated id", () => {
    const plan: ImagePlan = {
      tasks: [
        {
          pageId: "asset-board",
          nodeId: "asset-1",
          imagePrompt: "健身训练首页，暖色纸面",
          width: 1280,
          height: 720,
        },
        {
          pageId: "asset-board",
          nodeId: "asset-2",
          imagePrompt: "定价方案页，陶土强调色",
          width: 1280,
          height: 720,
        },
      ],
    };
    const pending = buildPendingAssets(plan, "batch-a");
    expect(pending.map((asset) => asset.title)).toEqual([
      "健身训练首页",
      "定价方案页",
    ]);
    expect(pending[0]?.title).not.toBe(pending[0]?.id);
    expect(pending[0]?.src).toBe(GENERATING_PLACEHOLDER_SRC);
  });
});

describe("mergeAssetAfterGenerate", () => {
  it("keeps the pending human title when the generated asset omitted it", () => {
    const pending: ImageAsset = {
      id: "pending:batch:p:n",
      title: "健身训练首页",
      prompt: "健身训练首页，暖色纸面",
      src: GENERATING_PLACEHOLDER_SRC,
      width: 1280,
      height: 720,
      model: "pending",
      createdAt: "2026-09-18T00:00:00.000Z",
      status: "generating",
    };
    const generated: ImageAsset = {
      ...pending,
      id: "xK3mPq9L2n",
      src: "data:image/png;base64,ok",
      model: "test",
      status: "candidate",
      title: undefined,
    };
    const merged = mergeAssetAfterGenerate([pending], pending.id, generated);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.title).toBe("健身训练首页");
  });
});
