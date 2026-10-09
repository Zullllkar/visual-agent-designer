import { describe, expect, it } from "vitest";
import { isCanvasVisibleAsset } from "./asset-visibility";
import { displayAssetTitle } from "./asset-title";
import { canSpawnChildFrom } from "@/lib/canvas/spawn-child-asset";
import { isUsableReferenceImage } from "@/lib/agents/tools/utils";
import type { ProjectFile } from "./schema";
import {
  applyUploadedImageToProject,
  buildUploadedImageAsset,
  isCanvasImageFile,
  titleFromUploadFileName,
} from "./canvas-image-upload";

function project(): ProjectFile {
  return {
    id: "p1",
    slug: "p1",
    title: "omni",
    rawIdea: "omni visual project",
    createdAt: "2026-09-18T00:00:00.000Z",
    updatedAt: "2026-09-18T00:00:00.000Z",
    pages: [],
    assets: [
      {
        id: "generated-1",
        prompt: "OmniTab 首页",
        title: "OmniTab 首页",
        src: "data:image/png;base64,aaa",
        width: 1280,
        height: 720,
        model: "t",
        createdAt: "2026-09-18T00:00:00.000Z",
        status: "candidate",
        source: "generated",
      },
    ],
  };
}

describe("isCanvasImageFile", () => {
  it("accepts a jpeg even when Windows leaves MIME empty", () => {
    expect(isCanvasImageFile({ type: "", name: "hero.jpg" })).toBe(true);
    expect(isCanvasImageFile({ type: "image/jpeg", name: "hero" })).toBe(true);
    expect(isCanvasImageFile({ type: "", name: "notes.pdf" })).toBe(false);
  });
});

describe("applyUploadedImageToProject", () => {
  it("puts the user file on the canvas as a citable image-asset", () => {
    const asset = buildUploadedImageAsset({
      id: "upl_1",
      fileName: "我的草图.jpeg",
      src: "data:image/jpeg;base64,/9j/xxxx",
      width: 1600,
      height: 900,
      createdAt: "2026-09-18T12:00:00.000Z",
    });
    const next = applyUploadedImageToProject(project(), asset);
    const uploaded = next.assets?.find((item) => item.id === "upl_1");

    expect(uploaded).toMatchObject({
      source: "uploaded",
      status: "candidate",
      src: "data:image/jpeg;base64,/9j/xxxx",
    });
    expect(isCanvasVisibleAsset(uploaded!)).toBe(true);
    expect(isUsableReferenceImage(uploaded!.src)).toBe(true);
    expect(canSpawnChildFrom(uploaded)).toBe(true);
    expect(displayAssetTitle(uploaded!)).toBe("我的草图");
    expect(next.assets?.map((item) => item.id)).toEqual(["generated-1", "upl_1"]);
  });

  it("uses a human name instead of a generated id", () => {
    expect(titleFromUploadFileName("OmniTab-hero.png")).toBe("OmniTab hero");
    expect(titleFromUploadFileName("screenshot.jpg")).toBe("screenshot 图");
    expect(displayAssetTitle(buildUploadedImageAsset({
      fileName: "xK3mPq9L2n.webp",
      src: "data:image/webp;base64,xx",
      width: 10,
      height: 10,
    }))).toBe("xK3mPq9L2n 图");
  });
});
