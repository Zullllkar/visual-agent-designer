/**
 * generate_image_variants 工具
 * --------------------------------------------------------------
 * 为已有视觉素材生成多张变体候选。
 * 确认后立即写入 generating 占位并提交 async Job，画布可先看到 loading 卡。
 */

import { nanoid } from "nanoid";
import type { ImageAsset } from "@/lib/project/assets-schema";
import { assetCodeDiff } from "@/lib/chat/page-code-diff";
import { deriveDesignContext } from "@/lib/project/design-context";
import { assertRealImageForGeneration } from "@/lib/providers/validate";
import { jobScheduler } from "@/lib/agents/job/job-scheduler";
import { registerAllJobHandlers } from "@/lib/agents/job/job-handlers";
import { agentRuns } from "@/lib/agents/agent-run-service";
import {
  buildDirectPendingAssets,
  type DirectImageGenerationRequest,
} from "@/lib/agents/direct-image-generation";
import { isEmptySpawnSlot } from "@/lib/canvas/spawn-child-asset";
import { stageGeneratingAssets } from "@/lib/canvas/stage-generating-assets";
import type { AgentTool, ToolContext, ToolResult } from "./types";
import { parseProjectFileLight } from "@/lib/project/parse-project";
import { expandDistinctPrompts, uniquePrompts } from "@/lib/agents/distinct-image-prompts";
import type { GenerateImagesApprovalPlan } from "./generate-images-approval";
import {
  buildVariantImagePrompt,
  clampInt,
  extractCitedAssetId,
  inferImageRole,
  isUsableReferenceImage,
  normalizeImageSize,
  parseRequestedImageCount,
  resolveRunDesignContext,
} from "./utils";

export const generateImageVariantsTool: AgentTool = {
  name: "generate_image_variants",
  description:
    "为已有视觉素材做图生图变体。必须传入 targetAssetId。" +
    "一张变体一条不同的 prompt（prompts[]）。禁止用 n 重复同一句。" +
    "以父图像素为准，保留文字与版式，只改风格/光影/细节。",
  inputPhase: ["GENERATION", "REVIEW"],
  outputPhase: "GENERATION",
  riskLevel: "moderate",
  requiresConfirmation: true,
  timeoutMs: 120_000,
  parameters: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "单条变体指令；多张请用 prompts[]" },
      prompts: {
        type: "array",
        items: { type: "string" },
        description: "每条变体一句不同的提示词。张数 = 长度。",
      },
      targetAssetId: { type: "string", description: "父素材 id" },
      n: {
        type: "number",
        description: "已废弃。不要用来重复同一句；用 prompts[]。",
      },
    },
    required: ["prompt"],
  },

  async execute(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    if (!ctx.project?.brief) {
      throw new Error("缺少 brief，无法生成素材变体");
    }
    assertRealImageForGeneration(ctx.providerConfig);
    registerAllJobHandlers();

    const targetAssetId = args.targetAssetId as string | undefined;
    const citedAssetId =
      (typeof ctx.agentCtx.scratch.citedAssetId === "string"
        ? ctx.agentCtx.scratch.citedAssetId
        : undefined) ?? extractCitedAssetId(ctx.userMessage);
    const existingAssets = (ctx.project.assets ?? []).filter(
      (a) => a.status !== "discarded"
    );
    const parent = resolveVariantParent(
      existingAssets,
      targetAssetId,
      citedAssetId
    );
    if (!parent?.src) {
      throw new Error("没有可做变体的素材，请先生成视觉素材");
    }

    const distinct = resolveVariantPrompts(args, ctx.userMessage);
    const size = normalizeImageSize(parent.width, parent.height);
    const designContext = deriveDesignContext(ctx.project);
    const variantGroupId = nanoid(8);
    const imagePrompts = distinct.map((instruction) =>
      buildVariantImagePrompt({
        instruction,
        parentPrompt: parent.prompt,
      })
    );
    const referenceImages = isUsableReferenceImage(parent.src)
      ? [parent.src]
      : undefined;

    const request: DirectImageGenerationRequest = {
      prompt: imagePrompts[0] ?? "",
      prompts: imagePrompts,
      count: imagePrompts.length,
      width: size.width,
      height: size.height,
      referenceImages,
      parentAssetId: parent.id,
      editInstruction: distinct[0],
      role: parent.role ?? inferImageRole(parent.width, parent.height),
    };

    const pendingAssets = buildVariantPendingAssets({
      assets: existingAssets,
      parentId: parent.id,
      request,
      batchId: variantGroupId,
      designContextVersion: designContext?.version,
    });

    const projectWithPending = parseProjectFileLight({
      ...stageGeneratingAssets(ctx.project, pendingAssets),
      designContext: resolveRunDesignContext(ctx.project, ctx.agentCtx.scratch),
    });

    const job = jobScheduler.submit({
      type: "direct_image_generation",
      payload: {
        project: projectWithPending,
        providerConfig: ctx.providerConfig,
        request,
        pendingAssets,
      },
      runId: ctx.runId,
      toolCallId: ctx.toolCallId,
      projectId: ctx.agentCtx.projectId,
      threadId: ctx.agentCtx.threadId,
      phase: "GENERATION",
    });
    if (ctx.runId) {
      agentRuns.addJobToRun(ctx.runId, job.id);
    }

    ctx.onProjectUpdate?.(projectWithPending);

    return {
      summary: `已提交 ${imagePrompts.length} 张变体生成任务（父素材 ${parent.id.slice(0, 8)}）`,
      data: {
        jobId: job.id,
        jobType: job.type,
        batchId: variantGroupId,
        parentAssetId: parent.id,
        pendingAssetIds: pendingAssets.map((a) => a.id),
        count: imagePrompts.length,
      },
      updatedProject: projectWithPending,
      fileWrites: pendingAssets.map((asset) => `design/assets/${asset.id}.png`),
      codeDiffs: pendingAssets.map((asset, i) =>
        assetCodeDiff(asset, `generate_image_variants_pending_${i}`)
      ),
    };
  },

  async fallback(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    return this.execute(args, ctx);
  },
};

export function resolveVariantPrompts(
  args: Record<string, unknown>,
  userMessage: string
): string[] {
  const existing = uniquePrompts([
    ...(Array.isArray(args.prompts)
      ? args.prompts.filter((p): p is string => typeof p === "string")
      : []),
    typeof args.prompt === "string" ? args.prompt : "",
  ]);
  const userCount = parseRequestedImageCount(userMessage);
  const approved =
    typeof args.approvalId === "string" && args.approvalId.trim().length > 0;
  const requested = clampInt(
    userCount ??
      (existing.length >= 2
        ? existing.length
        : approved
          ? Number(args.n ?? args.count ?? 1)
          : 1),
    1,
    4
  );
  return expandDistinctPrompts({
    basePrompt: existing[0] || userMessage,
    requestedCount: requested,
    existing,
    kind: "variant",
  });
}

export function prepareVariantImageApproval(
  args: Record<string, unknown>,
  ctx: { userMessage: string }
): GenerateImagesApprovalPlan {
  const prompts = resolveVariantPrompts(args, ctx.userMessage);
  return {
    confirmed:
      typeof args.approvalId === "string" && args.approvalId.trim().length > 0,
    preview: {
      title:
        prompts.length > 1
          ? `变体执行请求：${prompts.length} 张不同提示词`
          : "变体执行请求",
      prompt: prompts[0] ?? "",
      prompts,
      reason:
        prompts.length > 1
          ? "每张变体一条提示词，共用父图锁。执行前可逐条改。"
          : "一张变体一条提示词。",
      count: Math.max(1, prompts.length),
      width: 1024,
      height: 1024,
    },
    approvedArgs: {
      ...args,
      n: undefined,
      confirmed: true,
      prompt: prompts[0] ?? "",
      prompts,
      count: Math.max(1, prompts.length),
    },
  };
}

export function resolveVariantParent(
  assets: ImageAsset[],
  targetAssetId?: string,
  citedAssetId?: string
): ImageAsset | undefined {
  const withSrc = assets.filter((asset) => Boolean(asset.src?.trim()));
  const byId = (id?: string) =>
    id ? withSrc.find((asset) => asset.id === id) : undefined;
  return (
    byId(targetAssetId) ??
    byId(citedAssetId) ??
    withSrc.find((asset) => asset.status === "starred") ??
    [...withSrc].reverse()[0]
  );
}

/** 优先复用同父空「+」占位 id，保证结果写回原卡 */
export function buildVariantPendingAssets(input: {
  assets: ImageAsset[];
  parentId: string;
  request: DirectImageGenerationRequest;
  batchId: string;
  designContextVersion?: number;
}): ImageAsset[] {
  const empties = input.assets
    .filter(
      (a) =>
        isEmptySpawnSlot(a) &&
        a.parentAssetId === input.parentId &&
        (a.status ?? "candidate") !== "discarded"
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const base = buildDirectPendingAssets(input.request, input.batchId);
  return base.map((pending, index) => {
    const empty = empties[index];
    return {
      ...pending,
      id: empty?.id ?? pending.id,
      createdAt: empty?.createdAt ?? pending.createdAt,
      designContextVersion: input.designContextVersion,
      referenceAssetIds: empty?.referenceAssetIds ?? [input.parentId],
    };
  });
}
