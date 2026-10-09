import { describe, expect, it } from "vitest";
import { buildPalette, buildRegionSwatch, type RgbaImage } from "./palette-core";

function solid(
  width: number,
  height: number,
  fill: (x: number, y: number) => [number, number, number, number?],
): RgbaImage {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = fill(x, y);
      const i = (y * width + x) * 4;
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = a;
    }
  }
  return { width, height, pixels };
}

describe("buildPalette", () => {
  it("names background / ink / accent from a dark UI with a purple CTA", () => {
    // 100x100：深灰底，顶部 10 行近白文字，右下 20x20 紫色按钮
    const img = solid(100, 100, (x, y) => {
      if (y < 10 && x % 3 === 0) return [240, 240, 245];
      if (x >= 70 && y >= 70 && x < 90 && y < 90) return [124, 58, 237];
      return [24, 24, 32];
    });
    const palette = buildPalette(img);
    const byName = Object.fromEntries(palette.map((p) => [p.name, p]));

    expect(byName.background.value).toBe("#181820");
    expect(byName.background.share).toBeGreaterThan(0.85);
    expect(byName.ink.value).toBe("#F0F0F5");
    expect(byName.accent.value).toBe("#7C3AED");
    expect(new Set(palette.map((p) => p.name)).size).toBe(palette.length);
  });

  it("ignores transparent pixels and merges near-identical shades", () => {
    const img = solid(40, 40, (x) => {
      if (x < 5) return [0, 0, 0, 0];
      // 两种非常接近的白
      return x % 2 === 0 ? [250, 250, 250] : [247, 248, 250];
    });
    const palette = buildPalette(img);
    expect(palette).toHaveLength(1);
    expect(palette[0].name).toBe("background");
    expect(palette[0].share).toBe(1);
  });

  it("returns empty for fully transparent input", () => {
    const img = solid(8, 8, () => [0, 0, 0, 0]);
    expect(buildPalette(img)).toEqual([]);
  });
});

describe("buildRegionSwatch", () => {
  it("samples only inside the bbox and reports a saturated accent", () => {
    const img = solid(100, 100, (x, y) => {
      // 左半白、右半蓝卡片，卡片里有一条橙色进度条
      if (x < 50) return [255, 255, 255];
      if (y >= 45 && y < 55) return [255, 140, 0];
      return [30, 64, 175];
    });
    const left = buildRegionSwatch(img, { x: 0, y: 0, w: 0.5, h: 1 });
    const right = buildRegionSwatch(img, { x: 0.5, y: 0, w: 0.5, h: 1 });

    expect(left?.dominant).toBe("#FFFFFF");
    expect(left?.accent).toBeUndefined();
    expect(right?.dominant).toBe("#1E40AF");
    expect(right?.accent).toBe("#FF8C00");
    expect(right?.dominantShare).toBeCloseTo(0.9, 1);
  });

  it("returns null when the bbox contains nothing opaque", () => {
    const img = solid(20, 20, () => [0, 0, 0, 0]);
    expect(buildRegionSwatch(img, { x: 0, y: 0, w: 1, h: 1 })).toBeNull();
  });
});
