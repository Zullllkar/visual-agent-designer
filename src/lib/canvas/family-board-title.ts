/**
 * 家族底板标题：用户可编辑的页面名，而不是「拖整组」操作提示。
 */

export function isAutoFamilyBoardLabel(label: string): boolean {
  const trimmed = label.trim();
  return /^拖整组/.test(trimmed) || /^drag group/i.test(trimmed);
}

export function familyBoardPageName(input: {
  usedInPages?: string[];
  pages?: Array<{ id: string; name: string }>;
  architecturePages?: Array<{ id: string; name: string }>;
}): string {
  const pageId = input.usedInPages?.[0];
  if (!pageId) return "";
  const fromPages = input.pages?.find((page) => page.id === pageId)?.name?.trim();
  if (fromPages) return fromPages;
  return (
    input.architecturePages?.find((page) => page.id === pageId)?.name?.trim() ??
    ""
  );
}

export function resolveFamilyBoardTitle(input: {
  familyTitle?: string | null;
  currentLabel?: string | null;
  pageName?: string | null;
}): string {
  const current = input.currentLabel?.trim();
  if (current && !isAutoFamilyBoardLabel(current)) return current;
  const persisted = input.familyTitle?.trim();
  if (persisted) return persisted;
  return input.pageName?.trim() ?? "";
}

export function applyFamilyTitle<T extends { id: string; familyTitle?: string }>(
  assets: T[],
  rootAssetId: string,
  title: string
): T[] {
  const next = title.trim();
  return assets.map((asset) =>
    asset.id === rootAssetId
      ? { ...asset, familyTitle: next || undefined }
      : asset
  );
}
