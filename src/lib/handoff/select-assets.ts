/**
 * Handoff 素材选择：决定哪些图进入交付包
 * @author：wangjunhua
 */

import type { ImageAsset, ReferenceAsset } from "@/lib/project/assets-schema";
import type { ProjectFile } from "@/lib/project/schema";

export interface HandoffSelection {
  assetIds: string[];
  referenceIds: string[];
}

const STORAGE_PREFIX = "vad-handoff-selection:";

export function isSelectableHandoffAsset(asset: ImageAsset): boolean {
  return (
    asset.status !== "discarded" &&
    asset.status !== "failed" &&
    asset.status !== "cancelled" &&
    asset.status !== "generating" &&
    asset.source !== "materialized" &&
    !!asset.src
  );
}

export function isSelectableHandoffReference(ref: ReferenceAsset): boolean {
  return !!ref.src;
}

export function listSelectableHandoffAssets(project: ProjectFile): ImageAsset[] {
  return (project.assets ?? []).filter(isSelectableHandoffAsset);
}

export function listSelectableHandoffReferences(
  project: ProjectFile
): ReferenceAsset[] {
  return (project.references ?? []).filter(isSelectableHandoffReference);
}

/**
 * 项目的「主 mockup」：DESIGN.md 色板、验收对照、项目级 tokens 都以它为准。
 * approved / materials_ready > 已物料化 > starred > 第一张可交付整图。
 */
export function pickPrimaryMockup(project: ProjectFile): ImageAsset | undefined {
  const candidates = listSelectableHandoffAssets(project);
  return (
    candidates.find(
      (a) =>
        a.approval?.status === "approved" ||
        a.approval?.status === "materials_ready"
    ) ??
    candidates.find((a) => project.materializations?.[a.id]) ??
    candidates.find((a) => a.status === "starred") ??
    candidates[0]
  );
}

/** 默认勾选：有收藏则只勾收藏；否则勾全部可选（避免空选择阻断新手） */
export function defaultSelectedAssetIds(project: ProjectFile): string[] {
  const selectable = listSelectableHandoffAssets(project);
  const starred = selectable.filter((a) => a.status === "starred");
  return (starred.length > 0 ? starred : selectable).map((a) => a.id);
}

/** 参考图默认全选（通常是用户主动上传）；仍可在弹窗取消 */
export function defaultSelectedReferenceIds(project: ProjectFile): string[] {
  return listSelectableHandoffReferences(project).map((r) => r.id);
}

/**
 * 导出弹窗的默认勾选：有收藏只勾收藏；没有收藏则留空，
 * 逼使用者点选定稿，避免把全部探索图当施工包交出去。
 * MCP / 无勾选的 get_handoff 仍用 defaultSelectedAssetIds（有收藏用收藏，否则全选）。
 */
export function defaultHandoffSelection(project: ProjectFile): HandoffSelection {
  const selectable = listSelectableHandoffAssets(project);
  const starred = selectable.filter((a) => a.status === "starred");
  return {
    assetIds: starred.map((a) => a.id),
    referenceIds: defaultSelectedReferenceIds(project),
  };
}

/** 与当前可选集合求交。显式空数组保留为空；仅 selection 缺失时才回退默认。 */
export function sanitizeHandoffSelection(
  project: ProjectFile,
  selection: Partial<HandoffSelection> | null | undefined
): HandoffSelection {
  if (selection == null) return defaultHandoffSelection(project);
  const allowAssets = new Set(listSelectableHandoffAssets(project).map((a) => a.id));
  const allowRefs = new Set(
    listSelectableHandoffReferences(project).map((r) => r.id)
  );
  return {
    assetIds: (selection.assetIds ?? []).filter((id) => allowAssets.has(id)),
    referenceIds: (selection.referenceIds ?? []).filter((id) => allowRefs.has(id)),
  };
}

export function resolveHandoffSelection(
  project: ProjectFile,
  overrides?: Partial<HandoffSelection> | null
): HandoffSelection {
  if (overrides?.assetIds !== undefined || overrides?.referenceIds !== undefined) {
    return sanitizeHandoffSelection(project, {
      assetIds: overrides.assetIds ?? defaultSelectedAssetIds(project),
      referenceIds:
        overrides.referenceIds ?? defaultSelectedReferenceIds(project),
    });
  }
  if (typeof window !== "undefined") {
    const persisted = loadPersistedHandoffSelection(project.id);
    if (persisted) return sanitizeHandoffSelection(project, persisted);
  }
  return defaultHandoffSelection(project);
}

export function loadPersistedHandoffSelection(
  projectId: string
): HandoffSelection | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + projectId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HandoffSelection>;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      assetIds: Array.isArray(parsed.assetIds)
        ? parsed.assetIds.filter((id): id is string => typeof id === "string")
        : [],
      referenceIds: Array.isArray(parsed.referenceIds)
        ? parsed.referenceIds.filter((id): id is string => typeof id === "string")
        : [],
    };
  } catch {
    return null;
  }
}

export function savePersistedHandoffSelection(
  projectId: string,
  selection: HandoffSelection
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_PREFIX + projectId,
      JSON.stringify({
        assetIds: selection.assetIds,
        referenceIds: selection.referenceIds,
      })
    );
  } catch {
    // ignore quota / private mode
  }
}

/** 按用户勾选裁剪 project.assets / references，供预检 / zip / kickoff 共用。
 * 必须保留所选整图下的 materialized 子素材与对应 materializations，否则材料包会空。
 */
export function projectWithSelectedAssets(
  project: ProjectFile,
  selectedAssetIds: ReadonlyArray<string>,
  selectedReferenceIds?: ReadonlyArray<string>
): ProjectFile {
  const allowAssets = new Set(selectedAssetIds);
  const selectedFinals = (project.assets ?? []).filter(
    (a) => allowAssets.has(a.id) && isSelectableHandoffAsset(a)
  );
  const selectedFinalIds = new Set(selectedFinals.map((a) => a.id));

  const materializations = Object.fromEntries(
    Object.entries(project.materializations ?? {}).filter(([mockupId]) =>
      selectedFinalIds.has(mockupId)
    )
  );

  const referencedMaterialIds = new Set<string>();
  for (const record of Object.values(materializations)) {
    for (const node of record.layout.nodes) {
      if (node.rebuildInCode === false && node.materialAssetId) {
        referencedMaterialIds.add(node.materialAssetId);
      }
    }
  }

  const materialChildren = (project.assets ?? []).filter((a) => {
    if (!a.src) return false;
    if (a.status === "discarded" || a.status === "failed") return false;
    if (referencedMaterialIds.has(a.id)) return true;
    if (a.source !== "materialized") return false;
    return Boolean(a.parentAssetId && selectedFinalIds.has(a.parentAssetId));
  });

  const assetById = new Map<string, ImageAsset>();
  for (const asset of [...selectedFinals, ...materialChildren]) {
    assetById.set(asset.id, asset);
  }

  const allowRefs =
    selectedReferenceIds !== undefined
      ? new Set(selectedReferenceIds)
      : null;

  return {
    ...project,
    assets: [...assetById.values()],
    materializations:
      Object.keys(materializations).length > 0 ? materializations : undefined,
    references:
      allowRefs === null
        ? project.references
        : (project.references ?? []).filter(
            (r) => allowRefs.has(r.id) && isSelectableHandoffReference(r)
          ),
  };
}

export function projectWithHandoffSelection(
  project: ProjectFile,
  selection: HandoffSelection
): ProjectFile {
  return projectWithSelectedAssets(
    project,
    selection.assetIds,
    selection.referenceIds
  );
}
