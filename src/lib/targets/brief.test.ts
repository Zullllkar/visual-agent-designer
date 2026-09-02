import { describe, expect, it } from "vitest";

import {
  briefDisplayFields,
  briefEmptyCopy,
  heuristicBriefForTarget,
  inferBriefSlots,
} from "./brief";
import type { ProductBrief } from "@/lib/project/schema";

describe("inferBriefSlots", () => {
  it("reads locked discovery values for game-art", () => {
    const slots = inferBriefSlots(
      "[需求确认回答]\n**资产种类**：角色立绘 [value: portrait]\n**渲染语言**：像素 [value: pixel]\n**时代 / 门派 / 世界观**：仙侠门派",
      "game-art"
    );
    expect(slots.assetKind).toBe("portrait");
    expect(slots.render).toBe("pixel");
    expect(slots.world).toBe("仙侠门派");
  });

  it("infers game-art slots from a one-line idea", () => {
    const slots = inferBriefSlots("像素仙侠门派山门立绘", "game-art");
    expect(slots.assetKind).toBe("portrait");
    expect(slots.render).toBe("pixel");
    expect(slots.world).toMatch(/仙侠/);
  });
});

describe("heuristicBriefForTarget", () => {
  it("fills game-art slots instead of SaaS product features", () => {
    const brief = heuristicBriefForTarget("像素仙侠门派山门立绘", "game-art");
    expect(brief.platform).toBe("other");
    expect(brief.outputTargets).toEqual(["markdown"]);
    expect(brief.slots?.assetKind).toBe("portrait");
    expect(brief.slots?.render).toBe("pixel");
    expect(brief.slots?.world).toMatch(/仙侠/);
    expect(brief.coreFeatures.join(" ")).not.toMatch(/核心功能 A/);
    expect(brief.productName).not.toMatch(/App/i);
  });

  it("keeps ui-visual on a real product platform", () => {
    const brief = heuristicBriefForTarget(
      "做一个健身 App 今日训练首页",
      "ui-visual"
    );
    expect(brief.platform).toBe("app");
    expect(brief.outputTargets).toContain("cursor");
    expect(brief.slots?.productType).toBe("app_ui");
  });

  it("stores promo-kv channel and hook, not landing vs App", () => {
    const brief = heuristicBriefForTarget(
      "新品发布主视觉，必须上品牌名",
      "promo-kv"
    );
    expect(brief.platform).toBe("other");
    expect(brief.slots?.channel).toBeTruthy();
    expect(brief.coreFeatures.join(" ")).not.toMatch(/核心功能 A/);
  });

  it("keeps style-board to category and three words", () => {
    const brief = heuristicBriefForTarget("茶饮 纸感 雾绿 手写", "style-board");
    expect(brief.slots?.category).toMatch(/茶饮/);
    expect(brief.slots?.words).toMatch(/纸感/);
    expect(brief.coreFeatures).not.toContain("核心功能 A");
    expect(brief.outputTargets).toEqual(["markdown"]);
  });

  it("stores product-shot framing without inventing a product platform", () => {
    const brief = heuristicBriefForTarget("白底主图，保留外形", "product-shot");
    expect(brief.platform).toBe("other");
    expect(brief.slots?.shot).toBe("white");
  });
});

describe("briefDisplayFields", () => {
  it("shows assetKind / render / world for game-art", () => {
    const brief = heuristicBriefForTarget("像素仙侠门派山门立绘", "game-art");
    const fields = briefDisplayFields(brief, "game-art");
    expect(fields.map((field) => field.id)).toEqual([
      "assetKind",
      "render",
      "world",
    ]);
    expect(fields.map((field) => field.label)).toEqual([
      "资产种类",
      "渲染语言",
      "时代 / 门派 / 世界观",
    ]);
    expect(fields.every((field) => field.value)).toBe(true);
    expect(fields[0]?.value).toBe("角色立绘");
  });

  it("falls back to audience / positioning / features for old ui briefs", () => {
    const brief: ProductBrief = {
      productName: "X",
      positioning: "健身首页",
      targetUser: "学生",
      scenarios: [],
      coreFeatures: ["训练计划"],
      platform: "app",
      visualStyle: "clean",
      outputTargets: ["markdown"],
    };
    const fields = briefDisplayFields(brief, "ui-visual");
    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "给谁用", value: "学生" }),
        expect.objectContaining({ label: "定位", value: "健身首页" }),
        expect.objectContaining({ label: "核心功能", value: "训练计划" }),
      ])
    );
  });
});

describe("briefEmptyCopy", () => {
  it("does not ask game-art for a product brief", () => {
    const copy = briefEmptyCopy("game-art");
    expect(copy.title).toMatch(/原画|概念/);
    expect(copy.hint).not.toMatch(/产品/);
  });
});
