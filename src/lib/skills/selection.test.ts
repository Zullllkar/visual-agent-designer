import { describe, expect, it } from "vitest";
import { HOME_TARGET_IDS } from "@/lib/targets/catalog";
import {
  findSkillById,
  isSkillCompatibleWithTarget,
  recommendSkillId,
  resolveHomeSkillChoice,
} from "./selection";

const skills = [
  { name: "web-prototype", kind: "prototype" },
  { name: "saas-landing", kind: "landing" },
  { name: "xhs-cover", kind: "xhs" },
  { name: "game-art", kind: "game-art" },
  { name: "promo-kv", kind: "promo-kv" },
  { name: "product-shot", kind: "product-shot" },
  { name: "style-board", kind: "style-board" },
] as const;

describe("findSkillById", () => {
  it("does not silently fall back when the id is missing or unknown", () => {
    const registry = skills.map((manifest) => ({ manifest }));

    expect(findSkillById(registry, undefined)).toBeNull();
    expect(findSkillById(registry, "missing")).toBeNull();
    expect(findSkillById(registry, "saas-landing")?.manifest.name).toBe("saas-landing");
  });
});

describe("skill target compatibility", () => {
  it("maps product UI skills to ui-visual and XHS to social-cover", () => {
    expect(isSkillCompatibleWithTarget("prototype", "ui-visual")).toBe(true);
    expect(isSkillCompatibleWithTarget("landing", "ui-visual")).toBe(true);
    expect(isSkillCompatibleWithTarget("xhs", "social-cover")).toBe(true);
    expect(isSkillCompatibleWithTarget("xhs", "ui-visual")).toBe(false);
    expect(isSkillCompatibleWithTarget("template", "product-shot")).toBe(true);
    expect(isSkillCompatibleWithTarget("game-art", "game-art")).toBe(true);
    expect(isSkillCompatibleWithTarget("game-art", "ui-visual")).toBe(false);
  });

  it("recommends a dedicated builtin skill for every home target", () => {
    expect(recommendSkillId(skills, "ui-visual")).toBe("web-prototype");
    expect(recommendSkillId(skills, "social-cover")).toBe("xhs-cover");
    expect(recommendSkillId(skills, "game-art")).toBe("game-art");
    expect(recommendSkillId(skills, "promo-kv")).toBe("promo-kv");
    expect(recommendSkillId(skills, "product-shot")).toBe("product-shot");
    expect(recommendSkillId(skills, "style-board")).toBe("style-board");

    for (const targetId of HOME_TARGET_IDS) {
      expect(recommendSkillId(skills, targetId)).toBeTruthy();
    }
  });
});

describe("resolveHomeSkillChoice", () => {
  it("does not auto-bind a skill before the user chooses", () => {
    expect(
      resolveHomeSkillChoice({
        current: undefined,
        skills,
        targetId: "ui-visual",
      }),
    ).toBeNull();
  });

  it("keeps an explicit opt-out instead of snapping back to the recommendation", () => {
    expect(
      resolveHomeSkillChoice({
        current: null,
        skills,
        targetId: "ui-visual",
      }),
    ).toBeNull();
  });

  it("keeps a compatible skill and drops an incompatible one without substituting", () => {
    expect(
      resolveHomeSkillChoice({
        current: "saas-landing",
        skills,
        targetId: "ui-visual",
      }),
    ).toBe("saas-landing");
    expect(
      resolveHomeSkillChoice({
        current: "web-prototype",
        skills,
        targetId: "game-art",
      }),
    ).toBeNull();
  });
});
