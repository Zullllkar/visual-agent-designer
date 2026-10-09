/**
 * Job 处理器注册
 * --------------------------------------------------------------
 * 将各类型的 Job handler 注册到 JobScheduler。
 * 在服务启动时调用 registerAllJobHandlers()。
 */

import "server-only";

import { jobScheduler } from "./job-scheduler";
import type { Job, JobHandler } from "./job-types";
import { ImagePlannerAgent } from "@/lib/agents/image-planner-agent";
import { ImageExecutorAgent } from "@/lib/agents/image-executor-agent";
import type { AgentContext } from "@/lib/agents/types";
import type { ProviderConfig } from "@/lib/providers/registry";
import type { ProjectFile } from "@/lib/project/schema";
import { resolveRunDesignContext } from "@/lib/agents/tools/utils";
import { processBase64Assets } from "@/lib/vad/persist";
import { loadMergedProjectFromVad, saveProjectToVad } from "@/lib/vad/storage";
import { parseProjectFileLight } from "@/lib/project/parse-project";
import { ensureProjectBrief } from "@/lib/project/ensure-brief";
import { nanoid } from "nanoid";
import { buildPendingAssets } from "@/lib/agents/pending-assets";
import type { ImageAsset } from "@/lib/project/assets-schema";
import { mergeAssetsPreferDiscarded } from "@/lib/project/asset-visibility";
import { resolveProviders } from "@/lib/providers/registry";
import {
  runDirectImageGenerationBatch,
  buildDirectPendingAssets,
  type DirectImageGenerationRequest,
} from "@/lib/agents/direct-image-generation";
import { resolveReferenceImagesForModel } from "@/lib/agents/resolve-reference-images";
import { collectProjectReferenceImages } from "@/lib/agents/reference-images";
import { generateMaterialsForLayout } from "@/lib/handoff/generate-materials";
import { alignPendingGeneratingAssets, mergePendingGeneratingAssets } from "@/lib/canvas/stage-generating-assets";
import { buildDeterministicProjectReview } from "@/lib/agents/tools/review-project";

let registered = false;

/** 图片生成 Job 处理器 */
const imageGenerationHandler: JobHandler<{
  assets: Array<{ id: string; src: string; prompt: string }>;
  succeeded: number;
  failed: number;
}> = async (job: Job, { signal, reportProgress }) => {
  const payload = job.payload as {
    project: ProjectFile;
    agentCtx: AgentContext;
    providerConfig: ProviderConfig;
    count: number;
    prompt?: string;
    prompts?: string[];
    width?: number;
    height?: number;
    role?: "hero" | "illustration" | "product-shot" | "background" | "avatar";
    batchId?: string;
    referenceIds?: string[];
    referenceImages?: string[];
    referenceLabels?: string[];
  };

  const { project: submittedProject, agentCtx, providerConfig, count } = payload;
  const loaded =
    (await loadMergedProjectFromVad(submittedProject.id).catch(() => submittedProject)) ??
    submittedProject;
  const project = ensureProjectBrief(loaded, {
    prompt: payload.prompt,
    userMessage: Array.isArray(payload.prompts) ? payload.prompts[0] : undefined,
  });
  const brief = project.brief;
  if (!brief) throw new Error("project_brief_missing");
  const prompts = (payload.prompts ?? [])
    .map((p) => p.trim())
    .filter(Boolean);
  const planTotal = prompts.length > 1 ? prompts.length : count;

  const batchId = payload.batchId ?? nanoid(8);
  const provisionalPending = buildDirectPendingAssets(
    {
      prompt:
        payload.prompt ??
        prompts[0] ??
        brief.productName ??
        "image",
      prompts: prompts.length > 0 ? prompts : undefined,
      count: planTotal,
      width: payload.width ?? 1280,
      height: payload.height ?? 720,
      role: payload.role,
      referenceImages: payload.referenceImages,
    },
    batchId
  );
  let liveAssets = ensureAssets(project.assets ?? [], provisionalPending);
  let latestProject = await persistAssetsRespectingDiscarded(
    project,
    liveAssets,
    (base, assets) => buildUpdatedProject(base, assets, agentCtx)
  );
  liveAssets = latestProject.assets ?? liveAssets;

  reportProgress({
    stage: "planning",
    completed: 0,
    failed: 0,
    total: planTotal,
    message:
      prompts.length > 1
        ? `正在按 ${prompts.length} 种不同类型规划生图`
        : "正在规划图片内容",
  });
  const plan = await ImagePlannerAgent.run(
    {
      brief,
      pages: [],
      designDirection: project.designDirection,
      standaloneCount: count,
      standalonePrompt: payload.prompt,
      standalonePrompts: prompts.length > 0 ? prompts : undefined,
      standaloneWidth: payload.width,
      standaloneHeight: payload.height,
      standaloneRole: payload.role,
    },
    agentCtx
  );

  if (plan.tasks.length === 0) {
    return { assets: [], succeeded: 0, failed: 0 };
  }

  if (signal.aborted) throw abortError();

  const pendingAssets = buildPendingAssets(plan, batchId).map((pending, index) => {
    const provisional = provisionalPending[index];
    if (!provisional) return pending;
    return {
      ...pending,
      id: provisional.id,
      createdAt: provisional.createdAt,
    };
  });
  {
    const byId = new Map((latestProject.assets ?? liveAssets).map((a) => [a.id, a]));
    for (const pending of pendingAssets) {
      byId.set(pending.id, pending);
    }
    // 规划后任务变少时，去掉多余 provisional 占位
    const keepIds = new Set(pendingAssets.map((p) => p.id));
    for (const provisional of provisionalPending) {
      if (!keepIds.has(provisional.id)) byId.delete(provisional.id);
    }
    liveAssets = [...byId.values()];
  }
  latestProject = await persistAssetsRespectingDiscarded(
    project,
    liveAssets,
    (base, assets) => buildUpdatedProject(base, assets, agentCtx)
  );
  liveAssets = latestProject.assets ?? liveAssets;

  let persistQueue: Promise<void> = Promise.resolve();
  const persistAssets = (assets: ImageAsset[]) => {
    liveAssets = assets;
    const pending = persistQueue.then(async () => {
      latestProject = await persistAssetsRespectingDiscarded(
        project,
        liveAssets,
        (base, nextAssets) => buildUpdatedProject(base, nextAssets, agentCtx)
      );
      liveAssets = latestProject.assets ?? liveAssets;
    });
    persistQueue = pending.then(
      () => undefined,
      (error) => {
        console.warn("[vad] persist assets failed", error);
      }
    );
    return pending;
  };

  agentCtx.scratch.imageBatchId = batchId;
  agentCtx.scratch.initialAssets = liveAssets;
  agentCtx.scratch.onAssetReady = (payload: { assets: ImageAsset[] }) =>
    persistAssets(payload.assets);
  agentCtx.scratch.onImageTaskProgress = (progress: {
    completed: number;
    failed: number;
    total: number;
    currentTaskId?: string;
    message?: string;
  }) => {
    reportProgress({ stage: "generating", ...progress });
  };

  const collectedRefs = collectProjectReferenceImages(project, {
    preferIds: payload.referenceIds,
    max: 3,
  });
  const referenceImages =
    payload.referenceImages?.filter((src) => typeof src === "string" && src) ??
    collectedRefs.srcs;
  const referenceLabels =
    payload.referenceLabels?.filter((label) => typeof label === "string") ??
    collectedRefs.labels;
  if (referenceImages.length > 0) {
    agentCtx.scratch.referenceImages = referenceImages;
    agentCtx.scratch.referenceLabels = referenceLabels;
  }

  let executed;
  try {
    executed = await ImageExecutorAgent.run(
      {
        brief,
        pages: [],
        plan,
        providerConfig,
        signal,
        concurrency: 2,
      },
      agentCtx
    );
    await persistQueue;
  } finally {
    delete agentCtx.scratch.imageBatchId;
    delete agentCtx.scratch.initialAssets;
    delete agentCtx.scratch.onAssetReady;
    delete agentCtx.scratch.onImageTaskProgress;
  }

  if (signal.aborted) throw abortError();

  reportProgress({
    stage: "persisting",
    completed: executed.succeeded,
    failed: executed.failed,
    total: plan.tasks.length,
    message: "正在保存生成结果",
  });
  let updated = latestProject;
  try {
    updated = await persistAssetsRespectingDiscarded(
      project,
      executed.assets,
      (base, assets) => buildUpdatedProject(base, assets, agentCtx)
    );
  } catch (error) {
    console.warn("[vad] final persist assets failed", error);
    updated = {
      ...latestProject,
      assets: executed.assets,
      updatedAt: new Date().toISOString(),
    };
  }

  // Every completed generation gets a deterministic review snapshot. This is
  // cheap, local, and gives the next Agent turn actionable refinement context.
  const critique = buildDeterministicProjectReview(updated);
  updated = parseProjectFileLight({
    ...markPlannedAssetsGenerated(updated, executed.succeeded),
    critique,
    critiqueHistory: [
      ...(updated.critiqueHistory ?? []),
      {
        round: latestProject.critiqueHistory?.length ?? 0,
        overallScore: critique.overallScore,
        perPage: critique.reports.map((report) => ({ pageId: report.pageId, score: report.score })),
        accepted: true,
        generatedAt: critique.generatedAt,
      },
    ],
    updatedAt: critique.generatedAt,
  });
  await saveProjectToVad(updated);

  return {
    batchId,
    assets: (updated.assets ?? executed.assets).map((a) => ({
      id: a.id,
      src: a.src,
      prompt: a.prompt,
    })),
    succeeded: executed.succeeded,
    failed: executed.failed,
    updatedProject: updated,
  };
};

const directImageGenerationHandler: JobHandler<{
  assets: Array<{ id: string; src: string; prompt: string; status?: string }>;
  succeeded: number;
  failed: number;
  cancelled: number;
  updatedProject: ProjectFile;
}> = async (job: Job, { signal, reportProgress }) => {
  const payload = job.payload as {
    project: ProjectFile;
    providerConfig: ProviderConfig;
    request: DirectImageGenerationRequest;
    pendingAssets: ImageAsset[];
  };

  const { project: submittedProject, providerConfig, request, pendingAssets } = payload;
  const loadedProject = await loadMergedProjectFromVad(submittedProject.id).catch(
    () => submittedProject
  );
  const project = loadedProject ?? submittedProject;
  const { image } = resolveProviders(providerConfig);
  const alignedPending = alignPendingGeneratingAssets(
    project.assets ?? [],
    pendingAssets
  );

  let liveAssets = ensureAssets(project.assets ?? [], alignedPending);
  let latestProject = await persistAssetsRespectingDiscarded(
    project,
    liveAssets,
    buildProjectWithAssets
  );
  liveAssets = latestProject.assets ?? liveAssets;

  let persistQueue: Promise<void> = Promise.resolve();
  const persistAssets = (assets: ImageAsset[]) => {
    liveAssets = assets;
    const pending = persistQueue.then(async () => {
      latestProject = await persistAssetsRespectingDiscarded(
        project,
        liveAssets,
        buildProjectWithAssets
      );
      liveAssets = latestProject.assets ?? liveAssets;
    });
    persistQueue = pending.then(
      () => undefined,
      (error) => {
        console.warn("[vad] persist assets failed", error);
      }
    );
    return pending;
  };

  reportProgress({
    stage: "generating",
    completed: 0,
    failed: 0,
    cancelled: 0,
    total: alignedPending.length,
    message: "正在生成封面…",
  });

  const resolvedRefs = await resolveReferenceImagesForModel(
    request.referenceImages,
    project.id
  );
  const result = await runDirectImageGenerationBatch({
    image,
    input: {
      ...request,
      referenceImages: resolvedRefs,
    },
    initialAssets: liveAssets,
    pendingAssets: alignedPending,
    signal,
    concurrency: 2,
    onAssetsReady: persistAssets,
    ledgerProjectId: project.id,
    onProgress: (progress) =>
      reportProgress({
        stage: "generating",
        completed: progress.completed,
        failed: progress.failed,
        cancelled: progress.cancelled,
        total: progress.total,
        currentTaskId: progress.currentTaskId,
        message: progress.message,
      }),
  });
  await persistQueue;

  if (signal.aborted) throw abortError();

  try {
    latestProject = await persistAssetsRespectingDiscarded(
      project,
      result.assets,
      buildProjectWithAssets
    );
  } catch (error) {
    console.warn("[vad] final persist assets failed", error);
    latestProject = {
      ...latestProject,
      assets: result.assets,
      updatedAt: new Date().toISOString(),
    };
  }

  const critique = buildDeterministicProjectReview(latestProject);
  latestProject = parseProjectFileLight({
    ...markPlannedAssetsGenerated(latestProject, result.succeeded),
    critique,
    critiqueHistory: [
      ...(latestProject.critiqueHistory ?? []),
      {
        round: latestProject.critiqueHistory?.length ?? 0,
        overallScore: critique.overallScore,
        perPage: critique.reports.map((report) => ({ pageId: report.pageId, score: report.score })),
        accepted: true,
        generatedAt: critique.generatedAt,
      },
    ],
    updatedAt: critique.generatedAt,
  });
  await saveProjectToVad(latestProject);

  return {
    assets: (latestProject.assets ?? result.assets)
      .filter((asset) => asset.batchId === pendingAssets[0]?.batchId)
      .map((asset) => ({
        id: asset.id,
        src: asset.src,
        prompt: asset.prompt,
        status: asset.status,
      })),
    succeeded: result.succeeded,
    failed: result.failed,
    cancelled: result.cancelled,
    updatedProject: latestProject,
  };
};

const materializeSlotsHandler: JobHandler<{
  mockupAssetId: string;
  generatedCount: number;
  failedCount: number;
  estimatedCostUsd: number;
  actualCostUsd: number;
  updatedProject: ProjectFile;
}> = async (job: Job, { signal, reportProgress }) => {
  const payload = job.payload as {
    projectId: string;
    mockupAssetId: string;
    providerConfig: ProviderConfig;
    slotIds?: string[];
    forceRegen?: boolean;
  };

  const project = await loadMergedProjectFromVad(payload.projectId);
  if (!project) throw new Error("project_not_found");
  const mockup = (project.assets ?? []).find((a) => a.id === payload.mockupAssetId);
  if (!mockup?.src) throw new Error("mockup_not_found");
  const record = project.materializations?.[payload.mockupAssetId];
  if (!record) throw new Error("materialization_not_found");

  const { image } = resolveProviders(payload.providerConfig);
  const slotCount =
    payload.slotIds?.length ??
    record.layout.nodes.filter((n) => n.rebuildInCode === false).length;

  reportProgress({
    stage: "generating",
    completed: 0,
    failed: 0,
    total: Math.max(1, slotCount),
    message: `正在生成材料槽 0/${Math.max(1, slotCount)} · ${mockup.id.slice(0, 8)}`,
  });

  if (signal.aborted) throw abortError();

  const result = await generateMaterialsForLayout({
    project,
    mockup,
    record,
    image,
    slotIds: payload.slotIds,
    forceRegen: payload.forceRegen,
    abortSignal: signal,
  });

  await saveProjectToVad(result.project);

  reportProgress({
    stage: "persisting",
    completed: result.generatedCount,
    failed: result.failedCount,
    total: Math.max(1, slotCount),
    message: `材料已写入 · 成功 ${result.generatedCount} · 失败 ${result.failedCount}`,
  });

  return {
    mockupAssetId: payload.mockupAssetId,
    generatedCount: result.generatedCount,
    failedCount: result.failedCount,
    estimatedCostUsd: result.estimatedCostUsd,
    actualCostUsd: result.actualCostUsd,
    updatedProject: result.project,
  };
};

/**
 * 落盘前再读一次磁盘，合并 discarded，避免 Job 中间态把用户已删素材写回。
 */
async function persistAssetsRespectingDiscarded(
  fallback: ProjectFile,
  assets: ImageAsset[],
  build: (base: ProjectFile, assets: ImageAsset[]) => ProjectFile
): Promise<ProjectFile> {
  const disk = await loadMergedProjectFromVad(fallback.id).catch(() => null);
  const base = disk ?? fallback;
  const mergedAssets = mergeAssetsPreferDiscarded(base.assets, assets);
  // Write PNG bytes before Zod parse — multi-MB data URIs overflow the stack.
  const writtenAssets = await processBase64Assets(base.id, mergedAssets, "assets");
  const next = build(base, writtenAssets);
  await saveProjectToVad(next);
  return next;
}

function markPlannedAssetsGenerated(project: ProjectFile, generatedCount: number): ProjectFile {
  if (!project.assetPlan) return project;
  let remaining = Math.max(0, generatedCount);
  return {
    ...project,
    assetPlan: {
      ...project.assetPlan,
      items: project.assetPlan.items.map((item) => {
        if (item.status !== "planned" || remaining <= 0) return item;
        remaining -= 1;
        return { ...item, status: "generated" as const };
      }),
      updatedAt: new Date().toISOString(),
    },
  };
}

function buildUpdatedProject(
  project: ProjectFile,
  assets: ImageAsset[],
  agentCtx: AgentContext
): ProjectFile {
  return parseProjectFileLight({
    ...project,
    pages: project.pages ?? [],
    assets,
    designContext: resolveRunDesignContext(project, agentCtx.scratch),
    updatedAt: new Date().toISOString(),
  });
}

function buildProjectWithAssets(project: ProjectFile, assets: ImageAsset[]): ProjectFile {
  return parseProjectFileLight({
    ...project,
    pages: project.pages ?? [],
    assets,
    updatedAt: new Date().toISOString(),
  });
}

function ensureAssets(assets: ImageAsset[], pendingAssets: ImageAsset[]): ImageAsset[] {
  return mergePendingGeneratingAssets(assets, pendingAssets);
}

function abortError(): Error {
  const error = new Error("图片生成已取消");
  error.name = "AbortError";
  return error;
}

/** 注册所有 Job 处理器 */
export function registerAllJobHandlers(): void {
  if (registered) return;
  jobScheduler.registerHandler("image_generation", imageGenerationHandler);
  jobScheduler.registerHandler("direct_image_generation", directImageGenerationHandler);
  jobScheduler.registerHandler("materialize_slots", materializeSlotsHandler);
  registered = true;
}
