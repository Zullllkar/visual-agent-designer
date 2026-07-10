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

export interface ImageExecutorResult {
  pages: CanvasPage[];
  assets: ImageAsset[];
  succeeded: number;
  failed: number;
}

type OnAssetReady = (payload: {
  pages: CanvasPage[];
  assets: ImageAsset[];
  asset?: ImageAsset;
}) => void;

export const ImageExecutorAgent: Agent<
  {
    brief: ProductBrief;
    pages: CanvasPage[];
    plan: ImagePlan;
    providerConfig?: ProviderConfig;
  },
  ImageExecutorResult
> = {
  name: "image-executor-agent",
  async run({ brief, pages, plan, providerConfig }, ctx) {
    if (plan.tasks.length === 0) {
      const initial = (ctx.scratch.initialAssets as ImageAsset[] | undefined) ?? [];
      return { pages, assets: initial, succeeded: 0, failed: 0 };
    }

    assertRealImageForGeneration(providerConfig);

    const logger = ctx.scratch.pipelineLogger as PipelineLogger | undefined;
    const onAssetReady = ctx.scratch.onAssetReady as OnAssetReady | undefined;

    const batchId = nanoid(8);
    const now = new Date().toISOString();
    let liveAssets: ImageAsset[] =
      (ctx.scratch.initialAssets as ImageAsset[] | undefined) ?? [];
    let succeeded = 0;
    let failed = 0;

    const nextPages = pages.map((p) => ({
      ...p,
      nodes: p.nodes.map((n) => ({ ...n })),
    }));

    const visualPrefix = [
      brief.visualStyle,
      ctx.scratch.designDirectionSummary as string | undefined,
    ]
      .filter(Boolean)
      .join(", ");

    logger?.info("image_execute", `开始生图 ${plan.tasks.length} 张`, {
      batchId,
    });

    for (const task of plan.tasks) {
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

      const fullPrompt = visualPrefix
        ? `${visualPrefix}, ${task.imagePrompt}`
        : task.imagePrompt;

      try {
        const t0 = Date.now();
        logger?.info(
          "image_task",
          isStandalone
            ? `生图中：独立素材 ${task.nodeId}`
            : `生图中：${task.pageId} / ${task.nodeId}`,
          {
            prompt: fullPrompt.slice(0, 120),
          }
        );
        const gen = await ctx.providers.image.generateImage({
          prompt: fullPrompt,
          width: task.width,
          height: task.height,
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
          source: "generated",
          tags: task.role ? [task.role] : undefined,
        };

        liveAssets = mergeAssetAfterGenerate(
          liveAssets,
          pendingAssetId(task.pageId, task.nodeId),
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

        onAssetReady?.({
          pages: nextPages,
          assets: liveAssets,
          asset,
        });
      } catch (e) {
        failed++;
        liveAssets = liveAssets.filter(
          (a) => a.id !== pendingAssetId(task.pageId, task.nodeId)
        );
        onAssetReady?.({ pages: nextPages, assets: liveAssets });
        logger?.error("image_task", `失败 ${task.pageId}/${task.nodeId}`, {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    logger?.info("image_execute", `生图结束：成功 ${succeeded} / 失败 ${failed}`);

    return {
      pages: nextPages,
      assets: liveAssets,
      succeeded,
      failed,
    };
  },
};
