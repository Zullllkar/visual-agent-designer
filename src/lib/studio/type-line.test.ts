import { describe, expect, it } from "vitest";
import { revealHighlighted } from "./type-line";

describe("revealHighlighted", () => {
  const title = "今天想画点什么？";

  it("types up to the highlighted word", () => {
    expect(revealHighlighted(title, "什么", 5)).toEqual({
      before: "今天想画点",
      highlight: "",
      after: "",
    });
  });

  it("keeps the highlight once those characters are visible", () => {
    expect(revealHighlighted(title, "什么", title.length)).toEqual({
      before: "今天想画点",
      highlight: "什么",
      after: "？",
    });
  });
});
