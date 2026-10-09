/**
 * 生图任务 → 画布占位资产
 * @author：wangjunhua
 */

import type { ImageAsset } from "@/lib/project/assets-schema";
import type { ImagePlan } from "./image-planner-agent";
import { GENERATING_PLACEHOLDER_SRC } from "@/lib/canvas/generating-placeholder";
import { assignAssetTitles } from "@/lib/project/asset-title";

export function pendingAssetId(pageId: string, nodeId: string, batchId?: string): string {
  if (batchId) return `pending:${batchId}:${pageId}:${nodeId}`;
  return `pending:${pageId}:${nodeId}`;
}

export function buildPendingAssets(plan: ImagePlan, batchId: string): ImageAsset[] {
  const now = new Date().toISOString();
  const titles = assignAssetTitles(
    plan.tasks.map((task) => ({
      title: task.title,
      prompt: task.imagePrompt,
      role: task.role,
      copyPlan: task.copyPlan,
    })),
  );
  return plan.tasks.map((task, index) => ({
    id: pendingAssetId(task.pageId, task.nodeId, batchId),
    title: titles[index],
    prompt: task.imagePrompt,
    copyPlan: task.copyPlan,
    src: GENERATING_PLACEHOLDER_SRC,
    width: task.width,
    height: task.height,
    model: "pending",
    createdAt: now,
    batchId,
    status: "generating" as const,
    usedInPages: task.pageId === "asset-board" ? [] : [task.pageId],
    role: task.role,
  }));
}

export function mergeAssetAfterGenerate(
  assets: ImageAsset[],
  pendingId: string,
  next: ImageAsset
): ImageAsset[] {
  const prev = assets.find((asset) => asset.id === pendingId);
  const titled: ImageAsset = {
    ...next,
    title: next.title?.trim() || prev?.title,
  };
  const without = assets.filter((a) => a.id !== pendingId);
  return [...without, titled];
}
