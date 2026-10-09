/**
 * Composer 参考芯片去重合并
 */

import type { ReferenceAsset } from "@/lib/project/assets-schema";
import { displayAssetTitle } from "@/lib/project/asset-title";

/** 同一张图只保留一条（id / src / from-asset notes）。 */
export function upsertComposerReference(
  current: ReferenceAsset[],
  offer: ReferenceAsset
): ReferenceAsset[] {
  const filtered = current.filter(
    (r) =>
      r.id !== offer.id &&
      !(offer.src && r.src === offer.src) &&
      !(offer.notes && r.notes && r.notes === offer.notes)
  );
  return [...filtered, offer].slice(0, 3);
}

export function composerRefIdForAsset(assetId: string): string {
  return `from-asset-${assetId}`;
}

export function referenceFromAsset(asset: {
  id: string;
  prompt?: string;
  title?: string;
  src: string;
  width?: number;
  height?: number;
}): ReferenceAsset {
  return {
    id: composerRefIdForAsset(asset.id),
    label: displayAssetTitle(asset).slice(0, 40),
    src: asset.src,
    width: asset.width || 1024,
    height: asset.height || 1024,
    source: "upload",
    createdAt: new Date().toISOString(),
    notes: `from-asset:${asset.id}`,
  };
}
