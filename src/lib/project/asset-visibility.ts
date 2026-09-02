/**
 * 画布可见素材判定
 * @author：wangjunhua
 */

import type { ImageAsset, ReferenceAsset } from "./assets-schema";

/** 出现在画布上的素材（失败/取消/废弃均不占位） */
export function isCanvasVisibleAsset(asset: ImageAsset): boolean {
  const status = asset.status ?? "candidate";
  return (
    status !== "discarded" &&
    status !== "failed" &&
    status !== "cancelled"
  );
}

/**
 * 画布上的参考图：排除「从已有生图设为参考」的克隆。
 * 那些只应进 Composer chip / 生图链路，不应再铺一张 reference-card。
 */
export function isCanvasVisibleReference(ref: ReferenceAsset): boolean {
  const notes = ref.notes ?? "";
  if (notes.startsWith("from-asset:")) return false;
  return Boolean(ref.src);
}

/**
 * 合并资产列表时：永不复活 discarded。
 * incoming 同 id 若本地已废弃，强制保持 discarded。
 */
export function mergeAssetsPreferDiscarded(
  current: ImageAsset[] | undefined,
  incoming: ImageAsset[] | undefined
): ImageAsset[] {
  const prev = current ?? [];
  const next = incoming ?? [];
  if (prev.length === 0) return next;

  const prevById = new Map(prev.map((a) => [a.id, a]));
  const nextIds = new Set(next.map((a) => a.id));

  const mergedNext = next.map((asset) => {
    const old = prevById.get(asset.id);
    if (old?.status === "discarded" && asset.status !== "discarded") {
      return { ...asset, status: "discarded" as const };
    }
    return asset;
  });

  // 保留 incoming 未携带、但本地已有的资产（含已废弃），避免异步快照丢资产
  const preserved = prev.filter((asset) => !nextIds.has(asset.id));
  return [...preserved, ...mergedNext];
}
