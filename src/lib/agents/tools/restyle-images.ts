/**
 * restyle_images 工具
 * --------------------------------------------------------------
 * 按指令为现有素材批量换风格。确认后立即写入 generating 占位并提交 async Job。
 */

import { nanoid } from "nanoid";
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
import { stageGeneratingAssets } from "@/lib/canvas/stage-generating-assets";
import { publishGeneratingPlaceholders } from "@/lib/agents/persist-then-submit";
import { ensureProjectBrief } from "@/lib/project/ensure-brief";
import type { AgentTool, ToolContext, ToolResult } from "./types";
import {
  buildNodeImagePrompt,
  clampInt,
  inferImageRole,
  isUsableReferenceImage,
  normalizeImageSize,
  ProjectFileSchema,
  resolveRunDesignContext,
} from "./utils";

export const restyleImagesTool: AgentTool = {
  name: "restyle_page_images",
  description: "按指令为现有素材批量换风格（兼容旧工具名）",
  inputPhase: ["GENERATION", "REVIEW"],
  outputPhase: "REVIEW",
  riskLevel: "moderate",
  requiresConfirmation: true,
  timeoutMs: 120_000,
  parameters: {
    type: "object",
    properties: {
      instruction: { type: "string", description: "统一风格指令" },
      n: { type: "number" },
      referenceAssetId: {
        type: "string",
        description: "风格参考素材 id，其余图按它对齐",
      },
      excludeAssetIds: {
        type: "array",
        items: { type: "string" },
        description: "不参与换风格的素材（通常是风格源图）",
      },
    },
    required: ["instruction"],
  },

  async execute(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    if (!ctx.project) {
      throw new Error("缺少项目，无法统一素材风格");
    }
    ctx.project = ensureProjectBrief(ctx.project, {
      prompt: typeof args.instruction === "string" ? args.instruction : undefined,
      userMessage: ctx.userMessage,
    });
    assertRealImageForGeneration(ctx.providerConfig);
    registerAllJobHandlers();

    const instruction =
      (args.instruction as string | undefined) ?? ctx.userMessage;
    const excludeIds = new Set(
      (Array.isArray(args.excludeAssetIds) ? args.excludeAssetIds : [])
        .map((id) => String(id))
        .filter(Boolean)
    );
    const styleAssetId =
      typeof args.referenceAssetId === "string" && args.referenceAssetId.trim()
        ? args.referenceAssetId.trim()
        : undefined;
    const styleAsset = styleAssetId
      ? (ctx.project.assets ?? []).find((asset) => asset.id === styleAssetId)
      : undefined;
    const styleSrc = isUsableReferenceImage(styleAsset?.src)
      ? styleAsset.src
      : undefined;
    const sources = (ctx.project.assets ?? []).filter(
      (a) =>
        !excludeIds.has(a.id) &&
        a.status !== "discarded" &&
        a.status !== "generating" &&
        isUsableReferenceImage(a.src)
    );
    if (sources.length === 0) {
      throw new Error("没有可换风格的素材，请先生成视觉素材");
    }

    const designContext = deriveDesignContext(ctx.project);
    const targets = sources.slice(0, clampInt(Number(args.n ?? 4), 1, 4));
    const prompts = targets.map((parent) =>
      buildNodeImagePrompt({
        project: ctx.project!,
        instruction,
        currentPrompt: parent.prompt,
        designContextSummary: designContext?.imageStyle,
      })
    );

    // 每张源图各自提交一笔 job，父链清晰；先统一 stage 占位再并行跑
    const batchId = nanoid(8);
    const pendingAssets = targets.flatMap((parent, index) => {
      const parentSize = normalizeImageSize(parent.width, parent.height);
      const request: DirectImageGenerationRequest = {
        prompt: prompts[index]!,
        count: 1,
        width: parentSize.width,
        height: parentSize.height,
        referenceImages: resolveRestyleReferenceImages(parent.src, styleSrc),
        parentAssetId: parent.id,
        editInstruction: instruction,
        role: parent.role ?? inferImageRole(parent.width, parent.height),
      };
      return buildDirectPendingAssets(request, `${batchId}_${index}`).map(
        (pending) => ({
          ...pending,
          designContextVersion: designContext?.version,
          referenceAssetIds: [styleAssetId, parent.id].filter(
            (id): id is string => Boolean(id)
          ),
        })
      );
    });

    const projectWithPending = ProjectFileSchema.parse({
      ...stageGeneratingAssets(ctx.project, pendingAssets),
      designContext: resolveRunDesignContext(ctx.project, ctx.agentCtx.scratch),
    });

    await publishGeneratingPlaceholders(ctx, projectWithPending);

    const jobIds: string[] = [];
    for (let index = 0; index < targets.length; index++) {
      const parent = targets[index]!;
      const parentSize = normalizeImageSize(parent.width, parent.height);
      const request: DirectImageGenerationRequest = {
        prompt: prompts[index]!,
        count: 1,
        width: parentSize.width,
        height: parentSize.height,
        referenceImages: resolveRestyleReferenceImages(parent.src, styleSrc),
        parentAssetId: parent.id,
        editInstruction: instruction,
        role: parent.role ?? inferImageRole(parent.width, parent.height),
      };
      const slice = pendingAssets.filter((a) => a.parentAssetId === parent.id);
      const job = jobScheduler.submit({
        type: "direct_image_generation",
        payload: {
          project: projectWithPending,
          providerConfig: ctx.providerConfig,
          request,
          pendingAssets: slice,
        },
        runId: ctx.runId,
            turnId: typeof ctx.agentCtx.scratch.turnId === "string" ? ctx.agentCtx.scratch.turnId : undefined,
        toolCallId: ctx.toolCallId,
        projectId: ctx.agentCtx.projectId,
        threadId: ctx.agentCtx.threadId,
        phase: "GENERATION",
        batchId: `${batchId}_${index}`,
      });
      jobIds.push(job.id);
      if (ctx.runId) {
        agentRuns.addJobToRun(ctx.runId, job.id);
      }
    }

    return {
      summary: `已提交 ${targets.length} 张换风格任务（画布已出现 loading 占位）`,
      data: {
        jobIds,
        batchId,
        pendingAssetIds: pendingAssets.map((a) => a.id),
        count: targets.length,
      },
      updatedProject: projectWithPending,
      fileWrites: pendingAssets.map((a) => `design/assets/${a.id}.png`),
      codeDiffs: pendingAssets.map((a, i) =>
        assetCodeDiff(a, `restyle_page_images_pending_${i}`)
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

function resolveRestyleReferenceImages(
  parentSrc: string | undefined,
  styleSrc: string | undefined
): string[] | undefined {
  const refs = [styleSrc, parentSrc].filter(isUsableReferenceImage);
  const unique = Array.from(new Set(refs));
  return unique.length > 0 ? unique.slice(0, 4) : undefined;
}
