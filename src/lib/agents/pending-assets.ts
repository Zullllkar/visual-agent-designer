/**
 * 生图任务 → 画布占位资产
 * @author：wangjunhua
 */

import type { ImageAsset } from "@/lib/project/assets-schema";
import type { ImagePlan } from "./image-planner-agent";
import { GENERATING_PLACEHOLDER_SRC } from "@/lib/canvas/generating-placeholder";

export function pendingAssetId(pageId: string, nodeId: string, batchId?: string): string {
  if (batchId) return `pending:${batchId}:${pageId}:${nodeId}`;
  return `pending:${pageId}:${nodeId}`;
}

export function buildPendingAssets(plan: ImagePlan, batchId: string): ImageAsset[] {
  const now = new Date().toISOString();
  return plan.tasks.map((task) => ({
    id: pendingAssetId(task.pageId, task.nodeId, batchId),
    prompt: task.imagePrompt,
    src: GENERATING_PLACEHOLDER_SRC,
    width: task.width,
    height: task.height,
    model: "pending",
    createdAt: now,
    batchId,
    status: "generating" as const,
    usedInPages: task.pageId === "asset-board" ? [] : [task.pageId],
  }));
}

export function mergeAssetAfterGenerate(
  assets: ImageAsset[],
  pendingId: string,
  next: ImageAsset
): ImageAsset[] {
  const without = assets.filter((a) => a.id !== pendingId);
  return [...without, next];
}
