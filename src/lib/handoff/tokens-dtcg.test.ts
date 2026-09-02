import { describe, expect, it } from "vitest";
import { toDtcgTokens } from "./tokens-dtcg";

describe("toDtcgTokens", () => {
  it("maps colors / sizes / radii to $type+$value", () => {
    const dtcg = toDtcgTokens({
      color: ["#111111", "#39FF14"],
      fontSize: [14, 24],
      radius: [8],
      moodKeywords: ["neon"],
      visualStyle: "dark hardcore",
    });

    expect(dtcg).toMatchObject({
      meta: {
        visualStyle: "dark hardcore",
        moodKeywords: ["neon"],
      },
      color: {
        "color-1": { $type: "color", $value: "#111111" },
        "color-2": { $type: "color", $value: "#39FF14" },
      },
      fontSize: {
        "size-1": { $type: "dimension", $value: "14px" },
      },
      radius: {
        "radius-1": { $type: "dimension", $value: "8px" },
      },
    });
  });
});
