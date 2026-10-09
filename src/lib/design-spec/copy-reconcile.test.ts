import { describe, expect, it } from "vitest";
import type { AssetDesignSpec } from "@/lib/project/design-spec-schema";
import { extractQuotedCopy, reconcileSpecCopy, similarity } from "./copy-reconcile";

function spec(regions: AssetDesignSpec["regions"]): AssetDesignSpec {
  return {
    version: 1,
    assetId: "a1",
    summary: "",
    screenType: "landing",
    layout: "",
    hierarchy: [],
    regions,
    tokens: { colors: [], typography: [], radii: [], spacingHints: [] },
    components: [],
    doNot: [],
    implementationNotes: [],
    source: "vision",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("extractQuotedCopy", () => {
  it("pulls quoted UI text out of an image prompt and skips colors", () => {
    const prompt =
      'Dark SaaS landing, headline "Plan your week in one glance", CTA “Start free”, accent "#7C3AED", nav 「定价」';
    expect(extractQuotedCopy(prompt)).toEqual([
      "Plan your week in one glance",
      "Start free",
      "定价",
    ]);
  });
});

describe("similarity", () => {
  it("forgives typos and partial reads", () => {
    expect(
      similarity("Plan your week in one glance", "Plan your weeek in one glanse"),
    ).toBeGreaterThan(0.8);
    expect(similarity("Start free", "Start fre")).toBeGreaterThan(0.8);
    expect(similarity("Plan your week in one glance", "Plan your week")).toBeGreaterThan(0.6);
    // 太短的包含（"Start" ⊂ "Start free"）不算强信号，避免误配
    expect(similarity("Start free", "Start")).toBeLessThan(0.55);
    expect(similarity("Start free", "Pricing")).toBeLessThan(0.3);
    expect(similarity("Pricing", "Pricing plans for teams")).toBeLessThan(0.55);
  });
});

describe("reconcileSpecCopy", () => {
  const plan = [
    { id: "h", role: "headline" as const, text: "Plan your week in one glance" },
    { id: "c", role: "cta" as const, text: "Start free" },
    { id: "n", role: "nav" as const, text: "Pricing" },
  ];

  it("replaces garbled vision copy with the planned wording and tags the source", () => {
    const input = spec([
      { id: "hero", name: "Hero", role: "hero", copy: "Plan your weeek in one glanse" },
      { id: "cta", name: "CTA", role: "cta", copy: "Start fre" },
      { id: "foot", name: "Footer", role: "footer", copy: "© 2026 Acme" },
    ]);
    const out = reconcileSpecCopy(input, { copyPlan: plan });

    const byId = Object.fromEntries(out.spec.regions.map((r) => [r.id, r]));
    expect(byId.hero.copy).toBe("Plan your week in one glance");
    expect(byId.hero.copySource).toBe("plan");
    expect(byId.hero.copyObserved).toBe("Plan your weeek in one glanse");
    expect(byId.cta.copy).toBe("Start free");
    expect(byId.cta.copySource).toBe("plan");
    expect(byId.foot.copySource).toBe("vision");
    expect(byId.foot.copyObserved).toBeUndefined();

    expect(out.corrected).toBe(2);
    expect(out.visionOnly).toBe(1);
    expect(out.unplaced.map((c) => c.id)).toEqual(["n"]);
    expect(out.spec.unplacedCopy?.[0].text).toBe("Pricing");
    expect(out.spec.copyPlan).toEqual(plan);
    expect(out.spec.implementationNotes.join("\n")).toMatch(/Pricing/);
  });

  it("falls back to quoted prompt text when there is no copy plan", () => {
    const input = spec([{ id: "hero", name: "Hero", role: "hero", copy: "Ship fastr" }]);
    const out = reconcileSpecCopy(input, { prompt: 'headline "Ship faster" on a dark hero' });
    expect(out.spec.regions[0].copy).toBe("Ship faster");
    expect(out.spec.regions[0].copySource).toBe("prompt");
    expect(out.spec.unplacedCopy).toBeUndefined();
  });

  it("leaves already-authoritative regions untouched", () => {
    const input = spec([
      { id: "hero", name: "Hero", role: "hero", copy: "Custom wording", copySource: "plan" },
    ]);
    const out = reconcileSpecCopy(input, { copyPlan: plan });
    expect(out.spec.regions[0].copy).toBe("Custom wording");
    expect(out.corrected).toBe(0);
  });

  it("does not match unrelated text just because a plan exists", () => {
    const input = spec([{ id: "x", name: "X", role: "card", copy: "Weekly revenue chart" }]);
    const out = reconcileSpecCopy(input, { copyPlan: plan });
    expect(out.spec.regions[0].copy).toBe("Weekly revenue chart");
    expect(out.spec.regions[0].copySource).toBe("vision");
    expect(out.unplaced).toHaveLength(3);
  });
});
