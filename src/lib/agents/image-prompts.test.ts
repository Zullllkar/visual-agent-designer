import { describe, expect, it } from "vitest";
import {
  formatImageConfirmMarker,
  normalizeImagePrompts,
  parsePromptsFromConfirmText,
} from "./image-prompts";

describe("normalizeImagePrompts", () => {
  it("treats prompts[] as multi-type mode", () => {
    const result = normalizeImagePrompts({
      prompts: ["hero scene", "detail UI", "background mood"],
      count: 3,
    });
    expect(result.mode).toBe("multi");
    expect(result.prompts).toHaveLength(3);
    expect(result.count).toBe(3);
  });

  it("does not turn one prompt into N copies", () => {
    const result = normalizeImagePrompts({
      prompt: "one cyberpunk hero",
      count: 3,
    });
    expect(result.prompts).toEqual(["one cyberpunk hero"]);
    expect(result.count).toBe(1);
  });
});

describe("confirm marker prompts json", () => {
  it("round-trips prompts list", () => {
    const text = formatImageConfirmMarker({
      count: 2,
      prompt: "a",
      prompts: ["a", "b"],
    });
    expect(parsePromptsFromConfirmText(text)).toEqual(["a", "b"]);
  });
});
