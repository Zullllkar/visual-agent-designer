import { describe, expect, it } from "vitest";
import {
  formatThoughtMessageContent,
  isThoughtMessageContent,
  latestThoughtPreview,
  stripThoughtMessagePrefix,
  THOUGHT_MESSAGE_PREFIX,
} from "./thought-message";

describe("thought-message", () => {
  it("formats and detects the 💭 prefix", () => {
    const content = formatThoughtMessageContent("hello");
    expect(content.startsWith(THOUGHT_MESSAGE_PREFIX)).toBe(true);
    expect(isThoughtMessageContent(content)).toBe(true);
    expect(stripThoughtMessagePrefix(content)).toBe("hello");
  });

  it("detects legacy mojibake prefix", () => {
    const legacy = "\u9983\u6331 still thinking";
    expect(isThoughtMessageContent(legacy)).toBe(true);
    expect(stripThoughtMessagePrefix(legacy)).toBe("still thinking");
  });

  it("does not treat normal assistant text as thought", () => {
    expect(isThoughtMessageContent("普通回复")).toBe(false);
  });

  it("uses the last non-empty line as collapsed preview", () => {
    expect(latestThoughtPreview("先拆构图\n\n再选配色")).toBe("再选配色");
    expect(latestThoughtPreview("- 草图\n- 出图")).toBe("出图");
    expect(latestThoughtPreview("")).toBe("");
  });
});
