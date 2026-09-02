import { describe, expect, it } from "vitest";

import {
  buildVariantImagePrompt,
  extractCitedAssetId,
  isVariantImageInstruction,
  parseRequestedImageCount,
  stripVariantScenePrompt,
} from "./utils";

describe("parseRequestedImageCount", () => {
  it("reads explicit Arabic image counts", () => {
    expect(parseRequestedImageCount("generate 1 image")).toBe(1);
    expect(parseRequestedImageCount("please make 3 pictures")).toBe(3);
    expect(parseRequestedImageCount("\u751f\u6210 2 \u5f20\u56fe")).toBe(2);
    expect(parseRequestedImageCount("\u751f\u6210 1-2 \u5f20\u56fe")).toBe(1);
  });

  it("reads common Chinese one-image requests", () => {
    expect(parseRequestedImageCount("\u53ea\u8981\u4e00\u5f20")).toBe(1);
    expect(parseRequestedImageCount("\u8865\u5145\u4e00\u5f20\u89c6\u89c9\u56fe")).toBe(1);
    expect(parseRequestedImageCount("\u5355\u5f20\u5c31\u884c")).toBe(1);
    expect(parseRequestedImageCount("\u751f\u6210\u4e00\u4e2a\u6216\u8005\u4e24\u4e2a\u56fe\u7247")).toBe(1);
    expect(parseRequestedImageCount("生成一个变体 一个图片")).toBe(1);
  });

  it("does not treat cited asset ids as image counts", () => {
    expect(
      parseRequestedImageCount(
        "【引用素材: 远协#pending-direct-12d94bbc99-0】生成一个变体 一个图片"
      )
    ).toBe(1);
    expect(
      parseRequestedImageCount(
        "【引用素材: 远协#pending-direct-xxxx4-0】生成一个变体"
      )
    ).toBe(1);
  });

  it("returns undefined when no count is requested", () => {
    expect(parseRequestedImageCount("generate a hero visual")).toBeUndefined();
  });
});

describe("variant prompt helpers", () => {
  it("extracts cited asset id from composer prefix", () => {
    expect(
      extractCitedAssetId(
        "【引用素材: Cyberpunk city street at night, narrow alley wit#xoptr9m4W3】为这张素材生成 1 个视觉变体"
      )
    ).toBe("xoptr9m4W3");
  });

  it("strips leftover scene prompt and style lock", () => {
    expect(
      stripVariantScenePrompt(
        "为这张素材生成 1 个视觉变体。参考 prompt：Cyberpunk city street at night Style lock: Top header bar"
      )
    ).toBe("为这张素材生成 1 个视觉变体。");
  });

  it("detects variant instructions", () => {
    expect(isVariantImageInstruction("为这张素材生成 2 个视觉变体")).toBe(true);
    expect(isVariantImageInstruction("画一张新的英雄图")).toBe(false);
  });

  it("keeps UI text and does not treat old prompt as a new scene", () => {
    const prompt = buildVariantImagePrompt({
      instruction:
        "为这张素材生成 1 个视觉变体。参考 prompt：Cyberpunk city street at night, narrow alley",
      parentPrompt: "Cyberpunk city street at night, narrow alley with neon signs",
    });
    expect(prompt).toMatch(/attached screenshot/);
    expect(prompt).toMatch(/every visible word/);
    expect(prompt).not.toMatch(/No text overlay/);
    expect(prompt).toMatch(/User edit: 为这张素材生成 1 个视觉变体。/);
    expect(prompt).toMatch(/Ignore any earlier generation note/);
  });
});
