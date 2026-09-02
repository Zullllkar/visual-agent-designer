import { describe, expect, it } from "vitest";

import {
  buildGoalPromptSection,
  inferTargetFromText,
  keepRulesForTarget,
  parseTargetId,
  resolveTargetId,
  targetConflict,
} from "./resolve";
import { getTargetRecipe, HOME_TARGET_IDS } from "./catalog";

describe("target recipes", () => {
  it("exposes the six home targets", () => {
    expect(HOME_TARGET_IDS).toEqual([
      "ui-visual",
      "game-art",
      "promo-kv",
      "social-cover",
      "product-shot",
      "style-board",
    ]);
    expect(getTargetRecipe("game-art").label).toBe("游戏原画");
  });

  it("defaults a missing project target to ui-visual", () => {
    expect(parseTargetId(undefined)).toBe("ui-visual");
    expect(resolveTargetId({})).toBe("ui-visual");
  });

  it("infers a conflicting target from strong wording", () => {
    expect(inferTargetFromText("像素仙侠门派山门立绘")).toBe("game-art");
    expect(
      targetConflict("ui-visual", "像素仙侠门派山门立绘")
    ).toBe("game-art");
    expect(targetConflict("game-art", "像素仙侠门派山门立绘")).toBeNull();
  });

  it("keeps prompt contracts short and gated", () => {
    const ui = buildGoalPromptSection("ui-visual");
    const game = buildGoalPromptSection("game-art");
    expect(ui).toMatch(/界面视觉/);
    expect(ui).toMatch(/not a poster/i);
    expect(game).toMatch(/游戏原画/);
    expect(game).not.toMatch(/not a poster/i);
    expect(game.split("\n").length).toBeLessThan(16);
  });

  it("scopes avoid-poster to ui-visual only", () => {
    expect(keepRulesForTarget("ui-visual")).toContain("avoid-poster");
    expect(keepRulesForTarget("promo-kv")).not.toContain("avoid-poster");
  });
});
