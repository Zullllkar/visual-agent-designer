import { describe, expect, it } from "vitest";

import {
  buildDefaultDiscoveryForm,
  buildDirectionAdjustForm,
  formatDiscoveryAnswerMessage,
  hasMaterialBrief,
  isDirectionAdjustMessage,
  isDirectionConfirmMessage,
  isDiscoveryAnswerFilled,
  isDiscoveryAnswerMessage,
  mergeDiscoveryCustomAnswers,
  shouldAskDiscovery,
} from "./discovery-gate";
import type { DiscoveryQuestion } from "./tools/ask-discovery";

describe("shouldAskDiscovery", () => {
  it("asks when the brief names a deliverable but not a visual style", () => {
    expect(
      shouldAskDiscovery({
        userMessage: "帮我做一个产品落地页",
        hasBrief: false,
      })
    ).toBe(true);
  });

  it("skips when the brief already has product type and visual style", () => {
    expect(
      shouldAskDiscovery({
        userMessage: "我要开发一个剑横扫游戏，风格是像素+仙侠",
        hasBrief: false,
      })
    ).toBe(false);
  });

  it("does not re-ask after the user submitted the discovery form", () => {
    expect(
      shouldAskDiscovery({
        userMessage: "[需求确认回答]\n**要做什么？**：落地页 / 官网",
        hasBrief: false,
      })
    ).toBe(false);
  });

  it("skips when the user asks to just build", () => {
    expect(
      shouldAskDiscovery({
        userMessage: "跳过问题，直接开始生成",
        hasBrief: false,
      })
    ).toBe(false);
  });

  it("skips when a brief already exists", () => {
    expect(
      shouldAskDiscovery({
        userMessage: "帮我做一个产品落地页",
        hasBrief: true,
      })
    ).toBe(false);
  });
});

describe("hasMaterialBrief", () => {
  it("requires both a product type and a visual style", () => {
    expect(hasMaterialBrief("做个游戏")).toBe(false);
    expect(hasMaterialBrief("像素风")).toBe(false);
    expect(hasMaterialBrief("像素风仙侠游戏概念图")).toBe(true);
  });
});

describe("direction and discovery answer headers", () => {
  it("detects the direction confirm / adjust cards", () => {
    expect(isDirectionConfirmMessage("[视觉方向确认] 当前视觉方向满意，请继续生成视觉素材。")).toBe(
      true
    );
    expect(
      isDirectionAdjustMessage("[视觉方向调整] 我希望调整当前视觉方向，请先询问我需要修改的部分。")
    ).toBe(true);
    expect(isDiscoveryAnswerMessage("[form answers — discovery]\n- tone: pixel")).toBe(
      true
    );
  });
});

describe("buildDefaultDiscoveryForm", () => {
  it("prefills product type from a landing-page brief", () => {
    const form = buildDefaultDiscoveryForm("帮我做一个产品落地页");
    expect(form.questions.length).toBeGreaterThan(0);
    expect(form.questions.length).toBeLessThanOrEqual(5);
    const product = form.questions.find((q) => q.id === "productType");
    expect(product?.default).toBe("landing");
  });

  it("asks game-art questions instead of landing vs app", () => {
    const form = buildDefaultDiscoveryForm(
      "像素仙侠门派山门立绘",
      "game-art"
    );
    expect(form.questions.some((q) => q.id === "productType")).toBe(false);
    expect(form.questions.some((q) => q.id === "assetKind")).toBe(true);
  });
});

describe("buildDirectionAdjustForm", () => {
  it("asks what to change with at most five prefilled questions", () => {
    const form = buildDirectionAdjustForm("pixel xianxia");
    expect(form.title).toMatch(/调整视觉方向/);
    expect(form.questions.length).toBeGreaterThan(0);
    expect(form.questions.length).toBeLessThanOrEqual(5);
    expect(form.questions.some((q) => q.id === "mood")).toBe(true);
  });

  it("keeps pixel questions on game-art, not on ui-visual", () => {
    const game = buildDirectionAdjustForm("pixel xianxia", "game-art");
    const ui = buildDirectionAdjustForm("minimal landing", "ui-visual");
    expect(game.questions.some((q) => q.id === "pixel")).toBe(true);
    expect(ui.questions.some((q) => q.id === "pixel")).toBe(false);
  });
});

const styleQuestion: DiscoveryQuestion = {
  id: "tone",
  label: "视觉风格",
  type: "radio",
  required: true,
  options: ["poster", "cream"],
  optionLabels: { poster: "小红书爆款大字报", cream: "奶油手绘风" },
};

const faceQuestion: DiscoveryQuestion = {
  id: "face",
  label: "要不要人脸",
  type: "checkbox",
  options: ["face", "product"],
  optionLabels: { face: "要人脸", product: "要产品" },
  maxSelections: 2,
};

describe("mergeDiscoveryCustomAnswers", () => {
  it("lets a typed radio answer replace the preset chips", () => {
    const merged = mergeDiscoveryCustomAnswers(
      [styleQuestion],
      { tone: "poster" },
      { tone: "杂志编辑风，衬线标题" }
    );
    expect(merged.tone).toBe("杂志编辑风，衬线标题");
  });

  it("appends typed checkbox text when presets miss the choice", () => {
    const merged = mergeDiscoveryCustomAnswers(
      [faceQuestion],
      { face: ["product"] },
      { face: "只要手，不要脸" }
    );
    expect(merged.face).toEqual(["product", "只要手，不要脸"]);
  });
});

describe("isDiscoveryAnswerFilled", () => {
  it("treats custom text as enough for a required radio", () => {
    expect(isDiscoveryAnswerFilled(styleQuestion, undefined)).toBe(false);
    expect(isDiscoveryAnswerFilled(styleQuestion, "poster")).toBe(true);
    expect(
      isDiscoveryAnswerFilled(styleQuestion, "杂志编辑风，衬线标题")
    ).toBe(true);
  });
});

describe("formatDiscoveryAnswerMessage custom values", () => {
  it("writes free text without inventing a preset value tag", () => {
    const text = formatDiscoveryAnswerMessage(
      [styleQuestion],
      { tone: "杂志编辑风，衬线标题" }
    );
    expect(text).toContain("杂志编辑风，衬线标题");
    expect(text).not.toMatch(/\[value:\s*poster\]/);
  });
});
