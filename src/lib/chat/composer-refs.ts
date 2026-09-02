/**
 * Composer 参考芯片去重合并
 */

import type { ReferenceAsset } from "@/lib/project/assets-schema";

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
