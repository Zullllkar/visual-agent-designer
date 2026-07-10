/**
 * Asset → CanvasPage Image Node 转换（C4）
 * --------------------------------------------------------------
 * 用户在 ImagePane 把候选图拖到 tldraw 画布上的某一页时调用。
 *
 * 行为：
 *   1. 在该 page.nodes 末尾追加一个 image node（保留 asset 比例，
 *      限制在 page 80% 范围内，落点 = 图片中心）
 *   2. asset.status → "used"，并把 pageId 加入 asset.usedInPages
 *   3. project.updatedAt 刷新（触发 CanvasPane 重建 tldraw store
 *      → 新 image node 出现在缩略图里）
 *
 * 不做的：
 *   - 不修改 page 上其他 node 的位置（即使重叠也不动）
 *   - 不删除 asset（用户可能想多次拖入不同页）
 */

import { nanoid } from "nanoid";
import type { ProjectFile } from "./schema";
import type { ImageAsset } from "./assets-schema";
import type { ImageNode } from "@/lib/canvas/schema";

export interface DropResult {
  project: ProjectFile;
  pageId: string;
  newNode: ImageNode;
}

export interface ApplyAssetToNodeResult {
  project: ProjectFile;
  pageId: string;
  nodeId: string;
}

export function applyAssetDropToProject(
  project: ProjectFile,
  assetId: string,
  pageId: string,
  /** 落点在 page 坐标系中的位置；以图片中心计算 */
  centerX: number,
  centerY: number
): DropResult | null {
  const asset = (project.assets ?? []).find((a) => a.id === assetId);
  if (!asset) return null;
  const page = project.pages.find((p) => p.id === pageId);
  if (!page) return null;

  const { width: w, height: h } = pickFitSize(asset, page.width, page.height);
  // 落点为图片中心，再 clamp 到 page 内
  const x = Math.round(clamp(centerX - w / 2, 0, page.width - w));
  const y = Math.round(clamp(centerY - h / 2, 0, page.height - h));

  const newNode: ImageNode = {
    id: nanoid(8),
    type: "image",
    x,
    y,
    width: Math.round(w),
    height: Math.round(h),
    src: asset.src,
    alt: asset.prompt,
    radius: 8,
    generation: {
      prompt: asset.prompt,
      model: asset.model,
      seed: asset.seed,
    },
    source: "image-workspace-drop",
  };

  const updatedPages = project.pages.map((p) =>
    p.id === pageId ? { ...p, nodes: [...p.nodes, newNode] } : p
  );
  const updatedAssets = (project.assets ?? []).map((a) =>
    a.id === assetId
      ? {
          ...a,
          status: "used" as const,
          usedInPages: Array.from(
            new Set([...(a.usedInPages ?? []), pageId])
          ),
          usedInNodes: mergeUsedNode(a.usedInNodes, pageId, newNode.id),
        }
      : a
  );

  return {
    project: {
      ...project,
      pages: updatedPages,
      assets: updatedAssets,
      updatedAt: new Date().toISOString(),
    },
    pageId,
    newNode,
  };
}

export function applyAssetToImageNode(
  project: ProjectFile,
  assetId: string,
  pageId: string,
  nodeId: string
): ApplyAssetToNodeResult | null {
  const asset = (project.assets ?? []).find((a) => a.id === assetId);
  if (!asset) return null;
  const page = project.pages.find((p) => p.id === pageId);
  if (!page) return null;
  const target = page.nodes.find((node) => node.id === nodeId);
  if (!target || target.type !== "image") return null;

  const updatedPages = project.pages.map((p) =>
    p.id === pageId
      ? {
          ...p,
          nodes: p.nodes.map((node) =>
            node.id === nodeId && node.type === "image"
              ? {
                  ...node,
                  src: asset.src,
                  alt: asset.prompt,
                  generation: {
                    prompt: asset.prompt,
                    model: asset.model,
                    seed: asset.seed,
                  },
                  source: "image-workspace-apply",
                }
              : node
          ),
        }
      : p
  );

  const updatedAssets = (project.assets ?? []).map((a) =>
    a.id === assetId
      ? {
          ...a,
          status: "used" as const,
          usedInPages: Array.from(new Set([...(a.usedInPages ?? []), pageId])),
          usedInNodes: mergeUsedNode(a.usedInNodes, pageId, nodeId),
        }
      : a
  );

  return {
    project: {
      ...project,
      pages: updatedPages,
      assets: updatedAssets,
      updatedAt: new Date().toISOString(),
    },
    pageId,
    nodeId,
  };
}

/**
 * 选择 image node 在 page 中的合理尺寸：
 *   - 保持 asset 原始 aspect ratio
 *   - 宽不超过 page 宽 × 0.8
 *   - 高不超过 page 高 × 0.6
 *   - 不放大（asset 本身较小则保留原尺寸）
 */
function pickFitSize(
  asset: ImageAsset,
  pageW: number,
  pageH: number
): { width: number; height: number } {
  const aspect = asset.width / Math.max(1, asset.height);
  const maxW = pageW * 0.8;
  const maxH = pageH * 0.6;
  let w = Math.min(maxW, asset.width);
  let h = w / aspect;
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }
  return { width: Math.max(40, w), height: Math.max(40, h) };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function mergeUsedNode(
  usedInNodes: ImageAsset["usedInNodes"] | undefined,
  pageId: string,
  nodeId: string
): NonNullable<ImageAsset["usedInNodes"]> {
  const next = usedInNodes ?? [];
  if (next.some((item) => item.pageId === pageId && item.nodeId === nodeId)) {
    return next;
  }
  return [...next, { pageId, nodeId }];
}
