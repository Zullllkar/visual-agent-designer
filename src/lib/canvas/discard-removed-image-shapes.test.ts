import { describe, expect, it } from "vitest";
import { imageAssetIdsFromRemovedRecords } from "./discard-removed-image-shapes";

describe("imageAssetIdsFromRemovedRecords", () => {
  it("collects image-asset ids deleted by the user so they can be discarded", () => {
    expect(
      imageAssetIdsFromRemovedRecords({
        "shape:a": {
          typeName: "shape",
          type: "image-asset",
          props: { assetId: "stuck-gen" },
        },
        "shape:note": {
          typeName: "shape",
          type: "text-note",
          props: { assetId: "ignore" },
        },
      })
    ).toEqual(["stuck-gen"]);
  });
});
