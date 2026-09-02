/**
 * 生图占位：把 generating 资产写入项目，优先填同父空「+」卡
 * @author：wangjunhua
 */

import type { ImageAsset } from "@/lib/project/assets-schema";
import type { ProjectFile } from "@/lib/project/schema";
import { isEmptySpawnSlot } from "@/lib/canvas/spawn-child-asset";

/** 同父空占位优先承接 pending，避免再冒新卡 */
export function remapPendingOntoEmptySlots(
  assets: ImageAsset[],
  pending: ImageAsset[]
): ImageAsset[] {
  const usedEmptyIds = new Set<string>();
  return pending.map((item) => {
    const parentId = item.parentAssetId;
    if (!parentId) return item;
    const empty = assets
      .filter(
        (a) =>
          isEmptySpawnSlot(a) &&
          a.parentAssetId === parentId &&
          (a.status ?? "candidate") !== "discarded" &&
          !usedEmptyIds.has(a.id)
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!empty) return item;
    usedEmptyIds.add(empty.id);
    return {
      ...item,
      id: empty.id,
      createdAt: empty.createdAt,
      referenceAssetIds: empty.referenceAssetIds ?? item.referenceAssetIds,
    };
  });
}

/** 写入 generating 占位并刷新 updatedAt（供工具立即 project.update） */
export function stageGeneratingAssets(
  project: ProjectFile,
  pending: ImageAsset[]
): ProjectFile {
  if (pending.length === 0) return project;
  const current = project.assets ?? [];
  const staged = remapPendingOntoEmptySlots(current, pending);
  const stagedIds = new Set(staged.map((a) => a.id));
  return {
    ...project,
    assets: [...current.filter((a) => !stagedIds.has(a.id)), ...staged],
    updatedAt: new Date().toISOString(),
  };
}
