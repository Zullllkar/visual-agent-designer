/**
 * 画布「+」派生空子节点：纯函数造占位资产
 * @author：wangjunhua
 */

import { nanoid } from "nanoid";
import type { ImageAsset } from "@/lib/project/assets-schema";
import type { ProjectFile } from "@/lib/project/schema";
import { displayAssetTitle } from "@/lib/project/asset-title";

export function isEmptySpawnSlot(asset: ImageAsset): boolean {
  return !asset.src?.trim();
}

export function shouldShowSpawnSlotLoading(input: {
  asset: ImageAsset | null | undefined;
  assets?: ImageAsset[];
  agentRunBusy?: boolean;
  imageJobBusy?: boolean;
}): boolean {
  const asset = input.asset;
  if (!asset) return false;
  if ((asset.status ?? "candidate") === "generating") return true;
  return asset.model === "pending" && isEmptySpawnSlot(asset);
}

/** 连线后的空占位被选中时，打开父图参考输入框。 */
export function shouldShowSpawnPromptComposer(
  asset: ImageAsset | null | undefined,
  assets: ImageAsset[] | undefined,
  busy?: { agentRunBusy?: boolean; imageJobBusy?: boolean }
): boolean {
  if (!asset || !isEmptySpawnSlot(asset) || !asset.parentAssetId) return false;
  if (
    shouldShowSpawnSlotLoading({
      asset,
      assets,
      agentRunBusy: busy?.agentRunBusy,
      imageJobBusy: busy?.imageJobBusy,
    })
  ) {
    return false;
  }
  const parent = (assets ?? []).find((item) => item.id === asset.parentAssetId);
  return canSpawnChildFrom(parent);
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
  const baseName = displayAssetTitle(parent!).replace(/\s+变体(?:\s*\d+)?$/, "");
  const child: ImageAsset = {
    id: options?.id ?? nanoid(10),
    title: `${baseName} 变体`,
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
        title: donor.title ?? a.title,
        editInstruction: donor.editInstruction ?? a.editInstruction,
        referenceAssetIds: donor.referenceAssetIds ?? a.referenceAssetIds,
      };
    });
}

/** 用户点确认后立刻把空派生位标为 generating，避免等 Job 事件才出现 loading。 */
export function markEmptySpawnSlotsGenerating(assets: ImageAsset[]): ImageAsset[] {
  let changed = false;
  const next = assets.map((asset) => {
    if (!isEmptySpawnSlot(asset)) return asset;
    if ((asset.status ?? "candidate") === "generating") return asset;
    if ((asset.status ?? "candidate") === "discarded") return asset;
    changed = true;
    return { ...asset, status: "generating" as const };
  });
  return changed ? next : assets;
}

export function markProjectEmptySpawnSlotsGenerating(
  project: ProjectFile
): ProjectFile {
  const current = project.assets ?? [];
  const assets = markEmptySpawnSlotsGenerating(current);
  if (assets === current) return project;
  return { ...project, assets };
}

/**
 * 没有进行中的生图 Job 时，不要把空槽永远停在「生成中」。
 * 引用出来的空卡应回到可删除 candidate；Job 残留占位变 discarded。
 * 必须幂等：已释放过的资产再次调用应返回同一数组引用，避免 chat-stream-view 无限 upsert。
 */
export function releaseStuckGeneratingAssets(
  assets: ImageAsset[],
  input: {
    hasActiveImageJob: boolean;
    terminalBatchId?: string | null;
  }
): ImageAsset[] {
  if (input.hasActiveImageJob && !input.terminalBatchId) return assets;
  let changed = false;
  const next = assets.map((asset) => {
    const status = asset.status ?? "candidate";
    // pending 占位也算卡住，但已 discarded/failed/cancelled 的不要反复改写。
    const looksStuck =
      status === "generating" ||
      (asset.model === "pending" &&
        status !== "discarded" &&
        status !== "failed" &&
        status !== "cancelled");
    if (!looksStuck) return asset;
    const matchesBatch = Boolean(
      input.terminalBatchId && asset.batchId === input.terminalBatchId
    );
    if (input.hasActiveImageJob && !matchesBatch) return asset;
    if (isEmptySpawnSlot(asset)) {
      if (status === "candidate" && asset.error === undefined) return asset;
      changed = true;
      return { ...asset, status: "candidate" as const, error: undefined };
    }
    if (matchesBatch || asset.model === "pending" || !asset.batchId) {
      if ((status as string) === "discarded") return asset;
      changed = true;
      return { ...asset, status: "discarded" as const };
    }
    return asset;
  });
  return changed ? next : assets;
}
