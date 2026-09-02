import { describe, expect, it } from "vitest";
import type { ProjectFile } from "@/lib/project/schema";
import type { MaterializationRecord } from "./layout-ir";
import {
  applyAddCodeSlot,
  applyAddMediaSlot,
  applyMarkSlotsAsCode,
  applyMarkSlotsAsMedia,
  applyRemoveSlots,
  applySlotBBoxes,
  applyUpdateSlotGenMode,
  applyUpdateSlotPrompt,
  applyUpdateSlotRole,
} from "./slot-ops";

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
          materialAssetId: "mat-hero",
        },
        {
          id: "cta",
          role: "cta",
          bbox: { x: 0.3, y: 0.7, w: 0.4, h: 0.1 },
          rebuildInCode: true,
          copy: "Go",
        },
      ],
    },
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
  };
}

describe("applyMarkSlotsAsCode", () => {
  it("converts media slot to code and clears material binding", () => {
    const project = {
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
          src: "data:image/png;base64,x",
          width: 1280,
          height: 720,
          model: "t",
          createdAt: "2026-07-22T00:00:00.000Z",
          status: "starred",
          approval: {
            status: "materials_ready",
            approvedAt: "2026-07-22T00:00:00.000Z",
            layoutId: "mock-1",
          },
        },
        {
          id: "mat-hero",
          prompt: "hero",
          src: "data:image/png;base64,y",
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

    const { project: next, record } = applyMarkSlotsAsCode(project, "mock-1", [
      "hero",
    ]);
    const hero = record.layout.nodes.find((n) => n.id === "hero");
    expect(hero?.rebuildInCode).toBe(true);
    if (hero && hero.rebuildInCode === true) {
      expect(hero.role).toBe("main");
      expect(hero.media).toBeNull();
    }
    const mat = next.assets?.find((a) => a.id === "mat-hero");
    expect(mat?.materialSlotId).toBeUndefined();
    expect(mat?.status).toBe("candidate");
  });
});

describe("applySlotBBoxes", () => {
  it("updates media bbox and clears material binding", () => {
    const project = {
      id: "p1",
      slug: "demo",
      title: "Demo",
      createdAt: "2026-07-22T00:00:00.000Z",
      updatedAt: "2026-07-22T00:00:00.000Z",
      pages: [],
      assets: [],
      materializations: { "mock-1": mockRecord() },
    } as ProjectFile;

    const { record, changedSlotIds } = applySlotBBoxes(project, "mock-1", [
      { slotId: "hero", bbox: { x: 0.2, y: 0.2, w: 0.5, h: 0.3 } },
    ]);
    expect(changedSlotIds).toEqual(["hero"]);
    const hero = record.layout.nodes.find((n) => n.id === "hero");
    expect(hero?.bbox).toEqual({ x: 0.2, y: 0.2, w: 0.5, h: 0.3 });
    if (hero && hero.rebuildInCode === false) {
      expect(hero.materialAssetId).toBeUndefined();
      expect(hero.status).toBe("pending");
    }
  });
});

describe("human slot ops", () => {
  function baseProject(): ProjectFile {
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
          src: "data:image/png;base64,x",
          width: 1280,
          height: 720,
          model: "t",
          createdAt: "2026-07-22T00:00:00.000Z",
          status: "starred",
        },
      ],
      materializations: { "mock-1": mockRecord() },
    } as ProjectFile;
  }

  it("adds a manual media slot", () => {
    const { record, slotId } = applyAddMediaSlot(baseProject(), "mock-1", {
      bbox: { x: 0.1, y: 0.5, w: 0.2, h: 0.15 },
      name: "Icon A",
      role: "icon",
    });
    const node = record.layout.nodes.find((n) => n.id === slotId);
    expect(node?.rebuildInCode).toBe(false);
    expect(node?.role).toBe("icon");
  });

  it("removes slots and updates prompts", () => {
    const project = baseProject();
    const removed = applyRemoveSlots(project, "mock-1", ["cta"]);
    expect(removed.record.layout.nodes.some((n) => n.id === "cta")).toBe(false);

    const prompted = applyUpdateSlotPrompt(
      removed.project,
      "mock-1",
      "hero",
      "Isolated neon crate, transparent background."
    );
    const hero = prompted.record.layout.nodes.find((n) => n.id === "hero");
    expect(hero && hero.rebuildInCode === false && hero.prompt).toContain(
      "neon crate"
    );
  });

  it("marks code slot as media", () => {
    const { record } = applyMarkSlotsAsMedia(baseProject(), "mock-1", ["cta"]);
    const cta = record.layout.nodes.find((n) => n.id === "cta");
    expect(cta?.rebuildInCode).toBe(false);
  });

  it("adds a manual code slot and updates roles", () => {
    const added = applyAddCodeSlot(baseProject(), "mock-1", {
      bbox: { x: 0, y: 0, w: 1, h: 0.08 },
      role: "nav",
      name: "Top nav",
    });
    const code = added.record.layout.nodes.find((n) => n.id === added.slotId);
    expect(code?.rebuildInCode).toBe(true);
    expect(code?.role).toBe("nav");

    const roleMedia = applyUpdateSlotRole(
      added.project,
      "mock-1",
      "hero",
      "background"
    );
    const hero = roleMedia.record.layout.nodes.find((n) => n.id === "hero");
    expect(hero?.role).toBe("background");

    const roleCode = applyUpdateSlotRole(
      roleMedia.project,
      "mock-1",
      added.slotId,
      "footer"
    );
    const nav = roleCode.record.layout.nodes.find((n) => n.id === added.slotId);
    expect(nav?.role).toBe("footer");
  });

  it("updates genMode and outputSpec, clears material binding", () => {
    const { record } = applyUpdateSlotGenMode(baseProject(), "mock-1", "hero", {
      genMode: "slice",
      outputSpec: { alpha: true, tileable: false, bleed: 0.05 },
    });
    const hero = record.layout.nodes.find((n) => n.id === "hero");
    expect(hero && hero.rebuildInCode === false && hero.genMode).toBe("slice");
    expect(
      hero && hero.rebuildInCode === false && hero.outputSpec
    ).toEqual({ alpha: true, tileable: false, bleed: 0.05 });
    expect(
      hero && hero.rebuildInCode === false && hero.status
    ).toBe("pending");
    expect(
      hero && hero.rebuildInCode === false && hero.materialAssetId
    ).toBeUndefined();
    expect(hero && hero.rebuildInCode === false && hero.notes).toContain(
      "outputSpec"
    );
  });
});
