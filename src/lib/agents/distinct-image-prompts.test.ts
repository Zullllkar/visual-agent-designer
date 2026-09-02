import { describe, expect, it } from "vitest";

import {
  expandDistinctPrompts,
  uniquePrompts,
} from "./distinct-image-prompts";

describe("uniquePrompts", () => {
  it("drops blanks and case-insensitive duplicates", () => {
    expect(
      uniquePrompts(["  Gate  ", "gate", "", "Dawn gate"])
    ).toEqual(["Gate", "Dawn gate"]);
  });
});

describe("expandDistinctPrompts", () => {
  it("keeps a single prompt when only one image is requested", () => {
    expect(
      expandDistinctPrompts({
        basePrompt: "pixel xianxia gate",
        requestedCount: 1,
      })
    ).toEqual(["pixel xianxia gate"]);
  });

  it("expands one prompt into N distinct treatments", () => {
    const prompts = expandDistinctPrompts({
      basePrompt: "pixel xianxia gate",
      requestedCount: 2,
      kind: "variant",
    });
    expect(prompts).toHaveLength(2);
    expect(new Set(prompts.map((p) => p.toLowerCase())).size).toBe(2);
    expect(prompts.every((p) => p.includes("pixel xianxia gate"))).toBe(true);
  });

  it("keeps already-distinct prompts instead of resampling one sentence", () => {
    const prompts = expandDistinctPrompts({
      basePrompt: "a",
      requestedCount: 8,
      existing: ["cool moonlight gate", "warm dawn gate"],
    });
    expect(prompts).toEqual(["cool moonlight gate", "warm dawn gate"]);
  });
});
