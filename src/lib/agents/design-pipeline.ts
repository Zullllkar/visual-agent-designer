/**
 * 设计流水线（共享）
 * --------------------------------------------------------------
 * Lovart 式：Brief → 视觉方向 → 独立生图素材（不生成网页结构框）
 *
 * @author：wangjunhua
 */

import { nanoid } from "nanoid";
import { BriefAgent } from "./brief-agent";
import { DesignDirectorAgent } from "./design-director-agent";
import { ImagePlannerAgent } from "./image-planner-agent";
import { ImageExecutorAgent } from "./image-executor-agent";
import type { AgentContext } from "./types";
import type { ProjectFile, ProductBrief } from "@/lib/project/schema";
import { ProjectFileSchema } from "@/lib/project/schema";
import type { ProviderConfig } from "@/lib/providers/registry";
import { resolveDesignSystem } from "@/lib/skills/registry";
import { injectProviderScratch } from "./content-preferences";
import type { PipelineLogger } from "./pipeline-logger";
import type { CodeDiffEventData } from "./chat-schema";
import { assetCodeDiff } from "@/lib/chat/page-code-diff";
import { buildPendingAssets } from "./pending-assets";
import type { ImageAsset } from "@/lib/project/assets-schema";
import {
  buildDesignContext,
  deriveDesignContext,
  readDesignContextFromScratch,
} from "@/lib/project/design-context";

export interface PipelineProgress {
  stage: string;
  detail?: string;
}

export interface RunPipelineOptions {
  idea: string;
  ctx: AgentContext;
  providerConfig?: ProviderConfig;
  existing?: ProjectFile | null;
  onProgress?: (p: PipelineProgress) => void;
  logger?: PipelineLogger;
  skipImages?: boolean;
  onCodeDiff?: (diff: CodeDiffEventData) => void;
  onProjectSnapshot?: (project: ProjectFile) => void;
}

function emitProgress(
  onProgress: RunPipelineOptions["onProgress"],
  stage: string,
  detail?: string
) {
  onProgress?.({ stage, detail });
}

/**
 * 跑视觉素材流水线，返回校验后的 ProjectFile。
 */
export async function runDesignPipeline(
  opts: RunPipelineOptions
): Promise<ProjectFile> {
  const {
    idea,
    ctx,
    providerConfig,
    existing,
    onProgress,
    logger,
    skipImages,
    onCodeDiff,
    onProjectSnapshot,
  } = opts;
  const projectId = existing?.id ?? ctx.projectId ?? nanoid(10);
  ctx.projectId = projectId;
  if (logger) ctx.scratch.pipelineLogger = logger;
  injectProviderScratch(ctx.scratch, providerConfig);
  const existingDesignContext = existing ? deriveDesignContext(existing) : null;
  if (existingDesignContext) ctx.scratch.designContext = existingDesignContext;

  const brief =
    existing?.brief ??
    (await (logger
      ? logger.runStage(
          "brief",
          idea.slice(0, 80),
          () => BriefAgent.run({ idea }, ctx),
          (b) => ({ productName: b.productName })
        )
      : BriefAgent.run({ idea }, ctx)));

  emitProgress(onProgress, "brief", brief.productName);

  // 轻量架构占位（兼容 schema），不再跑 Architect / Layout
  const architecture = existing?.architecture ?? {
    pages: [
      {
        id: "asset-board",
        name: "视觉素材",
        purpose: "画布生图交付",
        priority: "primary" as const,
      },
    ],
    userFlows: ["描述想法 → 生成视觉素材 → 导出交付"],
    summary: "素材交付工作台（无网页结构页）",
  };
  ctx.scratch.architecture = architecture;

  const designDirection =
    existing?.designDirection ??
    (await (logger
      ? logger.runStage(
          "design_direction",
          undefined,
          () => DesignDirectorAgent.run({ brief, architecture }, ctx),
          (d) => ({ summary: d.summary.slice(0, 80) })
        )
      : DesignDirectorAgent.run({ brief, architecture }, ctx)));
  ctx.scratch.designDirectionSummary = designDirection.summary;
  ctx.scratch.designContext =
    existingDesignContext ??
    buildDesignContext({
      brief,
      designDirection,
      designSystemId: ctx.designSystem?.manifest.name,
    });
  emitProgress(onProgress, "design_direction");

  if (
    designDirection.recommendedDesignSystemId &&
    designDirection.recommendedDesignSystemId !== ctx.designSystem?.manifest.name
  ) {
    logger?.info(
      "design_system",
      `切换设计系统：${designDirection.recommendedDesignSystemId}`
    );
    const ds = await resolveDesignSystem(
      designDirection.recommendedDesignSystemId
    );
    if (ds) ctx.designSystem = ds;
  }

  const pages = existing?.pages ?? [];

  const pushSnapshot = (assets: ProjectFile["assets"]) => {
    try {
      const snap = finalizeProject({
        projectId,
        idea,
        existing,
        brief,
        architecture,
        designDirection,
        pages,
        assets: assets ?? [],
        ctx,
      });
      onProjectSnapshot?.(snap);
      return snap;
    } catch (e) {
      console.error("[design-pipeline] project_snapshot 校验失败:", e);
      return null;
    }
  };

  pushSnapshot(existing?.assets);

  if (!skipImages) {
    const plan = await (logger
      ? logger.runStage(
          "image_plan",
          undefined,
          () =>
            ImagePlannerAgent.run(
              {
                brief,
                pages,
                designDirection,
                standaloneCount: 4,
              },
              ctx
            ),
          (pl) => ({ tasks: pl.tasks.length })
        )
      : ImagePlannerAgent.run(
          { brief, pages, designDirection, standaloneCount: 4 },
          ctx
        ));

    emitProgress(onProgress, "image_plan", `${plan.tasks.length} 个任务`);

    if (plan.tasks.length > 0) {
      const batchId = nanoid(8);
      const pendingAssets = buildPendingAssets(plan, batchId);
      let liveAssets = [...(existing?.assets ?? []), ...pendingAssets];
      pushSnapshot(liveAssets);

      emitProgress(onProgress, "image_execute", `${plan.tasks.length} 个位图任务`);

      ctx.scratch.onAssetReady = (payload: {
        pages: typeof pages;
        assets: ImageAsset[];
        asset?: ImageAsset;
      }) => {
        liveAssets = payload.assets;
        pushSnapshot(liveAssets);
        if (payload.asset?.src) {
          onCodeDiff?.(assetCodeDiff(payload.asset));
        }
      };
      ctx.scratch.initialAssets = liveAssets;

      const executed = await (logger
        ? logger.runStage(
            "image_execute",
            `${plan.tasks.length} 张`,
            () =>
              ImageExecutorAgent.run(
                { brief, pages, plan, providerConfig },
                ctx
              ),
            (r) => ({ succeeded: r.succeeded, failed: r.failed })
          )
        : ImageExecutorAgent.run({ brief, pages, plan, providerConfig }, ctx));

      delete ctx.scratch.onAssetReady;
      delete ctx.scratch.initialAssets;

      liveAssets = executed.assets;
      ctx.scratch.newAssets = executed.assets.filter(
        (a) => a.status !== "generating"
      );

      return finalizeProject({
        projectId,
        idea,
        existing,
        brief,
        architecture,
        designDirection,
        pages: executed.pages,
        assets: liveAssets,
        ctx,
      });
    }
  }

  return finalizeProject({
    projectId,
    idea,
    existing,
    brief,
    architecture,
    designDirection,
    pages,
    assets: existing?.assets,
    ctx,
  });
}

function finalizeProject(params: {
  projectId: string;
  idea: string;
  existing?: ProjectFile | null;
  brief: ProductBrief;
  architecture: NonNullable<ProjectFile["architecture"]>;
  designDirection: NonNullable<ProjectFile["designDirection"]>;
  pages: ProjectFile["pages"];
  assets?: ProjectFile["assets"];
  ctx: AgentContext;
}): ProjectFile {
  const now = new Date().toISOString();
  const { brief, architecture } = params;
  const designContext =
    params.existing?.designContext ??
    readDesignContextFromScratch(params.ctx.scratch) ??
    buildDesignContext({
      brief,
      designDirection: params.designDirection,
      designSystemId: params.ctx.designSystem?.manifest.name,
      now,
    });
  return ProjectFileSchema.parse({
    id: params.projectId,
    slug: params.existing?.slug ?? slugify(brief.productName) ?? params.projectId,
    title: brief.productName,
    rawIdea: params.existing?.rawIdea ?? params.idea,
    createdAt: params.existing?.createdAt ?? now,
    updatedAt: now,
    brief,
    architecture: params.architecture,
    designDirection: params.designDirection,
    designContext,
    prototype: {
      flows: architecture.userFlows,
      pages: architecture.pages.map((p) => p.name),
    },
    pages: params.pages,
    assets: params.assets ?? [],
    skillId: params.ctx.skill?.manifest.name,
    designSystemId: params.ctx.designSystem?.manifest.name,
  });
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
