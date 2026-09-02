import { describe, expect, it } from "vitest";
import {
  acceptGeneratedMaterial,
  expandBBoxForBleed,
  fallbackGenMode,
  suggestGenMode,
  tightenBBoxForAtomic,
} from "./material-gen-mode";

describe("suggestGenMode", () => {
  it("defaults icon / small slots to slice + alpha", () => {
    const icon = suggestGenMode({
      role: "icon",
      bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    });
    expect(icon.genMode).toBe("slice");
    expect(icon.outputSpec.alpha).toBe(true);
    expect(icon.reasons).toContain("atomic-role");

    const tiny = suggestGenMode({
      role: "illustration",
      bbox: { x: 0, y: 0, w: 0.1, h: 0.1 },
    });
    expect(tiny.genMode).toBe("slice");
    expect(tiny.reasons).toContain("small-area");
  });

  it("prefers refine for background / hero", () => {
    const bg = suggestGenMode({
      role: "background",
      bbox: { x: 0, y: 0, w: 1, h: 1 },
    });
    expect(bg.genMode).toBe("refine");
    expect(bg.outputSpec.tileable).toBe(true);

    const hero = suggestGenMode({
      role: "hero",
      bbox: { x: 0.1, y: 0.1, w: 0.5, h: 0.4 },
    });
    expect(hero.genMode).toBe("refine");
    expect(hero.reasons).toContain("scene-role");
  });

  it("switches to regenerate when prompt asks for redraw", () => {
    const out = suggestGenMode({
      role: "illustration",
      bbox: { x: 0.1, y: 0.1, w: 0.4, h: 0.3 },
      prompt: "请全新重绘一版不同构图",
    });
    expect(out.genMode).toBe("regenerate");
    expect(out.reasons).toContain("prompt-asks-regenerate");
  });
});

describe("bbox helpers", () => {
  it("expands for bleed and clamps", () => {
    const expanded = expandBBoxForBleed({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, 0.05);
    expect(expanded.x).toBeCloseTo(0.05);
    expect(expanded.y).toBeCloseTo(0.05);
    expect(expanded.w).toBeCloseTo(0.3);
    expect(expanded.h).toBeCloseTo(0.3);

    const edge = expandBBoxForBleed({ x: 0, y: 0, w: 0.1, h: 0.1 }, 0.2);
    expect(edge.x).toBe(0);
    expect(edge.y).toBe(0);
    expect(edge.w).toBeGreaterThan(0.1);
  });

  it("tightens atomic bbox", () => {
    const tight = tightenBBoxForAtomic(
      { x: 0.2, y: 0.2, w: 0.1, h: 0.1 },
      "icon"
    );
    expect(tight.w).toBeLessThan(0.1);
    expect(tightenBBoxForAtomic({ x: 0, y: 0, w: 1, h: 1 }, "hero")).toEqual({
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    });
  });
});

describe("accept / fallback", () => {
  it("rejects empty or tiny payloads", () => {
    expect(acceptGeneratedMaterial({ imageUrl: "", genMode: "refine" }).ok).toBe(
      false
    );
    expect(
      acceptGeneratedMaterial({
        imageUrl: "data:image/png;base64,abc",
        genMode: "refine",
      }).reason
    ).toBe("tiny-payload");
  });

  it("rejects identical-to-crop for model modes", () => {
    const crop = "data:image/png;base64," + "A".repeat(100);
    expect(
      acceptGeneratedMaterial({
        imageUrl: crop,
        genMode: "refine",
        cropPreviewSrc: crop,
      }).reason
    ).toBe("identical-to-crop");
    expect(
      acceptGeneratedMaterial({
        imageUrl: crop,
        genMode: "slice",
        cropPreviewSrc: crop,
      }).ok
    ).toBe(true);
  });

  it("falls back regenerate→refine→slice", () => {
    expect(fallbackGenMode("regenerate")).toBe("refine");
    expect(fallbackGenMode("refine")).toBe("slice");
    expect(fallbackGenMode("slice")).toBeNull();
  });
});
