import { describe, expect, it } from "vitest";
import { buildDesignContext, isPlaceholderColorTokens } from "./design-context";
import type { ProductBrief } from "./schema";

const brief: ProductBrief = {
  productName: "Vibeboard",
  positioning: "本地画布",
  targetUser: "独立开发者",
  scenarios: ["出图"],
  coreFeatures: ["画布"],
  platform: "web",
  visualStyle: "冷灰桌面",
  outputTargets: ["cursor"],
};

describe("design context placeholder palette", () => {
  it("seeds the cool-gray desk, white panel, and indigo accent", () => {
    const ctx = buildDesignContext({ brief });
    const byName = Object.fromEntries(
      ctx.colorTokens.map((token) => [token.name, token.value.toUpperCase()]),
    );
    expect(byName.background).toBe("#EDEEF1");
    expect(byName.surface).toBe("#FFFFFF");
    expect(byName.primary).toBe("#141416");
    expect(byName.ink).toBe("#141416");
    expect(byName.muted).toBe("#5C616B");
  });

  it("still treats the previous placeholder set as unset", () => {
    expect(
      isPlaceholderColorTokens([
        { value: "#4F46FF" },
        { value: "#FFFFFF" },
        { value: "#111827" },
        { value: "#64748B" },
      ]),
    ).toBe(true);
  });
});
