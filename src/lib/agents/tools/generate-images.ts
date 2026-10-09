/**
 * generate_images tool.
 *
 * Image generation is intentionally two-step:
 * 1. Prepare a clear prompt/count/reason confirmation card.
 * 2. Execute only after the user confirms or edits that prompt.
 *
 * Contract:
 * - prompts[] / variants[] → one image per distinct prompt
 * - count/n never repeats a single prompt; expand to distinct prompts first
 *
 * Confirmed runs always stage generating placeholders on the canvas first,
 * then fill them in place (async job or sync batch).
 */

import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { assetCodeDiff } from "@/lib/chat/page-code-diff";
import type { PipelineLogger } from "@/lib/agents/pipeline-logger";
import type { AgentTool, ToolContext, ToolResult } from "./types";
import {
  buildVariantImagePrompt,
  clampInt,
  isVariantImageInstruction,
  resolveRunDesignContext,
} from "./utils";
import { parseProjectFileLight } from "@/lib/project/parse-project";
import { ensureProjectBrief } from "@/lib/project/ensure-brief";
import { processBase64Assets } from "@/lib/vad/persist";
import { jobScheduler } from "@/lib/agents/job/job-scheduler";
import { agentRuns } from "@/lib/agents/agent-run-service";
import { prepareGenerateImagesApproval } from "./generate-images-approval";
import { normalizeImagePrompts } from "@/lib/agents/image-prompts";
import {
  collectProjectReferenceImages,
  groundPromptToCitedReferences,
  stripCitationPrefix,
  type CollectedReferenceImages,
} from "@/lib/agents/reference-images";
import { resolveReferenceImagesForModel } from "@/lib/agents/resolve-reference-images";
import {
  buildDirectPendingAssets,
  runDirectImageGenerationBatch,
  type DirectImageGenerationRequest,
} from "@/lib/agents/direct-image-generation";
import { alignPendingGeneratingAssets, stageGeneratingAssets } from "@/lib/canvas/stage-generating-assets";
import { registerAllJobHandlers } from "@/lib/agents/job/job-handlers";
import { resolveProviders } from "@/lib/providers/registry";
import {
  persistThenSubmitJob,
  publishGeneratingPlaceholders,
} from "@/lib/agents/persist-then-submit";
import { isSameActiveImageJob } from "@/lib/agents/image-job-dedupe";

export const generateImagesTool: AgentTool = {
  name: "generate_images",
  description: [
    "Generate high-fidelity visual image assets. Always request user confirmation before submitting the image model job.",
    "Always pass prompts: string[] with one DISTINCT prompt per image. Never use count/n to repeat the same prompt.",
    "If the user asks for N images, write N different prompts (or let the system expand lock+delta). One prompt means one image.",
    "When the user attached reference images (project.references / 【参考图】), the tool automatically feeds them into the image model; optionally pass referenceIds to prefer specific ones.",
  ].join(" "),
  inputPhase: ["BRIEF", "DIRECTION", "ASSET_PLAN", "GENERATION"],
  outputPhase: "GENERATION",
  riskLevel: "moderate",
  requiresConfirmation: true,
  timeoutMs: 10 * 60_000,
  idempotencyKey: (args) => {
    const normalized = normalizeImagePrompts(args);
    return JSON.stringify({
      count: normalized.count,
      mode: args.mode ?? "async",
      confirmed: args.confirmed === true,
      prompts: normalized.prompts,
    });
  },
  parameters: {
    type: "object",
    properties: {
      count: {
        type: "number",
        description:
          "Ignored. Image count is prompts.length. Do not repeat one prompt.",
      },
      n: { type: "number", description: "Alias for count" },
      prompts: {
        type: "array",
        items: { type: "string" },
        description:
          "Distinct prompts for different image types/compositions. One image per entry. Prefer this when the user asks for multiple different kinds.",
      },
      variants: {
        type: "array",
        items: {
          type: "object",
          properties: {
            prompt: { type: "string" },
            role: {
              type: "string",
              enum: ["hero", "illustration", "product-shot", "background", "avatar"],
            },
            width: { type: "number" },
            height: { type: "number" },
          },
        },
        description: "Structured alternative to prompts[] with optional role/size per type.",
      },
      mode: {
        type: "string",
        enum: ["sync", "async"],
        description: "async submits a background job; sync executes immediately.",
      },
      confirmed: {
        type: "boolean",
        description:
          "Do not set this. The system sets it only after the user clicks the approval card.",
      },
      prompt: {
        type: "string",
        description:
          "Single image prompt. For more than one image, pass prompts[] instead.",
      },
      referenceIds: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional project.references ids to prefer as style references for this generation.",
      },
    },
  },

  async execute(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    if (!ctx.project) {
      throw new Error("Missing project; cannot generate images.");
    }
    ctx.project = ensureProjectBrief(ctx.project, {
      prompt: typeof args.prompt === "string" ? args.prompt : undefined,
      userMessage: ctx.userMessage,
    });

    const preferIds = [
      ...(Array.isArray(args.referenceIds)
        ? args.referenceIds.filter((id): id is string => typeof id === "string")
        : []),
      ...((ctx.agentCtx.scratch.composerReferenceIds as string[] | undefined) ??
        []),
      ...((typeof ctx.agentCtx.scratch.citedAssetId === "string"
        ? [ctx.agentCtx.scratch.citedAssetId]
        : [])),
    ];
    const collectedRefs = collectProjectReferenceImages(ctx.project, {
      preferIds,
      max: 3,
    });
    if (collectedRefs.srcs.length > 0) {
      ctx.agentCtx.scratch.referenceImages = collectedRefs.srcs;
      ctx.agentCtx.scratch.referenceLabels = collectedRefs.labels;
      ctx.agentCtx.scratch.referenceIds = collectedRefs.ids;
    }

    const mode = (args.mode as string | undefined) ?? "async";
    const plannedItems = ctx.project.assetPlan?.items.filter((item) => item.status === "planned") ?? [];
    const planningArgs =
      !args.prompt && !args.prompts && plannedItems.length > 0
        ? {
            ...args,
            prompts: plannedItems.slice(0, 8).map((item) => item.prompt),
            width: plannedItems[0]?.width,
            height: plannedItems[0]?.height,
            role: plannedItems[0]?.role,
          }
        : args;
    const approval = prepareGenerateImagesApproval(planningArgs, ctx);
    if (!approval) throw new Error("Missing project; cannot prepare image generation.");
    const { preview } = approval;
    const normalized = normalizeImagePrompts({
      prompt: planningArgs.prompt ?? preview.prompt,
      prompts: planningArgs.prompts ?? preview.prompts,
      variants: planningArgs.variants,
    });
    const prompts = (
      (preview.prompts?.length ? preview.prompts : normalized.prompts).filter(
        Boolean
      )
    ).map((item) =>
      groundPromptToCitedReferences(item, {
        cited: collectedRefs.exclusive,
        labels: collectedRefs.labels,
        userIntent: stripCitationPrefix(ctx.userMessage),
      })
    );
    const count = clampInt(Math.max(1, prompts.length), 1, 8);
    const width = clampInt(Number(args.width ?? preview.width), 256, 2048);
    const height = clampInt(Number(args.height ?? preview.height), 256, 2048);
    const role =
      typeof args.role === "string" && args.role.trim()
        ? args.role.trim()
        : preview.role;
    const prompt = prompts[0] ?? preview.prompt;
    const approvalId =
      typeof args.approvalId === "string" && args.approvalId.trim()
        ? args.approvalId.trim()
        : undefined;

    if (!approval.confirmed) {
      ctx.agentCtx.scratch.__imageGenerationConfirmation = preview;
      return {
        summary:
          prompts.length > 1
            ? `Image generation ready: ${prompts.length} distinct prompts awaiting confirmation.`
            : "Image generation is ready and waiting for user confirmation.",
        data: {
          confirmationRequired: true,
          ...preview,
          prompts,
          count,
        },
      };
    }

    if (mode === "async" || mode === "sync") {
      registerAllJobHandlers();
      if (ctx.agentCtx.projectId) {
        const existingJob = jobScheduler
          .listJobs({ projectId: ctx.agentCtx.projectId })
          .find((job) =>
            isSameActiveImageJob(job, {
              approvalId,
              prompt,
              prompts,
              count,
              width,
              height,
              role,
            })
          );
        if (existingJob) {
          return {
            summary: `Image generation is already running for this approval: ${existingJob.id}`,
            data: {
              jobId: existingJob.id,
              jobType: existingJob.type,
              projectId: existingJob.projectId,
              runId: existingJob.runId,
              toolCallId: existingJob.toolCallId,
              status: existingJob.status,
              progress: existingJob.progress,
              count,
              prompt,
              prompts,
              deduped: true,
            },
          };
        }
      }
      const batchId = approvalId ? stableBatchId(approvalId) : nanoid(8);
      const imagePrompts =
        prompts.length > 1
          ? prompts
          : Array.from({ length: count }, () => prompt);
      const directRequest = toDirectRequest({
        imagePrompts,
        prompt,
        width,
        height,
        role,
        collectedRefs,
      });
      const pendingAssets = alignPendingGeneratingAssets(
        ctx.project.assets ?? [],
        buildDirectPendingAssets(directRequest, batchId)
      );
      const projectWithPending = parseProjectFileLight(
        stageGeneratingAssets(ctx.project, pendingAssets)
      );
      const job = await persistThenSubmitJob(
        () => publishGeneratingPlaceholders(ctx, projectWithPending),
        () =>
          jobScheduler.submit({
            type: "direct_image_generation",
            payload: {
              approvalId,
              project: projectWithPending,
              providerConfig: ctx.providerConfig,
              request: directRequest,
              pendingAssets,
              width,
              height,
              role,
              prompt,
              prompts: imagePrompts,
              count,
            },
            runId: ctx.runId,
            turnId: typeof ctx.agentCtx.scratch.turnId === "string" ? ctx.agentCtx.scratch.turnId : undefined,
            toolCallId: ctx.toolCallId,
            projectId: ctx.agentCtx.projectId,
            threadId: ctx.agentCtx.threadId,
            phase: "GENERATION",
            batchId,
          })
      );
      if (ctx.runId) {
        agentRuns.addJobToRun(ctx.runId, job.id);
      }
      return {
        summary:
          prompts.length > 1
            ? `已开始生成 ${prompts.length} 张不同画面，画布上会出现占位图。`
            : `已开始生成 ${count} 张，画布上会出现占位图。`,
        data: {
          jobId: job.id,
          jobType: job.type,
          projectId: job.projectId,
          runId: job.runId,
          toolCallId: job.toolCallId,
          status: job.status,
          progress: job.progress,
          batchId,
          count: imagePrompts.length,
          prompt,
          prompts: imagePrompts,
          pendingAssetIds: pendingAssets.map((a) => a.id),
        },
        updatedProject: projectWithPending,
      };
    }

    const plog = ctx.agentCtx.scratch.pipelineLogger as PipelineLogger | undefined;
    const imagePrompts =
      prompts.length > 1
        ? prompts
        : Array.from({ length: count }, () => prompt);
    const batchId = approvalId ? stableBatchId(approvalId) : nanoid(8);
    const resolvedRefs = await resolveReferenceImagesForModel(
      collectedRefs.srcs,
      ctx.project.id
    );
    const directInput = toDirectRequest({
      imagePrompts,
      prompt,
      width,
      height,
      role,
      collectedRefs: { ...collectedRefs, srcs: resolvedRefs },
    });
    const pendingAssets = alignPendingGeneratingAssets(
      ctx.project.assets ?? [],
      buildDirectPendingAssets(directInput, batchId)
    );
    const projectWithPending = parseProjectFileLight(
      stageGeneratingAssets(ctx.project, pendingAssets)
    );
    ctx.onProjectUpdate?.(projectWithPending);
    ctx.agentCtx.scratch.__updatedProject = projectWithPending;

    const { image } = resolveProviders(ctx.providerConfig);
    const executed = plog
      ? await plog.runStage(
          "image_execute",
          `${pendingAssets.length} image task(s)`,
          () =>
            runDirectImageGenerationBatch({
              image,
              input: directInput,
              initialAssets: projectWithPending.assets ?? [],
              pendingAssets,
              signal: ctx.abortSignal,
              concurrency: 2,
              ledgerProjectId: ctx.project.id,
            }),
          (x) => ({ succeeded: x.succeeded, failed: x.failed })
        )
      : await runDirectImageGenerationBatch({
          image,
          input: directInput,
          initialAssets: projectWithPending.assets ?? [],
          pendingAssets,
          signal: ctx.abortSignal,
          concurrency: 2,
          ledgerProjectId: ctx.project.id,
        });

    const writtenAssets = await processBase64Assets(
      projectWithPending.id,
      executed.assets,
      "assets"
    );
    const updated = parseProjectFileLight({
      ...projectWithPending,
      pages: projectWithPending.pages ?? [],
      assets: writtenAssets,
      designContext: resolveRunDesignContext(
        projectWithPending,
        ctx.agentCtx.scratch
      ),
      updatedAt: new Date().toISOString(),
    });

    return {
      summary: `Image generation finished ${executed.succeeded}/${pendingAssets.length}; failed ${executed.failed}.`,
      data: { succeeded: executed.succeeded, failed: executed.failed },
      updatedProject: updated,
      fileWrites: executed.generatedAssets.map(
        (asset) => `design/assets/${asset.id}.png`
      ),
      codeDiffs: executed.generatedAssets.map((asset, index) =>
        assetCodeDiff(asset, `generate_images_${index}`)
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

function toDirectRequest(input: {
  imagePrompts: string[];
  prompt: string;
  width: number;
  height: number;
  role: unknown;
  collectedRefs: CollectedReferenceImages;
}): DirectImageGenerationRequest {
  const variantMode =
    Boolean(input.collectedRefs.parentAssetId) &&
    (input.imagePrompts.some(isVariantImageInstruction) ||
      isVariantImageInstruction(input.prompt));
  const hinted = input.imagePrompts.map((item) =>
    variantMode
      ? buildVariantImagePrompt({ instruction: item })
      : groundPromptToCitedReferences(item, {
          cited: input.collectedRefs.exclusive,
          labels: input.collectedRefs.labels,
        })
  );
  return {
    prompt: hinted[0] ?? input.prompt,
    prompts: hinted,
    count: hinted.length,
    width: input.width,
    height: input.height,
    role:
      typeof input.role === "string"
        ? (input.role as DirectImageGenerationRequest["role"])
        : undefined,
    referenceImages: input.collectedRefs.srcs,
    parentAssetId: input.collectedRefs.parentAssetId,
  };
}

function stableBatchId(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 10);
}
