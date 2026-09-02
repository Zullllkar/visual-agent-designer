import { nanoid } from "nanoid";

import { uniquePrompts } from "@/lib/agents/distinct-image-prompts";
import { GENERATING_PLACEHOLDER_SRC } from "@/lib/canvas/generating-placeholder";
import type { ImageProvider } from "@/lib/providers/image/types";
import type { ImageAsset } from "@/lib/project/assets-schema";

export interface DirectImageGenerationRequest {
  prompt: string;
  /** 多条不同 prompt 时优先；长度覆盖 count */
  prompts?: string[];
  count: number;
  width: number;
  height: number;
  visualStyle?: string;
  sourcePageId?: string;
  negativePrompt?: string;
  referenceImages?: string[];
  parentAssetId?: string;
  editInstruction?: string;
  editRegion?: ImageAsset["editRegion"];
  role?: ImageAsset["role"];
}

export interface DirectImageGenerationProgress {
  completed: number;
  failed: number;
  cancelled: number;
  total: number;
  currentTaskId?: string;
  message?: string;
}

export interface DirectImageGenerationResult {
  assets: ImageAsset[];
  generatedAssets: ImageAsset[];
  succeeded: number;
  failed: number;
  cancelled: number;
  errors: string[];
}

export function resolveDirectImagePrompt(input: DirectImageGenerationRequest): string {
  return input.visualStyle ? `${input.visualStyle}, ${input.prompt}` : input.prompt;
}

export function buildDirectPendingAssets(
  input: DirectImageGenerationRequest,
  batchId: string
): ImageAsset[] {
  const now = new Date().toISOString();
  const fallbackPrompt = resolveDirectImagePrompt(input);
  const prompts = uniquePrompts(
    input.prompts && input.prompts.length > 0
      ? input.prompts.map((p) =>
          input.visualStyle ? `${input.visualStyle}, ${p}` : p
        )
      : [fallbackPrompt]
  );
  return prompts.map((prompt, index) => ({
    id: directPendingAssetId(batchId, index),
    prompt,
    src: GENERATING_PLACEHOLDER_SRC,
    width: input.width,
    height: input.height,
    model: "pending",
    createdAt: now,
    batchId,
    variantGroupId: batchId,
    status: "generating" as const,
    source: input.referenceImages?.length ? ("edited" as const) : ("generated" as const),
    parentAssetId: input.parentAssetId,
    editInstruction: input.editInstruction,
    editRegion: input.editRegion,
    role: input.role,
    ...(input.sourcePageId ? { usedInPages: [] } : {}),
  }));
}

export async function runDirectImageGenerationBatch({
  image,
  input,
  initialAssets,
  pendingAssets,
  signal,
  concurrency = 2,
  onAssetsReady,
  onProgress,
}: {
  image: ImageProvider;
  input: DirectImageGenerationRequest;
  initialAssets: ImageAsset[];
  pendingAssets: ImageAsset[];
  signal?: AbortSignal;
  concurrency?: number;
  onAssetsReady?: (assets: ImageAsset[]) => void | Promise<void>;
  onProgress?: (progress: DirectImageGenerationProgress) => void | Promise<void>;
}): Promise<DirectImageGenerationResult> {
  const total = pendingAssets.length;
  const batchId = pendingAssets[0]?.batchId ?? nanoid(8);
  const now = new Date().toISOString();
  let liveAssets = ensurePendingAssets(initialAssets, pendingAssets);
  let nextIndex = 0;
  let succeeded = 0;
  let failed = 0;
  let cancelled = 0;
  const errors: string[] = [];
  const generatedAssets: ImageAsset[] = [];

  const report = async (message?: string, currentTaskId?: string) => {
    await onProgress?.({
      completed: succeeded,
      failed,
      cancelled,
      total,
      currentTaskId,
      message,
    });
  };

  const worker = async () => {
    while (true) {
      if (signal?.aborted) return;
      const index = nextIndex++;
      if (index >= total) return;
      const pending = pendingAssets[index];
      const itemPrompt =
        pending.prompt?.trim() || resolveDirectImagePrompt(input);
      await report(`Generating image ${index + 1}/${total}`, pending.id);

      let output: Awaited<ReturnType<ImageProvider["generateImage"]>>;
      try {
        const t0 = Date.now();
        output = await image.generateImage({
          prompt: itemPrompt,
          width: input.width,
          height: input.height,
          negativePrompt: input.negativePrompt,
          referenceImages: input.referenceImages,
          signal,
        });
        const asset: ImageAsset = {
          id: pending.id,
          prompt: itemPrompt,
          src: output.imageUrl,
          width: input.width,
          height: input.height,
          model: output.model,
          seed: output.seed,
          durationMs: output.durationMs ?? Date.now() - t0,
          costUsd: output.cost,
          createdAt: now,
          batchId,
          variantGroupId: pending.variantGroupId ?? batchId,
          status: "candidate",
          source: input.referenceImages?.length ? "edited" : "generated",
          parentAssetId: input.parentAssetId,
          editInstruction: input.editInstruction,
          editRegion: input.editRegion,
          role: input.role,
          ...(input.sourcePageId ? { usedInPages: [] } : {}),
        };
        liveAssets = replaceAsset(liveAssets, pending.id, asset);
        generatedAssets.push(asset);
        succeeded++;
        try {
          await onAssetsReady?.(liveAssets);
        } catch (persistError) {
          const message =
            persistError instanceof Error ? persistError.message : String(persistError);
          errors.push(message);
        }
        await report(`Finished ${succeeded}/${total} images`, pending.id);
      } catch (error) {
        if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
          return;
        }
        failed++;
        const message = error instanceof Error ? error.message : String(error);
        errors.push(message);
        liveAssets = replaceAsset(liveAssets, pending.id, {
          ...pending,
          status: "failed",
          error: message,
        });
        try {
          await onAssetsReady?.(liveAssets);
        } catch {
          /* 失败态落盘失败不影响计数 */
        }
        await report(`Image ${index + 1} failed`, pending.id);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, total)) }, () => worker())
  );

  if (signal?.aborted) {
    liveAssets = liveAssets.map((asset) => {
      if (asset.status !== "generating" || !pendingAssets.some((p) => p.id === asset.id)) {
        return asset;
      }
      cancelled++;
      return { ...asset, status: "cancelled" as const, error: "Cancelled" };
    });
    await onAssetsReady?.(liveAssets);
    await report(`Cancelled after ${succeeded} images`);
  }

  return {
    assets: liveAssets,
    generatedAssets,
    succeeded,
    failed,
    cancelled,
    errors,
  };
}

function directPendingAssetId(batchId: string, index: number): string {
  const safeBatch = batchId.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
  return `pending-direct-${safeBatch || "batch"}-${index}`;
}

function ensurePendingAssets(
  assets: ImageAsset[],
  pendingAssets: ImageAsset[]
): ImageAsset[] {
  const existingIds = new Set(assets.map((asset) => asset.id));
  return [
    ...assets,
    ...pendingAssets.filter((asset) => !existingIds.has(asset.id)),
  ];
}

function replaceAsset(
  assets: ImageAsset[],
  assetId: string,
  next: ImageAsset
): ImageAsset[] {
  let replaced = false;
  const output = assets.map((asset) => {
    if (asset.id !== assetId) return asset;
    replaced = true;
    return next;
  });
  return replaced ? output : [...output, next];
}
