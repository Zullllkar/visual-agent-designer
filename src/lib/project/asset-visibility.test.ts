import { describe, expect, it } from "vitest";
import {
  isCanvasVisibleAsset,
  isCanvasVisibleReference,
  mergeAssetsPreferDiscarded,
} from "./asset-visibility";
import type { ImageAsset, ReferenceAsset } from "./assets-schema";

function asset(
  id: string,
  status: ImageAsset["status"]
): ImageAsset {
  return {
    id,
    prompt: "p",
    src: status === "failed" ? "" : "data:image/png;base64,x",
    width: 100,
    height: 100,
    model: "t",
    createdAt: "2026-01-01T00:00:00.000Z",
    status,
  };
}

function ref(id: string, notes?: string): ReferenceAsset {
  return {
    id,
    label: "r",
    src: "data:image/png;base64,x",
    width: 100,
    height: 100,
    source: "upload",
    createdAt: "2026-01-01T00:00:00.000Z",
    notes,
  };
}

describe("asset-visibility", () => {
  it("hides failed cancelled discarded from canvas", () => {
    expect(isCanvasVisibleAsset(asset("a", "candidate"))).toBe(true);
    expect(isCanvasVisibleAsset(asset("a", "generating"))).toBe(true);
    expect(isCanvasVisibleAsset(asset("a", "failed"))).toBe(false);
    expect(isCanvasVisibleAsset(asset("a", "cancelled"))).toBe(false);
    expect(isCanvasVisibleAsset(asset("a", "discarded"))).toBe(false);
  });

  it("hides from-asset reference clones from canvas", () => {
    expect(isCanvasVisibleReference(ref("u1"))).toBe(true);
    expect(isCanvasVisibleReference(ref("c1", "from-asset:abc"))).toBe(false);
    expect(isCanvasVisibleReference(ref("c2", "other"))).toBe(true);
  });

  it("never revives discarded assets during merge", () => {
    const merged = mergeAssetsPreferDiscarded(
      [asset("a1", "discarded"), asset("a2", "starred")],
      [asset("a1", "failed"), asset("a2", "candidate")]
    );
    expect(merged.find((a) => a.id === "a1")?.status).toBe("discarded");
    expect(merged.find((a) => a.id === "a2")?.status).toBe("candidate");
  });

  it("preserves local-only assets including discarded", () => {
    const merged = mergeAssetsPreferDiscarded(
      [asset("gone", "discarded")],
      [asset("keep", "candidate")]
    );
    expect(merged.map((a) => a.id).sort()).toEqual(["gone", "keep"]);
    expect(merged.find((a) => a.id === "gone")?.status).toBe("discarded");
  });
});
