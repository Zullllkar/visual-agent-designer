/**
 * Image Executor Agent
 * --------------------------------------------------------------
 * 纯执行层：按 Image Planner 计划调用生图模型，
 * 更新 Canvas image 节点 src，并写入 project.assets。
 *
 * @author：wangjunhua
 */

import { nanoid } from "nanoid";
import type { Agent } from "./types";
import type { ProductBrief } from "@/lib/project/schema";
import type { ImageAsset } from "@/lib/project/assets-schema";
import type { CanvasPage } from "@/lib/canvas/schema";
import type { ImagePlan } from "./image-planner-agent";
import { assertRealImageForGeneration } from "@/lib/providers/validate";
import type { ProviderConfig } from "@/lib/providers/registry";
import type { PipelineLogger } from "./pipeline-logger";
import {
  mergeAssetAfterGenerate,
  pendingAssetId,
} from "./pending-assets";
import { groundPromptToCitedReferences } from "./reference-images";
import { resolveReferenceImagesForModel } from "./resolve-reference-images";

export interface ImageExecutorResult {
  pages: CanvasPage[];
  assets: ImageAsset[];
  succeeded: number;
  failed: number;
  cancelled: number;
}

type OnAssetReady = (payload: {
  pages: CanvasPage[];
  assets: ImageAsset[];
  asset?: ImageAsset;
}) => void | Promise<void>;

type OnImageTaskProgress = (payload: {
  completed: number;
  failed: number;
  cancelled: number;
  total: number;
  currentTaskId?: string;
  message?: string;
}) => void | Promise<void>;

export const ImageExecutorAgent: Agent<
  {
    brief: ProductBrief;
    pages: CanvasPage[];
    plan: ImagePlan;
    providerConfig?: ProviderConfig;
    signal?: AbortSignal;
    concurrency?: number;
  },
  ImageExecutorResult
> = {
  name: "image-executor-agent",
  async run({ brief, pages, plan, providerConfig, signal, concurrency }, ctx) {
    if (plan.tasks.length === 0) {
      const initial = (ctx.scratch.initialAssets as ImageAsset[] | undefined) ?? [];
      return { pages, assets: initial, succeeded: 0, failed: 0, cancelled: 0 };
    }

    assertRealImageForGeneration(providerConfig);

    const logger = ctx.scratch.pipelineLogger as PipelineLogger | undefined;
    const onAssetReady = ctx.scratch.onAssetReady as OnAssetReady | undefined;
    const onTaskProgress = ctx.scratch.onImageTaskProgress as
      | OnImageTaskProgress
      | undefined;

    const batchId = (ctx.scratch.imageBatchId as string | undefined) ?? nanoid(8);
    const now = new Date().toISOString();
    let liveAssets: ImageAsset[] =
      (ctx.scratch.initialAssets as ImageAsset[] | undefined) ?? [];
    let succeeded = 0;
    let failed = 0;
    let cancelled = 0;

    const nextPages = pages.map((p) => ({
      ...p,
      nodes: p.nodes.map((n) => ({ ...n })),
    }));

    const cited = typeof ctx.scratch.citedAssetId === "string";
    const visualPrefix = cited
      ? ""
      : [
          brief.visualStyle,
          ctx.scratch.designDirectionSummary as string | undefined,
        ]
          .filter(Boolean)
          .join(", ");
    const referenceImages = await resolveReferenceImagesForModel(
      ((ctx.scratch.referenceImages as string[] | undefined) ?? []).filter(Boolean),
      ctx.projectId
    );
    const referenceLabels = (
      (ctx.scratch.referenceLabels as string[] | undefined) ?? []
    ).filter(Boolean);

    logger?.info("image_execute", `开始生图 ${plan.tasks.length} 张`, {
      batchId,
      referenceCount: referenceImages.length,
    });

    let nextTaskIndex = 0;
    const workerCount = Math.max(1, Math.min(concurrency ?? 2, plan.tasks.length));

    const runNext = async () => {
      while (true) {
        if (signal?.aborted) return;
        const taskIndex = nextTaskIndex++;
        if (taskIndex >= plan.tasks.length) return;
        const task = plan.tasks[taskIndex];
      const page = nextPages.find((p) => p.id === task.pageId);
      const nodeIdx =
        page != null
          ? page.nodes.findIndex((n) => n.id === task.nodeId)
          : -1;
      const isStandalone =
        !page || nodeIdx < 0 || page.nodes[nodeIdx]?.type !== "image";

      // 独立素材任务（不挂网页结构节点）仍可生图
      if (!isStandalone && page && nodeIdx < 0) {
        failed++;
        continue;
      }

      const basePrompt = visualPrefix
        ? `${visualPrefix}, ${task.imagePrompt}`
        : task.imagePrompt;
      const fullPrompt = groundPromptToCitedReferences(basePrompt, {
        cited,
        labels: referenceLabels,
      });

      try {
        await onTaskProgress?.({
          completed: succeeded,
          failed,
          cancelled,
          total: plan.tasks.length,
          currentTaskId: task.nodeId,
          message: `正在生成第 ${taskIndex + 1}/${plan.tasks.length} 张`,
        });
        const t0 = Date.now();
        logger?.info(
          "image_task",
          isStandalone
            ? `生图中：独立素材 ${task.nodeId}`
            : `生图中：${task.pageId} / ${task.nodeId}`,
          {
            prompt: fullPrompt.slice(0, 120),
            referenceCount: referenceImages.length,
          }
        );
        const gen = await ctx.providers.image.generateImage({
          prompt: fullPrompt,
          width: task.width,
          height: task.height,
          referenceImages:
            referenceImages.length > 0 ? referenceImages : undefined,
          signal,
        });
        const durationMs = Date.now() - t0;

        const assetId = nanoid(10);
        const asset: ImageAsset = {
          id: assetId,
          prompt: fullPrompt,
          src: gen.imageUrl,
          width: task.width,
          height: task.height,
          model: gen.model,
          seed: gen.seed,
          durationMs,
          costUsd: gen.cost,
          createdAt: now,
          batchId,
          status: isStandalone ? "candidate" : "used",
          usedInPages: isStandalone ? [] : [task.pageId],
          source: referenceImages.length > 0 ? "edited" : "generated",
          tags: task.role ? [task.role] : undefined,
        };

        liveAssets = mergeAssetAfterGenerate(
          liveAssets,
          pendingAssetId(task.pageId, task.nodeId, batchId),
          asset
        );

        if (!isStandalone && page && nodeIdx >= 0) {
          const node = page.nodes[nodeIdx];
          if (node.type === "image") {
            page.nodes[nodeIdx] = {
              ...node,
              src: gen.imageUrl,
              alt: task.imagePrompt,
              generation: {
                prompt: fullPrompt,
                model: gen.model,
                seed: gen.seed,
              },
              source: "image-executor-agent",
            };
          }
        }
        succeeded++;
        logger?.success(
          "image_task",
          isStandalone ? `完成独立素材 ${task.nodeId}` : `完成 ${task.pageId}`,
          {
            model: gen.model,
            durationMs,
          }
        );

        await onAssetReady?.({
          pages: nextPages,
          assets: liveAssets,
          asset,
        });
        await onTaskProgress?.({
          completed: succeeded,
          failed,
          cancelled,
          total: plan.tasks.length,
          currentTaskId: task.nodeId,
          message: `已完成 ${succeeded}/${plan.tasks.length} 张`,
        });
      } catch (e) {
        if (signal?.aborted || (e instanceof Error && e.name === "AbortError")) {
          return;
        }
        failed++;
        liveAssets = markPendingAsset(
          liveAssets,
          pendingAssetId(task.pageId, task.nodeId, batchId),
          "failed",
          e instanceof Error ? e.message : String(e)
        );
        await onAssetReady?.({ pages: nextPages, assets: liveAssets });
        await onTaskProgress?.({
          completed: succeeded,
          failed,
          cancelled,
          total: plan.tasks.length,
          currentTaskId: task.nodeId,
          message: `第 ${taskIndex + 1} 张生成失败`,
        });
        logger?.error("image_task", `失败 ${task.pageId}/${task.nodeId}`, {
          error: e instanceof Error ? e.message : String(e),
        });
      }
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => runNext()));

    if (signal?.aborted) {
      const pendingIds = new Set(
        plan.tasks.map((task) => pendingAssetId(task.pageId, task.nodeId, batchId))
      );
      liveAssets = liveAssets.map((asset) => {
        if (!pendingIds.has(asset.id) || asset.status !== "generating") return asset;
        cancelled++;
        return { ...asset, status: "cancelled" as const, error: "已取消" };
      });
      await onAssetReady?.({ pages: nextPages, assets: liveAssets });
      await onTaskProgress?.({
        completed: succeeded,
        failed,
        cancelled,
        total: plan.tasks.length,
        message: `已取消，保留 ${succeeded} 张已完成图片`,
      });
    }

    logger?.info("image_execute", `生图结束：成功 ${succeeded} / 失败 ${failed}`);

    return {
      pages: nextPages,
      assets: liveAssets,
      succeeded,
      failed,
      cancelled,
    };
  },
};

function markPendingAsset(
  assets: ImageAsset[],
  pendingId: string,
  status: "failed" | "cancelled",
  error: string
): ImageAsset[] {
  return assets.map((asset) =>
    asset.id === pendingId ? { ...asset, status, error } : asset
  );
}
