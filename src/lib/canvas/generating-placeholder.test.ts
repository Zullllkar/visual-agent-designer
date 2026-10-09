import { describe, expect, it } from "vitest";
import {
  GENERATING_PLACEHOLDER_SRC,
  isGeneratingPlaceholderSrc,
  shouldApplyNaturalImageSize,
} from "./generating-placeholder";

describe("shouldApplyNaturalImageSize", () => {
  it("rejects generating placeholder src", () => {
    expect(
      shouldApplyNaturalImageSize({
        src: GENERATING_PLACEHOLDER_SRC,
        naturalWidth: 320,
        naturalHeight: 240,
        currentWidth: 1280,
        currentHeight: 720,
      }),
    ).toBe(false);
    expect(isGeneratingPlaceholderSrc(GENERATING_PLACEHOLDER_SRC)).toBe(true);
  });

  it("rejects stale 320x240 reads after the src has already become a real image", () => {
    expect(
      shouldApplyNaturalImageSize({
        src: "/api/assets/p1/assets/office.png",
        naturalWidth: 320,
        naturalHeight: 240,
        currentWidth: 1280,
        currentHeight: 720,
      }),
    ).toBe(false);
  });

  it("accepts the real generated pixel size", () => {
    expect(
      shouldApplyNaturalImageSize({
        src: "/api/assets/p1/assets/hero.png",
        naturalWidth: 1660,
        naturalHeight: 948,
        currentWidth: 1280,
        currentHeight: 720,
      }),
    ).toBe(true);
  });
});
