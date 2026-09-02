import { describe, expect, it, vi } from "vitest";
import type { ImageAsset } from "@/lib/project/assets-schema";
import type { ProjectFile } from "@/lib/project/schema";
import type { ImageProvider } from "@/lib/providers/image/types";
import type { MaterializationRecord } from "./layout-ir";

vi.mock("./crop-slot", () => ({
  cropSlotFromMockup: vi.fn(async () => ({
    dataUrl: `data:image/png;base64,${"crop".repeat(40)}`,
    width: 512,
    height: 288,
  })),
}));

import {
  generateMaterialsForLayout,
  pickStyleReferenceBBox,
} from "./generate-materials";

/** 足够长，避免 acceptGeneratedMaterial 的 tiny-payload 闸门 */
const MOCK_IMG = `data:image/png;base64,${"A".repeat(120)}`;
const MOCK_IMG_NEW = `data:image/png;base64,${"B".repeat(120)}new`;
const MOCK_IMG_P = `data:image/png;base64,${"C".repeat(120)}p`;

function mockRecord(): MaterializationRecord {
  return {
    mockupAssetId: "mock-1",
    styleLock: {
      palette: ["#111"],
      mood: "dark",
      materials: "",
      doNot: [],
      summary: "dark",
    },
    layout: {
      version: 1,
      mockupAssetId: "mock-1",
      width: 1280,
      height: 720,
      referenceImage: "assets/final/mock-1.png",
      nodes: [
        {
          id: "hero",
          parentAssetId: "mock-1",
          role: "hero",
          bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.4 },
          rebuildInCode: false,
          prompt: "hero art",
          status: "ready",
          materialAssetId: "mat-old",
          media: "assets/materials/mock-1/hero.png",
          genMode: "refine",
          outputSpec: { alpha: false, tileable: false, bleed: 0.03 },
        },
      ],
    },
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
  };
}

function mockProject(): ProjectFile {
  return {
    id: "p1",
    slug: "demo",
    title: "Demo",
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
    pages: [],
    assets: [
      {
        id: "mock-1",
        prompt: "landing",
        src: "data:image/png;base64,mock",
        width: 1280,
        height: 720,
        model: "t",
        createdAt: "2026-07-22T00:00:00.000Z",
        status: "starred",
      },
      {
        id: "mat-old",
        prompt: "hero",
        src: "data:image/png;base64,old",
        width: 512,
        height: 512,
        model: "t",
        createdAt: "2026-07-22T00:00:00.000Z",
        status: "starred",
        source: "materialized",
        parentAssetId: "mock-1",
        materialSlotId: "hero",
      },
    ],
    materializations: { "mock-1": mockRecord() },
  } as ProjectFile;
}

describe("generateMaterialsForLayout forceRegen", () => {
  it("regenerates a ready slot and discards the previous material", async () => {
    const image: ImageProvider = {
      name: "mock",
      generateImage: vi.fn(async () => ({
        imageUrl: MOCK_IMG_NEW,
        model: "mock-img",
        seed: 1,
        durationMs: 1,
        cost: 0,
      })),
    };

    const project = mockProject();
    const mockup = project.assets![0] as ImageAsset;
    const result = await generateMaterialsForLayout({
      project,
      mockup,
      record: mockRecord(),
      image,
      slotIds: ["hero"],
      forceRegen: true,
    });

    expect(image.generateImage).toHaveBeenCalledTimes(1);
    const genArg = (image.generateImage as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as {
      prompt?: string;
      negativePrompt?: string;
      referenceImages?: string[];
    };
    expect(genArg?.prompt).toContain("hero art");
    expect(genArg?.prompt).toContain("SUBJECT CROP");
    expect(genArg?.prompt).not.toContain("Style lock:");
    expect(genArg?.negativePrompt).toContain("login form");
    expect(genArg?.referenceImages?.length).toBeGreaterThanOrEqual(1);
    expect(result.generatedCount).toBe(1);
    const hero = result.record.layout.nodes.find((n) => n.id === "hero");
    expect(hero && hero.rebuildInCode === false && hero.status).toBe("ready");
    expect(
      hero && hero.rebuildInCode === false && hero.materialAssetId
    ).not.toBe("mat-old");

    const old = result.project.assets?.find((a) => a.id === "mat-old");
    expect(old?.status).toBe("discarded");
    const fresh = result.project.assets?.find(
      (a) => a.source === "materialized" && a.status !== "discarded"
    );
    expect(fresh?.src).toContain("new");
  });

  it("generates multiple slots with bounded concurrency", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const image: ImageProvider = {
      name: "mock",
      generateImage: vi.fn(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 40));
        inFlight -= 1;
        return {
          imageUrl: MOCK_IMG_P,
          model: "mock-img",
          cost: 0.04,
        };
      }),
    };

    const record = mockRecord();
    record.layout.nodes = [
      {
        id: "a",
        parentAssetId: "mock-1",
        role: "hero",
        bbox: { x: 0, y: 0, w: 0.5, h: 0.5 },
        rebuildInCode: false,
        prompt: "a",
        status: "pending",
        genMode: "refine",
        outputSpec: { alpha: false, tileable: false, bleed: 0.03 },
      },
      {
        id: "b",
        parentAssetId: "mock-1",
        role: "illustration",
        bbox: { x: 0.5, y: 0, w: 0.5, h: 0.5 },
        rebuildInCode: false,
        prompt: "b",
        status: "pending",
        genMode: "refine",
        outputSpec: { alpha: false, tileable: false, bleed: 0.03 },
      },
      {
        id: "c",
        parentAssetId: "mock-1",
        role: "background",
        bbox: { x: 0, y: 0.5, w: 1, h: 0.5 },
        rebuildInCode: false,
        prompt: "c",
        status: "pending",
        genMode: "refine",
        outputSpec: { alpha: false, tileable: true, bleed: 0.02 },
      },
    ];

    const project = mockProject();
    const result = await generateMaterialsForLayout({
      project,
      mockup: project.assets![0] as ImageAsset,
      record,
      image,
      slotIds: ["a", "b", "c"],
      forceRegen: true,
      concurrency: 2,
    });

    expect(result.generatedCount).toBe(3);
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(result.estimatedCostUsd).toBe(0.12);
    expect(result.actualCostUsd).toBe(0.12);
  });

  it("sends full mockup as reference for background refine", async () => {
    const image: ImageProvider = {
      name: "mock",
      generateImage: vi.fn(async () => ({
        imageUrl: MOCK_IMG_P,
        model: "mock-img",
        cost: 0.04,
      })),
    };
    const record = mockRecord();
    record.layout.nodes = [
      {
        id: "bg",
        parentAssetId: "mock-1",
        role: "background",
        bbox: { x: 0, y: 0, w: 1, h: 1 },
        rebuildInCode: false,
        prompt: "industrial wall",
        status: "pending",
        genMode: "refine",
        outputSpec: { alpha: false, tileable: true, bleed: 0.02 },
      },
    ];
    const project = mockProject();
    const mockup = project.assets![0] as ImageAsset;
    await generateMaterialsForLayout({
      project,
      mockup,
      record,
      image,
      slotIds: ["bg"],
      forceRegen: true,
    });
    const genArg = (image.generateImage as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as {
      prompt?: string;
      referenceImages?: string[];
    };
    expect(genArg?.prompt).toContain("FULL approved mockup");
    expect(genArg?.referenceImages?.[0]).toBe(mockup.src);
    expect(genArg?.referenceImages).toHaveLength(1);
  });

  it("falls back to crop when generation fails", async () => {
    const image: ImageProvider = {
      name: "mock",
      generateImage: vi.fn(async () => {
        throw new Error("boom");
      }),
    };

    const project = mockProject();
    const mockup = project.assets![0] as ImageAsset;
    const record = mockRecord();
    // 确保走模型路径，失败后再降级到 crop
    for (const n of record.layout.nodes) {
      if (n.rebuildInCode === false) {
        n.genMode = "refine";
        n.cropPreviewSrc = MOCK_IMG;
      }
    }
    const result = await generateMaterialsForLayout({
      project,
      mockup,
      record,
      image,
      slotIds: ["hero"],
      forceRegen: true,
    });

    expect(result.generatedCount).toBe(1);
    const hero = result.record.layout.nodes.find((n) => n.id === "hero");
    expect(hero && hero.rebuildInCode === false && hero.status).toBe("ready");
    expect(
      hero && hero.rebuildInCode === false && hero.media
    ).toContain("assets/slices/");
    expect(
      hero && hero.rebuildInCode === false && hero.notes
    ).toContain("crop fallback");
  });

  it("picks background slot bbox for style reference when present", () => {
    const layout = mockRecord().layout;
    layout.nodes.push({
      id: "bg",
      parentAssetId: "mock-1",
      role: "background",
      bbox: { x: 0, y: 0, w: 1, h: 1 },
      rebuildInCode: false,
      prompt: "bg",
      status: "pending",
    });
    expect(pickStyleReferenceBBox(layout)).toEqual({
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    });
    expect(pickStyleReferenceBBox(mockRecord().layout)).toEqual({
      x: 0.02,
      y: 0.02,
      w: 0.2,
      h: 0.14,
    });
  });
});
