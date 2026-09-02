/**
 * 侧栏生图工具缩略图选取
 * --------------------------------------------------------------
 * 必须按本轮 batchId / assetIds 绑定，禁止「最新 N 张」回退，
 * 否则历史 ToolBlock 会全部显示成刚生成的那张图。
 *
 * 兼容历史字段：candidateAssetIds、以及 { ok, summary, data } 信封。
 *
 * @author：wangjunhua
 */

import type { ImageAsset } from "@/lib/project/assets-schema";
import type { ProjectFile } from "@/lib/project/schema";

export interface ImageToolThumbRefs {
  batchId?: string;
  assetIds: string[];
  count: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseOutput(output: unknown): Record<string, unknown> | null {
  if (typeof output === "string") {
    const trimmed = output.trim();
    if (!trimmed) return null;
    try {
      return asRecord(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }
  return asRecord(output);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0
  );
}

/** 展开工具 output（兼容 data 嵌套信封） */
export function resolveImageToolOutputData(
  output: unknown
): Record<string, unknown> {
  const root = parseOutput(output) ?? {};
  const nested = asRecord(root.data);
  if (!nested) return root;
  // { ok, summary, data: { candidateAssetIds... } } 或 data 内再带 ids
  return {
    ...root,
    ...nested,
  };
}

/** 从工具 output 解析缩略图绑定信息 */
export function extractImageToolThumbRefs(
  output: unknown,
  summary?: string
): ImageToolThumbRefs {
  const data = resolveImageToolOutputData(output);
  const batchId =
    (typeof data.batchId === "string" && data.batchId.trim()) ||
    (typeof data.variantGroupId === "string" && data.variantGroupId.trim()) ||
    undefined;
  const assetIds = [
    ...stringList(data.pendingAssetIds),
    ...stringList(data.candidateAssetIds),
    ...stringList(data.assetIds),
  ];
  const uniqueIds = [...new Set(assetIds)];
  const countFromData =
    typeof data.count === "number" && Number.isFinite(data.count)
      ? Math.max(1, Math.min(8, Math.floor(data.count)))
      : undefined;
  const countFromSummary = parseGeneratedCount(summary);
  return {
    batchId,
    assetIds: uniqueIds,
    count: countFromData ?? Math.max(countFromSummary, uniqueIds.length || 1),
  };
}

export function parseGeneratedCount(summary?: string): number {
  if (!summary) return 1;
  const match = summary.match(/(\d+)\s*张/);
  if (match) return Math.min(8, parseInt(match[1], 10));
  return 1;
}

function isPlaceholderSrc(src: string | undefined): boolean {
  return Boolean(src?.startsWith("data:image/svg+xml"));
}

function isReadyThumb(asset: ImageAsset): boolean {
  return Boolean(
    asset.src?.trim() &&
      asset.status !== "discarded" &&
      asset.status !== "failed" &&
      asset.status !== "cancelled" &&
      asset.status !== "generating" &&
      !isPlaceholderSrc(asset.src)
  );
}

function isGeneratingThumb(asset: ImageAsset): boolean {
  return asset.status === "generating";
}

/**
 * 按本轮绑定选取缩略图。
 * - 有 assetIds → 按 id 精确取（顺序保持）
 * - 否则有 batchId → 取该批次
 * - 都没有 → 空数组（绝不回退到「全局最新」）
 */
export function pickImageThumbnails(
  project: ProjectFile | undefined,
  refs: ImageToolThumbRefs
): ImageAsset[] {
  if (!project?.assets?.length) return [];
  const byId = new Map(project.assets.map((asset) => [asset.id, asset]));

  if (refs.assetIds.length > 0) {
    return refs.assetIds
      .map((id) => byId.get(id))
      .filter((asset): asset is ImageAsset =>
        Boolean(asset && isReadyThumb(asset))
      );
  }

  if (refs.batchId) {
    const batch = project.assets.filter(
      (asset) => asset.batchId === refs.batchId && isReadyThumb(asset)
    );
    if (batch.length > 0) {
      return batch.slice(0, Math.min(8, Math.max(refs.count, batch.length)));
    }
  }

  return [];
}

/** 本轮仍在生成中的占位卡，供侧栏 loading 预览。 */
export function pickGeneratingImageThumbs(
  project: ProjectFile | undefined,
  refs: ImageToolThumbRefs
): ImageAsset[] {
  if (!project?.assets?.length) return [];
  const byId = new Map(project.assets.map((asset) => [asset.id, asset]));

  if (refs.assetIds.length > 0) {
    return refs.assetIds
      .map((id) => byId.get(id))
      .filter((asset): asset is ImageAsset =>
        Boolean(asset && isGeneratingThumb(asset))
      );
  }

  if (refs.batchId) {
    return project.assets
      .filter((asset) => asset.batchId === refs.batchId && isGeneratingThumb(asset))
      .slice(0, Math.min(8, Math.max(refs.count, 1)));
  }

  return [];
}

const IMAGE_GEN_JOB_TYPES = new Set([
  "image_generation",
  "direct_image_generation",
]);

const IMAGE_TOOL_NAMES = new Set([
  "generate_images",
  "generate_image_variants",
  "restyle_page_images",
]);

export type ImageJobThumbLink = {
  toolCallId?: string;
  jobType: string;
  batchId?: string;
};

/** 同一轮已有生图 job 负责预览时，工具卡不再重复画缩略图。 */
export function imageJobCoversToolPreview(
  tool: { id: string; name: string; output?: unknown; summary?: string },
  jobs: ImageJobThumbLink[]
): boolean {
  if (!IMAGE_TOOL_NAMES.has(tool.name)) return false;
  const refs = extractImageToolThumbRefs(tool.output, tool.summary);
  return jobs.some((job) => {
    if (!IMAGE_GEN_JOB_TYPES.has(job.jobType)) return false;
    if (job.toolCallId === tool.id) return true;
    return Boolean(refs.batchId && job.batchId && refs.batchId === job.batchId);
  });
}

/** 把工具 output 里的 assetIds 并到 job 预览绑定上。 */
export function mergeJobThumbRefs(
  job: { batchId?: string; total: number },
  linkedTool?: { output?: unknown; summary?: string }
): ImageToolThumbRefs {
  const fromTool = linkedTool
    ? extractImageToolThumbRefs(linkedTool.output, linkedTool.summary)
    : { assetIds: [] as string[], count: 1, batchId: undefined };
  return {
    batchId: job.batchId ?? fromTool.batchId,
    assetIds: fromTool.assetIds,
    count: Math.max(job.total || 1, fromTool.count, 1),
  };
}
