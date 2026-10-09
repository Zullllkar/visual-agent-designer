import { describe, expect, it } from "vitest";
import {
  assignAssetTitles,
  deriveAssetTitle,
  displayAssetTitle,
  looksLikeGeneratedAssetId,
  toDownloadAssetFilename,
} from "./asset-title";

describe("looksLikeGeneratedAssetId", () => {
  it("flags pending and nanoid-like ids", () => {
    expect(looksLikeGeneratedAssetId("pending:direct:tgs6_Lab:0")).toBe(true);
    expect(looksLikeGeneratedAssetId("pending-direct-9c3982bea0-0")).toBe(true);
    expect(looksLikeGeneratedAssetId("xK3mPq9L2n")).toBe(true);
  });

  it("does not flag human names", () => {
    expect(looksLikeGeneratedAssetId("健身训练首页")).toBe(false);
    expect(looksLikeGeneratedAssetId("Pricing page")).toBe(false);
  });
});

describe("deriveAssetTitle", () => {
  it("keeps an existing human title", () => {
    expect(
      deriveAssetTitle({ title: "定价方案", prompt: "pending:direct:x" }),
    ).toBe("定价方案");
  });

  it("does not keep an id-like stored title", () => {
    expect(
      deriveAssetTitle({
        title: "pending-direct-abc-0",
        prompt: "健身训练首页视觉稿，暖色纸面",
      }),
    ).toBe("健身训练首页");
  });

  it("uses familyTitle when it is a real name", () => {
    expect(
      deriveAssetTitle({
        familyTitle: "会员中心",
        prompt: "A high-fidelity UI mockup",
      }),
    ).toBe("会员中心");
  });

  it("prefers a copyPlan headline", () => {
    expect(
      deriveAssetTitle({
        prompt: "ui mockup of an app",
        copyPlan: [{ role: "headline", text: "一周练出好状态" }],
      }),
    ).toBe("一周练出好状态");
  });

  it("extracts a chinese screen name from a long prompt", () => {
    expect(
      deriveAssetTitle({
        prompt: "minimal, cream paper, 健身训练首页，暖色纸面，高保真 UI mockup",
      }),
    ).toBe("健身训练首页");
  });

  it("extracts an english product screen from a mockup prompt", () => {
    expect(
      deriveAssetTitle({
        prompt:
          "A high-fidelity UI mockup of a fitness training homepage, editorial cream paper",
      }),
    ).toBe("Fitness training homepage");
  });

  it("falls back to a role label instead of the generated id", () => {
    expect(
      deriveAssetTitle({
        prompt: "pending:direct:tgs6_Lab:0",
        role: "hero",
      }),
    ).toBe("主视觉");
  });

  it("falls back to 视觉稿 instead of a raw id", () => {
    expect(deriveAssetTitle({ prompt: "", id: "xK3mPq9L2n" })).toBe("视觉稿");
  });
});

describe("assignAssetTitles", () => {
  it("numbers sibling images that would otherwise share a name", () => {
    expect(
      assignAssetTitles([
        { prompt: "product hero image cool" },
        { prompt: "product hero image warm" },
        { prompt: "product hero image overcast" },
      ]),
    ).toEqual(["Product hero 1", "Product hero 2", "Product hero 3"]);
  });

  it("keeps distinct screen names without numbering", () => {
    expect(
      assignAssetTitles([
        { prompt: "健身训练首页，暖色纸面" },
        { prompt: "定价方案页，陶土强调色" },
      ]),
    ).toEqual(["健身训练首页", "定价方案页"]);
  });
});

describe("displayAssetTitle", () => {
  it("never returns a generated id as the visible name", () => {
    expect(
      displayAssetTitle({
        id: "pending-direct-9c3982bea0-0",
        prompt: "定价方案页，陶土强调色",
      }),
    ).toBe("定价方案页");
  });
});

describe("toDownloadAssetFilename", () => {
  it("uses the human title, not the generated id", () => {
    expect(
      toDownloadAssetFilename({
        id: "pending-direct-9c3982bea0-0",
        title: "健身训练首页",
        prompt: "fitness homepage",
      }),
    ).toBe("健身训练首页.png");
  });
});
