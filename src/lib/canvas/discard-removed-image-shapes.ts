/**
 * tldraw 用户删除图片 shape 时，收集应对项目标记 discarded 的 assetId。
 */

export function imageAssetIdsFromRemovedRecords(
  removed: Record<
    string,
    {
      typeName?: string;
      type?: string;
      props?: { assetId?: unknown };
    }
  >
): string[] {
  const ids: string[] = [];
  for (const record of Object.values(removed)) {
    if (record.typeName !== "shape") continue;
    if (record.type !== "image-asset") continue;
    const assetId = record.props?.assetId;
    if (typeof assetId === "string" && assetId.trim()) ids.push(assetId);
  }
  return ids;
}
