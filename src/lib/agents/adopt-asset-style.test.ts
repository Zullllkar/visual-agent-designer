import { describe, expect, it } from "vitest";

import { parsePageReference } from "./orchestrator-planner";
import {
  ADOPT_ASSET_STYLE_TAG,
  buildAdoptAssetStyleMessage,
  buildAdoptedDesignDirection,
  isAdoptAssetStyleMessage,
  pickStyleRestyleTargets,
} from "./adopt-asset-style";

describe("adopt asset style helpers", () => {
  it("builds a message the planner can parse as adopt + asset id", () => {
    const message = buildAdoptAssetStyleMessage({
      id: "asset_liked",
      prompt: "像素仙侠门派山门，金色飞檐",
    });
    expect(message).toContain(ADOPT_ASSET_STYLE_TAG);
    expect(isAdoptAssetStyleMessage(message)).toBe(true);
    expect(parsePageReference(message).assetId).toBe("asset_liked");
  });

  it("locks the project direction to the selected picture", () => {
    const direction = buildAdoptedDesignDirection({
      existing: {
        summary: "旧方向：冷色杂志风",
        moodKeywords: ["editorial"],
      },
      assetPrompt: "像素仙侠门派山门，金色飞檐",
      visualStyle: "像素 / 仙侠",
      assetId: "asset_liked",
    });
    expect(direction.summary).toMatch(/像素仙侠门派山门/);
    expect(direction.moodKeywords).toEqual(
      expect.arrayContaining(["像素", "仙侠"])
    );
    expect(direction.styleSourceAssetId).toBe("asset_liked");
  });

  it("restyles other finished assets but keeps the source picture", () => {
    const targets = pickStyleRestyleTargets(
      [
        { id: "asset_liked", status: "starred", src: "data:image/png;base64,aaa" },
        { id: "asset_old", status: "candidate", src: "data:image/png;base64,bbb" },
        { id: "asset_gone", status: "discarded", src: "data:image/png;base64,ccc" },
        { id: "asset_busy", status: "generating", src: "data:image/png;base64,ddd" },
      ],
      "asset_liked"
    );
    expect(targets.map((asset) => asset.id)).toEqual(["asset_old"]);
  });
});
