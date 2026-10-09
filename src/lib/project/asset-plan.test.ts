import { describe, expect, it } from "vitest";
import { compareAssetPlans, reorderAssetPlan, validateAssetPlan } from "./asset-plan";
import type { AssetPlan } from "./schema";

const plan = (items: AssetPlan["items"]): AssetPlan => ({ version: 1, summary: "test", items, createdAt: "2026-01-01", updatedAt: "2026-01-01" });
const item = (id: string, status: "planned" | "generated" = "generated") => ({ id, role: "hero" as const, purpose: id, prompt: id, width: 512, height: 512, priority: "required" as const, status });

describe("asset plan operations", () => {
  it("reorders items and detects changes", () => {
    const before = plan([item("a"), item("b")]);
    const after = reorderAssetPlan(before, 0, 1);
    expect(after.items.map((x) => x.id)).toEqual(["b", "a"]);
    expect(compareAssetPlans(before, after).reordered).toBe(true);
  });
  it("validates required items and duplicate ids", () => {
    const result = validateAssetPlan(plan([item("a", "planned"), item("a")]));
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("重复");
    expect(result.warnings[0]).toContain("尚未生成");
  });
});
