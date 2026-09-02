/**
 * 丢弃素材：标记 discarded（勿从数组物理删除）
 * --------------------------------------------------------------
 * project-store.upsert 的 mergeProjectAssets 会把「incoming 里缺失的
 * asset」从 current 合并回来，导致 filter 删除看起来像「删不掉」。
 * 与 batch_delete_assets / 画布同步（跳过 discarded）对齐。
 *
 * @author：wangjunhua
 */

import type { ProjectFile } from "./schema";

export function discardAssetsInProject(
  project: ProjectFile,
  assetIds: ReadonlyArray<string>
): ProjectFile {
  const idSet = new Set(assetIds);
  let changed = false;
  const assets = (project.assets ?? []).map((asset) => {
    if (!idSet.has(asset.id) || asset.status === "discarded") return asset;
    changed = true;
    return { ...asset, status: "discarded" as const };
  });
  if (!changed) return project;
  return {
    ...project,
    assets,
    updatedAt: new Date().toISOString(),
  };
}
