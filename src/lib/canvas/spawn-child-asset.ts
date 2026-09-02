/**
 * 画布「+」派生空子节点：纯函数造占位资产
 * @author：wangjunhua
 */

import { nanoid } from "nanoid";
import type { ImageAsset } from "@/lib/project/assets-schema";
import type { ProjectFile } from "@/lib/project/schema";

export function isEmptySpawnSlot(asset: ImageAsset): boolean {
  return !asset.src?.trim();
}

/** 源图是否允许点「+」派生 */
export function canSpawnChildFrom(asset: ImageAsset | null | undefined): boolean {
  if (!asset) return false;
  const status = asset.status ?? "candidate";
  if (
    status === "discarded" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "generating"
  ) {
    return false;
  }
  return Boolean(asset.src?.trim());
}

export function spawnChildAsset(
  project: ProjectFile,
  parentAssetId: string,
  options?: { id?: string; now?: string }
): { project: ProjectFile; child: ImageAsset } | null {
  const parent = (project.assets ?? []).find((a) => a.id === parentAssetId);
  if (!canSpawnChildFrom(parent)) return null;

  const now = options?.now ?? new Date().toISOString();
  const child: ImageAsset = {
    id: options?.id ?? nanoid(10),
    prompt: "",
    src: "",
    width: parent!.width || 1024,
    height: parent!.height || 1024,
    model: parent!.model || "",
    createdAt: now,
    status: "candidate",
    source: "generated",
    parentAssetId: parent!.id,
    referenceAssetIds: [parent!.id],
  };

  return {
    child,
    project: {
      ...project,
      assets: [...(project.assets ?? []), child],
      updatedAt: now,
    },
  };
}

/**
 * 同父新生成图优先写入空「+」占位，避免再冒一个节点把空卡晾着。
 * 多空位按创建时间配对；多余 donor 保留。
 */
export function absorbIntoEmptySpawnSlots(assets: ImageAsset[]): ImageAsset[] {
  const empties = assets
    .filter(
      (a) =>
        isEmptySpawnSlot(a) &&
        Boolean(a.parentAssetId) &&
        (a.status ?? "candidate") !== "discarded"
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (empties.length === 0) return assets;

  const usedDonorIds = new Set<string>();
  const fillByEmptyId = new Map<string, ImageAsset>();

  for (const empty of empties) {
    const parentId = empty.parentAssetId!;
    const donors = assets
      .filter(
        (a) =>
          a.id !== empty.id &&
          !usedDonorIds.has(a.id) &&
          !isEmptySpawnSlot(a) &&
          a.parentAssetId === parentId &&
          (a.status ?? "candidate") !== "discarded" &&
          (a.status ?? "candidate") !== "failed" &&
          (a.status ?? "candidate") !== "cancelled" &&
          a.createdAt >= empty.createdAt
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const donor = donors[0];
    if (!donor) continue;
    usedDonorIds.add(donor.id);
    fillByEmptyId.set(empty.id, donor);
  }

  if (fillByEmptyId.size === 0) return assets;

  return assets
    .filter((a) => !usedDonorIds.has(a.id))
    .map((a) => {
      const donor = fillByEmptyId.get(a.id);
      if (!donor) return a;
      return {
        ...a,
        src: donor.src,
        prompt: donor.prompt || a.prompt,
        width: donor.width || a.width,
        height: donor.height || a.height,
        model: donor.model || a.model,
        seed: donor.seed ?? a.seed,
        durationMs: donor.durationMs ?? a.durationMs,
        costUsd: donor.costUsd ?? a.costUsd,
        batchId: donor.batchId ?? a.batchId,
        variantGroupId: donor.variantGroupId ?? a.variantGroupId,
        status: donor.status ?? "candidate",
        source: donor.source ?? a.source ?? "generated",
        role: donor.role ?? a.role,
        editInstruction: donor.editInstruction ?? a.editInstruction,
        referenceAssetIds: donor.referenceAssetIds ?? a.referenceAssetIds,
      };
    });
}
