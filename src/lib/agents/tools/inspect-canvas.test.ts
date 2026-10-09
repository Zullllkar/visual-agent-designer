import { describe, expect, it } from "vitest";
import { GENERATING_PLACEHOLDER_SRC } from "@/lib/canvas/generating-placeholder";
import {
  classifyInspectAsset,
  inspectCanvasNotes,
  summarizeInspectedAssets,
} from "@/lib/agents/tools/inspect-canvas";
import type { ImageAsset } from "@/lib/project/assets-schema";

function asset(partial: Partial<ImageAsset> & Pick<ImageAsset, "id" | "src">): ImageAsset {
  return {
    prompt: "office interior",
    width: 1280,
    height: 720,
    model: "test",
    createdAt: "2026-09-07T00:00:00.000Z",
    status: "candidate",
    source: "generated",
    ...partial,
  };
}

describe("inspect canvas asset classification", () => {
  it("treats real raster src as ready even when metadata is still 320x240", () => {
    const inspected = classifyInspectAsset(
      asset({
        id: "office",
        src: "/api/assets/p1/assets/office.png",
        width: 320,
        height: 240,
        status: "candidate",
      }),
    );
    expect(inspected.srcKind).toBe("image");
    expect(inspected.ready).toBe(true);
  });

  it("exposes a human title instead of the generated id", () => {
    const inspected = classifyInspectAsset(
      asset({
        id: "pending-direct-9c3982bea0-0",
        prompt: "健身训练首页，暖色纸面",
        src: "/api/assets/p1/assets/home.png",
      }),
    );
    expect(inspected.title).toBe("健身训练首页");
    expect(inspected.title).not.toBe(inspected.id);
  });

  it("does not treat generating SVG placeholders as ready", () => {
    const inspected = classifyInspectAsset(
      asset({
        id: "pending",
        src: GENERATING_PLACEHOLDER_SRC,
        width: 320,
        height: 240,
        status: "generating",
      }),
    );
    expect(inspected.srcKind).toBe("placeholder");
    expect(inspected.ready).toBe(false);
  });

  it("summarizes mixed batches without counting stale 320x240 metadata as failures", () => {
    const counts = summarizeInspectedAssets(
      [
        asset({
          id: "hero",
          src: "/api/assets/p1/assets/hero.png",
          width: 1660,
          height: 948,
        }),
        asset({
          id: "office",
          src: "/api/assets/p1/assets/office.png",
          width: 320,
          height: 240,
        }),
        asset({
          id: "street",
          src: "data:image/png;base64,abc",
          width: 320,
          height: 240,
        }),
        asset({
          id: "props",
          src: "/api/assets/p1/assets/props.png",
          width: 320,
          height: 240,
        }),
        asset({
          id: "meeting",
          src: "/api/assets/p1/assets/meeting.png",
          width: 320,
          height: 240,
        }),
      ].map(classifyInspectAsset),
    );
    expect(counts).toEqual({
      ready: 5,
      generating: 0,
      failed: 0,
      placeholder: 0,
    });
  });
});

describe("inspect canvas notes", () => {
  it("returns kind, preview and parent link for text cards", () => {
    const notes = inspectCanvasNotes([
      {
        id: "n1",
        kind: "script",
        title: "开场",
        body: "少年踏入仙门。".repeat(20),
        parentAssetId: "hero",
        createdAt: "2026-09-17T00:00:00.000Z",
      },
    ]);
    expect(notes).toEqual([
      expect.objectContaining({
        id: "n1",
        kind: "script",
        title: "开场",
        parentAssetId: "hero",
      }),
    ]);
    expect(notes[0]?.bodyPreview.length).toBeLessThanOrEqual(120);
  });
});
