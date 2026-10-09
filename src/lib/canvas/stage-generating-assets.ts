/**
 * 生图占位：把 generating 资产写入项目，优先填同父空「+」卡
 * @author：wangjunhua
 */

import type { ImageAsset } from "@/lib/project/assets-schema";
import type { ProjectFile } from "@/lib/project/schema";
import { isEmptySpawnSlot } from "@/lib/canvas/spawn-child-asset";

function unusedEmptySlots(
  assets: ImageAsset[],
  usedEmptyIds: Set<string>,
  parentId?: string
): ImageAsset[] {
  return assets
    .filter(
      (a) =>
        isEmptySpawnSlot(a) &&
        (a.status ?? "candidate") !== "discarded" &&
        !usedEmptyIds.has(a.id) &&
        (!parentId || a.parentAssetId === parentId)
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function isGeneratingPlaceholder(asset: ImageAsset): boolean {
  return (
    (asset.status ?? "candidate") === "generating" || asset.model === "pending"
  );
}

/** 同父空占位优先承接 pending，避免再冒新卡 */
export function remapPendingOntoEmptySlots(
  assets: ImageAsset[],
  pending: ImageAsset[]
): ImageAsset[] {
  const usedEmptyIds = new Set<string>();
  return pending.map((item) => {
    const parentId = item.parentAssetId;
    const empty =
      unusedEmptySlots(assets, usedEmptyIds, parentId)[0] ??
      (parentId ? undefined : unusedEmptySlots(assets, usedEmptyIds)[0]);
    if (!empty) return item;
    usedEmptyIds.add(empty.id);
    return {
      ...item,
      id: empty.id,
      createdAt: empty.createdAt,
      parentAssetId: empty.parentAssetId ?? item.parentAssetId,
      referenceAssetIds: empty.referenceAssetIds ?? item.referenceAssetIds,
    };
  });
}

/** 把 Job 原始 pending id 对齐到画布已有占位，供执行器按同一 id 填图 */
export function alignPendingGeneratingAssets(
  current: ImageAsset[],
  pending: ImageAsset[]
): ImageAsset[] {
  const remapped = remapPendingOntoEmptySlots(current, pending);
  const claimed = new Set<string>();
  return remapped.map((item) => {
    if (current.some((asset) => asset.id === item.id)) {
      claimed.add(item.id);
      return item;
    }
    const host = current.find(
      (asset) =>
        !claimed.has(asset.id) &&
        Boolean(item.batchId) &&
        asset.batchId === item.batchId &&
        isGeneratingPlaceholder(asset)
    );
    if (!host) return item;
    claimed.add(host.id);
    return {
      ...item,
      id: host.id,
      createdAt: host.createdAt,
      parentAssetId: host.parentAssetId ?? item.parentAssetId,
      referenceAssetIds: host.referenceAssetIds ?? item.referenceAssetIds,
    };
  });
}

/** 把 Job pending 合并进现有资产：同 batch 已占位时不再追加第二张卡 */
export function mergePendingGeneratingAssets(
  current: ImageAsset[],
  pending: ImageAsset[]
): ImageAsset[] {
  if (pending.length === 0) return current;
  const aligned = alignPendingGeneratingAssets(current, pending);
  const byId = new Map(current.map((asset) => [asset.id, asset]));
  for (const item of aligned) {
    const prev = byId.get(item.id);
    byId.set(
      item.id,
      prev
        ? {
            ...prev,
            ...item,
            id: item.id,
            parentAssetId: prev.parentAssetId ?? item.parentAssetId,
            referenceAssetIds:
              prev.referenceAssetIds ?? item.referenceAssetIds,
          }
        : item
    );
  }
  return [...byId.values()];
}

/** 写入 generating 占位并刷新 updatedAt（供工具立即 project.update） */
export function stageGeneratingAssets(
  project: ProjectFile,
  pending: ImageAsset[]
): ProjectFile {
  if (pending.length === 0) return project;
  const current = project.assets ?? [];
  const assets = mergePendingGeneratingAssets(current, pending);
  return {
    ...project,
    assets,
    updatedAt: new Date().toISOString(),
  };
}
