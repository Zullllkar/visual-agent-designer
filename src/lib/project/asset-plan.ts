import type { AssetPlan, AssetPlanItem } from "./schema";

export interface AssetPlanValidation { ok: boolean; errors: string[]; warnings: string[]; }

export function validateAssetPlan(plan?: AssetPlan): AssetPlanValidation {
  if (!plan) return { ok: true, errors: [], warnings: ["未创建 Asset Plan"] };
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();
  for (const item of plan.items) {
    if (ids.has(item.id)) errors.push(`重复 id: ${item.id}`);
    ids.add(item.id);
    if (!item.prompt.trim()) errors.push(`${item.purpose} 缺少 prompt`);
    if (item.priority === "required" && item.status !== "generated") warnings.push(`${item.purpose} 尚未生成`);
    if (item.referenceIds?.some((id) => !id.trim())) warnings.push(`${item.purpose} 存在空参考图 id`);
  }
  if (!plan.summary.trim()) warnings.push("计划缺少摘要");
  return { ok: errors.length === 0, errors, warnings };
}

export function reorderAssetPlan(plan: AssetPlan, fromIndex: number, toIndex: number): AssetPlan {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= plan.items.length || toIndex >= plan.items.length) return plan;
  const items = [...plan.items];
  const [moved] = items.splice(fromIndex, 1);
  items.splice(toIndex, 0, moved as AssetPlanItem);
  return { ...plan, items, updatedAt: new Date().toISOString() };
}

export interface AssetPlanDiff { added: AssetPlanItem[]; removed: AssetPlanItem[]; changed: Array<{ before: AssetPlanItem; after: AssetPlanItem }>; reordered: boolean; }

export function compareAssetPlans(before: AssetPlan, after: AssetPlan): AssetPlanDiff {
  const oldMap = new Map(before.items.map((item) => [item.id, item]));
  const newMap = new Map(after.items.map((item) => [item.id, item]));
  const added = after.items.filter((item) => !oldMap.has(item.id));
  const removed = before.items.filter((item) => !newMap.has(item.id));
  const changed = after.items.flatMap((item) => { const old = oldMap.get(item.id); return old && JSON.stringify(old) !== JSON.stringify(item) ? [{ before: old, after: item }] : []; });
  const commonBefore = before.items.filter((item) => newMap.has(item.id)).map((item) => item.id);
  const commonAfter = after.items.filter((item) => oldMap.has(item.id)).map((item) => item.id);
  return { added, removed, changed, reordered: commonBefore.join("|") !== commonAfter.join("|") };
}
