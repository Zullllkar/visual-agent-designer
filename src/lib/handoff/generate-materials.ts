/**
 * 按 Layout IR 媒体槽生成独立素材（以锁定整图为参考）
 * 支持限并发并行生图 + 成本预估
 */

import "server-only";

import { nanoid } from "nanoid";
import type { ImageAsset } from "@/lib/project/assets-schema";
import type { ProjectFile } from "@/lib/project/schema";
import type { ImageProvider } from "@/lib/providers/image/types";
import { cropSlotFromMockup } from "./crop-slot";
import {
  countMediaSlots,
  countReadyMaterials,
  type BBox,
  type LayoutIR,
  type MaterializationRecord,
  type MaterialSlot,
} from "./layout-ir";
import {
  acceptGeneratedMaterial,
  ensureSlotGenPlan,
  fallbackGenMode,
  resolveSlotCropBBox,
  type MaterialGenMode,
} from "./material-gen-mode";
import {
  composeMaterialGenerationPrompt,
  materialNegativePrompt,
} from "./material-prompt";
import {
  estimateMaterializeCostUsd,
  MATERIAL_GEN_CONCURRENCY,
  MATERIAL_SLOT_COST_USD,
} from "./materialize-cost";
import { resolveAssetImageDataUrl } from "./resolve-asset-src";

export {
  estimateMaterializeCostUsd,
  MATERIAL_GEN_CONCURRENCY,
  MATERIAL_SLOT_COST_USD,
  MATERIALIZE_DECOMPOSE_COST_USD,
} from "./materialize-cost";

export async function generateMaterialsForLayout(input: {
  project: ProjectFile;
  mockup: ImageAsset;
  record: MaterializationRecord;
  image: ImageProvider;
  /** 只处理这些槽；显式传入时会强制重做（含已 ready） */
  slotIds?: string[];
  /** 强制重生：忽略库复用，丢弃旧材料资产 */
  forceRegen?: boolean;
  /** 并行生图并发度，默认 3 */
  concurrency?: number;
  abortSignal?: AbortSignal;
}): Promise<{
  project: ProjectFile;
  record: MaterializationRecord;
  generatedCount: number;
  failedCount: number;
  estimatedCostUsd: number;
  actualCostUsd: number;
}> {
  const { mockup, image, abortSignal } = input;
  const force =
    input.forceRegen === true ||
    (Array.isArray(input.slotIds) && input.slotIds.length > 0);
  const concurrency = Math.max(1, input.concurrency ?? MATERIAL_GEN_CONCURRENCY);
  let layout: LayoutIR = structuredClone(input.record.layout);
  const styleLock = input.record.styleLock;
  const existingAssets = [...(input.project.assets ?? [])];
  const discardedIds = new Set<string>();
  const newAssets: ImageAsset[] = [];
  let generatedCount = 0;
  let failedCount = 0;
  let actualCostUsd = 0;

  const targets = layout.nodes.filter((node): node is MaterialSlot => {
    if (node.rebuildInCode !== false) return false;
    if (input.slotIds?.length) return input.slotIds.includes(node.id);
    return node.status !== "ready" || !node.materialAssetId;
  });

  // 阶段 1：准备（决策 / 裁切 / 复用），串行改 layout 引用安全
  const toGenerate: MaterialSlot[] = [];
  for (const slot of targets) {
    if (abortSignal?.aborted) break;

    if (force && slot.materialAssetId) {
      discardedIds.add(slot.materialAssetId);
      slot.materialAssetId = undefined;
      slot.media = undefined;
      slot.matchedReferenceId = undefined;
    }

    Object.assign(slot, ensureSlotGenPlan(slot));
    slot.status = "generating";

    const cropBBox = resolveSlotCropBBox(slot);
    if (!slot.cropPreviewSrc && mockup.src) {
      const crop = await cropSlotFromMockup({
        src: mockup.src,
        width: mockup.width,
        height: mockup.height,
        bbox: cropBBox,
        projectId: input.project.id,
      }).catch(() => null);
      if (crop) slot.cropPreviewSrc = crop.dataUrl;
    }

    const reused = force
      ? undefined
      : findReusableMaterial(existingAssets, slot, mockup.id);
    if (reused) {
      slot.status = "ready";
      slot.materialAssetId = reused.id;
      slot.matchedReferenceId = reused.id;
      slot.media = materialPackPath(mockup.id, slot.id, reused.src);
      generatedCount += 1;
      continue;
    }

    toGenerate.push(slot);
  }

  const modelGenCount = toGenerate.filter(
    (s) => (s.genMode ?? "refine") !== "slice"
  ).length;
  const costEstimate = estimateMaterializeCostUsd({
    mediaSlotCount: countMediaSlots(layout),
    generateSlotCount: modelGenCount,
  });

  // 全局风格参考裁片（材质/背景），各槽共用
  const styleRefSrc = await buildStyleReferenceCrop({
    mockup,
    layout,
    projectId: input.project.id,
  });

  // 阶段 2：按 genMode 执行（slice 直接裁切；refine/regenerate 调模型）
  await mapPool(toGenerate, concurrency, async (slot) => {
    if (abortSignal?.aborted) {
      slot.status = "failed";
      slot.notes = [slot.notes, "aborted"].filter(Boolean).join(" | ");
      failedCount += 1;
      return;
    }

    const size = materialSizeForSlot(slot, mockup);
    let mode: MaterialGenMode = slot.genMode ?? "refine";
    // 无 crop 时 slice 不可用
    if (mode === "slice" && !slot.cropPreviewSrc) {
      mode = "refine";
      slot.genMode = "refine";
      slot.notes = [slot.notes, "slice→refine: no crop"].filter(Boolean).join(" | ");
    }

    try {
      if (mode === "slice") {
        commitSliceAsset({
          slot,
          mockup,
          size,
          newAssets,
          existingAssets,
        });
        generatedCount += 1;
        return;
      }

      let imageUrl = "";
      let prompt = "";
      let model = "";
      let seed: string | undefined;
      let durationMs: number | undefined;
      let cost: number | undefined;
      let attempts = 0;
      let currentMode: MaterialGenMode = mode;

      while (attempts < 3) {
        attempts += 1;
        if (currentMode === "slice") {
          if (!slot.cropPreviewSrc) throw new Error("slice fallback without crop");
          commitSliceAsset({
            slot,
            mockup,
            size,
            newAssets,
            existingAssets,
            note: `fallback→slice after ${mode}`,
          });
          generatedCount += 1;
          return;
        }

        prompt = composeMaterialGenerationPrompt({
          slotPrompt: slot.prompt,
          styleLock,
          role: slot.role,
          genMode: currentMode,
          outputSpec: slot.outputSpec,
        });
        const referenceImages = await buildSlotReferenceImages({
          mockup,
          slot,
          projectId: input.project.id,
          styleRefSrc,
          genMode: currentMode,
        });

        const out = await image.generateImage({
          prompt,
          width: size.width,
          height: size.height,
          referenceImages,
          negativePrompt: materialNegativePrompt(slot.role, currentMode),
          signal: abortSignal,
        });
        const accepted = acceptGeneratedMaterial({
          imageUrl: out.imageUrl,
          genMode: currentMode,
          cropPreviewSrc: slot.cropPreviewSrc,
        });
        if (accepted.ok) {
          imageUrl = out.imageUrl;
          model = out.model;
          seed = out.seed;
          durationMs = out.durationMs;
          cost = out.cost;
          slot.genMode = currentMode;
          break;
        }
        const next = fallbackGenMode(currentMode);
        slot.notes = [
          slot.notes,
          `accept failed (${accepted.reason}) → ${next ?? "stop"}`,
        ]
          .filter(Boolean)
          .join(" | ");
        if (!next) throw new Error(`accept failed: ${accepted.reason}`);
        currentMode = next;
      }

      if (!imageUrl) throw new Error("no image after retries");

      const now = new Date().toISOString();
      const asset: ImageAsset = {
        id: nanoid(10),
        prompt,
        src: imageUrl,
        width: size.width,
        height: size.height,
        model,
        seed,
        durationMs,
        costUsd: cost,
        createdAt: now,
        batchId: `mat-${mockup.id}`,
        status: "starred",
        source: "materialized",
        parentAssetId: mockup.id,
        role: mapSlotRoleToAssetRole(slot.role),
        materialSlotId: slot.id,
        referenceAssetIds: [mockup.id],
        editRegion: slot.bbox,
      };
      newAssets.push(asset);
      existingAssets.push(asset);
      slot.status = "ready";
      slot.materialAssetId = asset.id;
      slot.media = materialPackPath(mockup.id, slot.id, asset.src);
      generatedCount += 1;
      actualCostUsd += cost ?? MATERIAL_SLOT_COST_USD;
    } catch (error) {
      if (slot.cropPreviewSrc) {
        commitSliceAsset({
          slot,
          mockup,
          size,
          newAssets,
          existingAssets,
          note: `generate failed → crop fallback: ${(error as Error).message}`,
          status: "candidate",
        });
        generatedCount += 1;
      } else {
        slot.status = "failed";
        slot.notes = [
          slot.notes,
          `generate failed: ${(error as Error).message}`,
        ]
          .filter(Boolean)
          .join(" | ");
        failedCount += 1;
      }
    }
  });

  const now = new Date().toISOString();
  const record: MaterializationRecord = {
    ...input.record,
    layout,
    updatedAt: now,
  };

  const ready = countReadyMaterials(layout);
  const baseAssets = (input.project.assets ?? []).map((asset) => {
    if (discardedIds.has(asset.id)) {
      return { ...asset, status: "discarded" as const };
    }
    if (asset.id !== mockup.id) return asset;
    return {
      ...asset,
      approval: {
        status: ready > 0 ? ("materials_ready" as const) : ("materializing" as const),
        approvedAt: asset.approval?.approvedAt ?? now,
        layoutId: mockup.id,
      },
    };
  });
  const project: ProjectFile = {
    ...input.project,
    assets: [...baseAssets, ...newAssets],
    materializations: {
      ...(input.project.materializations ?? {}),
      [mockup.id]: record,
    },
    updatedAt: now,
  };

  return {
    project,
    record,
    generatedCount,
    failedCount,
    estimatedCostUsd: costEstimate.estimatedUsd,
    actualCostUsd: roundUsd(actualCostUsd),
  };
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  let index = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (index < items.length) {
        const current = items[index++];
        await worker(current);
      }
    }
  );
  await Promise.all(runners);
}

function findReusableMaterial(
  assets: ImageAsset[],
  slot: MaterialSlot,
  mockupId: string
): ImageAsset | undefined {
  return assets.find(
    (asset) =>
      asset.parentAssetId === mockupId &&
      asset.materialSlotId === slot.id &&
      asset.source === "materialized" &&
      asset.status !== "discarded" &&
      asset.status !== "failed" &&
      Boolean(asset.src)
  );
}

function materialSizeForSlot(
  slot: MaterialSlot,
  mockup: ImageAsset
): { width: number; height: number } {
  const w = Math.max(256, Math.round(mockup.width * slot.bbox.w));
  const h = Math.max(256, Math.round(mockup.height * slot.bbox.h));
  return {
    width: Math.min(1536, Math.round(w / 64) * 64 || 512),
    height: Math.min(1536, Math.round(h / 64) * 64 || 512),
  };
}

function mapSlotRoleToAssetRole(
  role: MaterialSlot["role"]
): ImageAsset["role"] {
  if (role === "decoration") return "decoration";
  if (role === "other") return "illustration";
  return role;
}

function materialPackPath(
  mockupId: string,
  slotId: string,
  src: string
): string {
  const ext = /\.jpe?g(\?|$)/i.test(src) || /^data:image\/jpeg/i.test(src)
    ? "jpg"
    : "png";
  return `assets/materials/${mockupId}/${slotId}.${ext}`;
}

function roundUsd(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * 参考图协议：
 * - background: 始终优先发整张 mockup（局部裁切无法还原连续背景）
 * - refine（其它角色）: [content crop, style crop] — content 必须在前
 * - regenerate（其它角色）: [style crop, content crop] — 风格优先
 */
async function buildSlotReferenceImages(input: {
  mockup: ImageAsset;
  slot: MaterialSlot;
  projectId: string;
  styleRefSrc?: string | null;
  genMode?: MaterialGenMode;
}): Promise<string[] | undefined> {
  const refs: string[] = [];
  const area = Math.max(0, input.slot.bbox.w) * Math.max(0, input.slot.bbox.h);
  const small = area < 0.08;
  const mode = input.genMode ?? input.slot.genMode ?? "refine";
  const isBackground = input.slot.role === "background";

  // 背景槽：整图作主参考，避免只看局部裁切导致纹理/透视接不上
  if (isBackground) {
    const full = await resolveAssetImageDataUrl(
      input.mockup.src,
      input.projectId
    );
    if (full?.startsWith("data:image/")) {
      refs.push(full);
      return refs;
    }
  }

  const cropSrc =
    input.slot.cropPreviewSrc ??
    (
      await cropSlotFromMockup({
        src: input.mockup.src,
        width: input.mockup.width,
        height: input.mockup.height,
        bbox: resolveSlotCropBBox(input.slot),
        projectId: input.projectId,
        maxEdge: small ? 512 : 768,
      }).catch(() => null)
    )?.dataUrl;

  const style =
    input.styleRefSrc?.startsWith("data:image/") ? input.styleRefSrc : null;
  const content = cropSrc?.startsWith("data:image/") ? cropSrc : null;

  if (mode === "refine") {
    if (content) refs.push(content);
    if (style && style !== content) refs.push(style);
  } else {
    if (style) refs.push(style);
    if (content && content !== style) refs.push(content);
  }

  return refs.length ? refs : undefined;
}

function commitSliceAsset(input: {
  slot: MaterialSlot;
  mockup: ImageAsset;
  size: { width: number; height: number };
  newAssets: ImageAsset[];
  existingAssets: ImageAsset[];
  note?: string;
  status?: ImageAsset["status"];
}): void {
  const src = input.slot.cropPreviewSrc;
  if (!src) throw new Error("slice requires cropPreviewSrc");
  const now = new Date().toISOString();
  const asset: ImageAsset = {
    id: nanoid(10),
    prompt: `${input.slot.prompt} (slice)`,
    src,
    width: input.size.width,
    height: input.size.height,
    model: "slice",
    createdAt: now,
    batchId: `mat-${input.mockup.id}`,
    status: input.status ?? "starred",
    source: "materialized",
    parentAssetId: input.mockup.id,
    role: mapSlotRoleToAssetRole(input.slot.role),
    materialSlotId: input.slot.id,
    referenceAssetIds: [input.mockup.id],
    editRegion: input.slot.bbox,
  };
  input.newAssets.push(asset);
  input.existingAssets.push(asset);
  input.slot.status = "ready";
  input.slot.materialAssetId = asset.id;
  input.slot.genMode = "slice";
  input.slot.media = `assets/slices/${input.mockup.id}/${input.slot.id}.png`;
  if (input.note) {
    input.slot.notes = [input.slot.notes, input.note].filter(Boolean).join(" | ");
  }
}

/** 优先 background 槽；否则取角落材质条 */
async function buildStyleReferenceCrop(input: {
  mockup: ImageAsset;
  layout: LayoutIR;
  projectId: string;
}): Promise<string | null> {
  const bbox = pickStyleReferenceBBox(input.layout);
  const crop = await cropSlotFromMockup({
    src: input.mockup.src,
    width: input.mockup.width,
    height: input.mockup.height,
    bbox,
    projectId: input.projectId,
    maxEdge: 384,
  }).catch(() => null);
  return crop?.dataUrl?.startsWith("data:image/") ? crop.dataUrl : null;
}

export function pickStyleReferenceBBox(layout: LayoutIR): BBox {
  const background = layout.nodes.find(
    (n) => n.rebuildInCode === false && n.role === "background"
  );
  if (background && background.rebuildInCode === false) {
    return background.bbox;
  }
  return { x: 0.02, y: 0.02, w: 0.2, h: 0.14 };
}
