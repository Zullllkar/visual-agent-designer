import { describe, expect, it } from "vitest";
import type { ImageAsset } from "@/lib/project/assets-schema";
import type { AssetDesignSpec } from "@/lib/project/design-spec-schema";
import {
  assignLayoutHints,
  buildLayoutIRFromDesignSpec,
  buildStyleLockFromSpec,
  countMediaSlots,
  countReadyMaterials,
  markMaterialSlotsAsCode,
  resolveRegionDelivery,
} from "./layout-ir";

function mockAsset(overrides?: Partial<ImageAsset>): ImageAsset {
  return {
    id: "mock-1",
    prompt: "dark hardcore game UI landing",
    src: "data:image/png;base64,xx",
    width: 1280,
    height: 720,
    model: "test",
    createdAt: "2026-07-22T00:00:00.000Z",
    status: "starred",
    ...overrides,
  };
}

function mockSpec(overrides?: Partial<AssetDesignSpec>): AssetDesignSpec {
  return {
    version: 1,
    assetId: "mock-1",
    summary: "Dark landing with hero art",
    screenType: "landing",
    layout: "Hero top, CTA bottom",
    hierarchy: ["hero", "cta"],
    regions: [
      {
        id: "hero",
        name: "Hero illustration",
        role: "hero",
        bbox: { x: 0.05, y: 0.1, w: 0.9, h: 0.45 },
      },
      {
        id: "cta",
        name: "Primary CTA",
        role: "cta",
        bbox: { x: 0.3, y: 0.7, w: 0.4, h: 0.1 },
        copy: "Start now",
      },
    ],
    tokens: {
      colors: [{ name: "neon", value: "#39FF14" }],
      typography: [],
      radii: [8],
      spacingHints: ["tight"],
    },
    components: [],
    doNot: ["generic SaaS purple"],
    implementationNotes: ["Use real buttons"],
    source: "vision",
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
    ...overrides,
  };
}

describe("layout-ir", () => {
  it("builds media + code slots from designSpec", () => {
    const styleLock = buildStyleLockFromSpec(mockSpec());
    const layout = buildLayoutIRFromDesignSpec({
      asset: mockAsset(),
      spec: mockSpec(),
      styleLock,
    });

    expect(layout.version).toBe(1);
    expect(layout.mockupAssetId).toBe("mock-1");
    expect(countMediaSlots(layout)).toBe(1);
    expect(layout.nodes.some((n) => n.rebuildInCode === true && n.id === "cta")).toBe(
      true
    );
    const hero = layout.nodes.find((n) => n.id === "hero");
    expect(hero?.rebuildInCode).toBe(false);
    if (hero && hero.rebuildInCode === false) {
      expect(hero.prompt.toLowerCase()).toContain("isolated");
      expect(hero.status).toBe("pending");
    }
    expect(styleLock.palette).toContain("#39FF14");
    // 短 summary 可进 mood；整页叙述不得塞进 mood
    expect(styleLock.mood).toBe("Dark landing with hero art");
    expect(styleLock.dna?.accent).toBe("#39FF14");
  });

  it("does not put page-length summary into styleLock.mood", () => {
    const styleLock = buildStyleLockFromSpec(
      mockSpec({
        summary:
          "Dark, gritty industrial-style login page for the game asset platform with steel card and purple neon edge",
      })
    );
    expect(styleLock.mood).toBe("");
    expect(styleLock.summary).toContain("login page");
    // 页面叙述仍可启发式抽出材质 DNA
    expect(styleLock.dna?.finish).toBe("brushed steel");
    expect(styleLock.dna?.lighting).toBe("neon rim light");
  });

  it("prefers vision artStyle for Style DNA", () => {
    const styleLock = buildStyleLockFromSpec(
      mockSpec({
        artStyle: {
          finish: "matte glass",
          lighting: "soft glow",
          texture: "fine grain",
          edge: "glowing border",
          accent: "#AABBCC",
        },
      })
    );
    expect(styleLock.dna).toEqual({
      finish: "matte glass",
      lighting: "soft glow",
      texture: "fine grain",
      edge: "glowing border",
      accent: "#AABBCC",
    });
  });

  it("adds fallback media slot when regions are chrome-only", () => {
    const layout = buildLayoutIRFromDesignSpec({
      asset: mockAsset(),
      spec: mockSpec({
        regions: [
          {
            id: "nav",
            name: "Nav",
            role: "nav",
            bbox: { x: 0, y: 0, w: 1, h: 0.1 },
          },
        ],
      }),
    });
    expect(countMediaSlots(layout)).toBeGreaterThanOrEqual(1);
    expect(layout.meta?.warnings?.length).toBeGreaterThan(0);
  });

  it("counts ready materials", () => {
    const layout = buildLayoutIRFromDesignSpec({
      asset: mockAsset(),
      spec: mockSpec(),
    });
    expect(countReadyMaterials(layout)).toBe(0);
    const hero = layout.nodes.find((n) => n.id === "hero");
    if (hero && hero.rebuildInCode === false) {
      hero.status = "ready";
      hero.materialAssetId = "mat-1";
    }
    expect(countReadyMaterials(layout)).toBe(1);
  });

  it("marks media slots as code", () => {
    const layout = buildLayoutIRFromDesignSpec({
      asset: mockAsset(),
      spec: mockSpec(),
    });
    const record = {
      mockupAssetId: "mock-1",
      layout,
      createdAt: "2026-07-22T00:00:00.000Z",
      updatedAt: "2026-07-22T00:00:00.000Z",
    };
    const next = markMaterialSlotsAsCode(record, ["hero"]);
    const hero = next.layout.nodes.find((n) => n.id === "hero");
    expect(hero?.rebuildInCode).toBe(true);
    expect(countMediaSlots(next.layout)).toBe(0);
  });

  it("uses vision materialPrompt when provided", () => {
    const layout = buildLayoutIRFromDesignSpec({
      asset: mockAsset(),
      spec: mockSpec({
        regions: [
          {
            id: "icon-1",
            name: "Weapon icon",
            role: "icon",
            delivery: "media",
            bbox: { x: 0.1, y: 0.5, w: 0.12, h: 0.08 },
            materialPrompt:
              "Isolated sci-fi rifle icon, neon edges, transparent background.",
          },
        ],
      }),
    });
    const icon = layout.nodes.find((n) => n.id === "icon-1");
    expect(icon?.rebuildInCode).toBe(false);
    if (icon && icon.rebuildInCode === false) {
      expect(icon.prompt).toContain("Isolated sci-fi rifle icon");
    }
  });

  it("treats card thumbnail notes as media via delivery inference", () => {
    expect(
      resolveRegionDelivery({
        id: "c1",
        name: "Item card thumbnail",
        role: "card",
        notes: "bitmap weapon preview",
      })
    ).toBe("media");
  });

  it("assigns nested layoutHint from bbox containment", () => {
    const nested = assignLayoutHints([
      {
        id: "bg",
        parentAssetId: "mock-1",
        role: "background",
        bbox: { x: 0, y: 0, w: 1, h: 1 },
        rebuildInCode: false,
        prompt: "bg",
        status: "pending",
      },
      {
        id: "card",
        role: "card",
        bbox: { x: 0.2, y: 0.2, w: 0.6, h: 0.5 },
        rebuildInCode: true,
        copy: "Card",
      },
      {
        id: "icon",
        parentAssetId: "mock-1",
        role: "icon",
        bbox: { x: 0.25, y: 0.25, w: 0.1, h: 0.1 },
        rebuildInCode: false,
        prompt: "icon",
        status: "pending",
      },
    ]);
    const icon = nested.find((n) => n.id === "icon");
    const card = nested.find((n) => n.id === "card");
    const bg = nested.find((n) => n.id === "bg");
    expect(icon?.layoutHint?.parentId).toBe("card");
    expect(card?.layoutHint?.parentId).toBe("bg");
    expect(bg?.layoutHint?.parentId).toBeUndefined();
    expect(bg?.layoutHint?.zIndex).toBe(0);
  });
});
