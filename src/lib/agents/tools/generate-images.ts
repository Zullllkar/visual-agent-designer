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
import { stageGeneratingAssets } from "@/lib/canvas/stage-generating-assets";
import { registerAllJobHandlers } from "@/lib/agents/job/job-handlers";
import { resolveProviders } from "@/lib/providers/registry";

export const generateImagesTool: AgentTool = {
  name: "generate_images",
  description: [
    "Generate high-fidelity visual image assets. Always request user confirmation before submitting the image model job.",
    "Always pass prompts: string[] with one DISTINCT prompt per image. Never use count/n to repeat the same prompt.",
    "If the user asks for N images, write N different prompts (or let the system expand lock+delta). One prompt means one image.",
    "When the user attached reference images (project.references / 【参考图】), the tool automatically feeds them into the image model; optionally pass referenceIds to prefer specific ones.",
  ].join(" "),
  inputPhase: ["BRIEF", "DIRECTION", "GENERATION"],
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
    if (!ctx.project?.brief) {
      throw new Error("Missing brief; cannot generate images.");
    }

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
    const approval = prepareGenerateImagesApproval(args, ctx);
    if (!approval) throw new Error("Missing project; cannot prepare image generation.");
    const { preview } = approval;
    const normalized = normalizeImagePrompts({
      prompt: args.prompt ?? preview.prompt,
      prompts: args.prompts ?? preview.prompts,
      variants: args.variants,
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

    if (mode === "async") {
      registerAllJobHandlers();
      const requestSignature = imageJobSignature({
        prompt,
        prompts,
        count,
        width,
        height,
        role,
      });
      if (ctx.agentCtx.projectId) {
        const existingJob = jobScheduler
          .listJobs({ projectId: ctx.agentCtx.projectId })
          .find((job) => {
            const payload = job.payload as
              | {
                  approvalId?: unknown;
                  prompt?: unknown;
                  prompts?: unknown;
                  count?: unknown;
                  width?: unknown;
                  height?: unknown;
                  role?: unknown;
                  request?: { prompt?: unknown; prompts?: unknown; count?: unknown };
                }
              | undefined;
            const payloadPrompts = Array.isArray(payload?.prompts)
              ? payload.prompts.filter((p): p is string => typeof p === "string")
              : Array.isArray(payload?.request?.prompts)
                ? payload.request.prompts.filter(
                    (p): p is string => typeof p === "string"
                  )
                : [
                    typeof payload?.prompt === "string"
                      ? payload.prompt
                      : typeof payload?.request?.prompt === "string"
                        ? payload.request.prompt
                        : "",
                  ].filter(Boolean);
            const payloadCount = Number(
              payload?.count ?? payload?.request?.count ?? 1
            );
            return (
              (job.type === "image_generation" ||
                job.type === "direct_image_generation") &&
              (job.status === "pending" || job.status === "running") &&
              ((approvalId && payload?.approvalId === approvalId) ||
                imageJobSignature({
                  prompt:
                    typeof payload?.prompt === "string"
                      ? payload.prompt
                      : typeof payload?.request?.prompt === "string"
                        ? payload.request.prompt
                        : "",
                  prompts: payloadPrompts,
                  count: payloadCount,
                  width: Number(payload?.width ?? 1280),
                  height: Number(payload?.height ?? 720),
                  role: typeof payload?.role === "string" ? payload.role : undefined,
                }) === requestSignature)
            );
          });
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
      const pendingAssets = buildDirectPendingAssets(directRequest, batchId);
      const projectWithPending = parseProjectFileLight(
        stageGeneratingAssets(ctx.project, pendingAssets)
      );
      const job = jobScheduler.submit({
        type: "direct_image_generation",
        payload: {
          project: projectWithPending,
          providerConfig: ctx.providerConfig,
          request: directRequest,
          pendingAssets,
        },
        runId: ctx.runId,
        toolCallId: ctx.toolCallId,
        projectId: ctx.agentCtx.projectId,
        threadId: ctx.agentCtx.threadId,
        phase: "GENERATION",
        batchId,
      });
      if (ctx.runId) {
        agentRuns.addJobToRun(ctx.runId, job.id);
      }
      ctx.onProjectUpdate?.(projectWithPending);
      return {
        summary:
          prompts.length > 1
            ? `Started ${prompts.length} distinct image types: ${job.id}`
            : `Started ${count} image generation job(s): ${job.id}`,
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
    const pendingAssets = buildDirectPendingAssets(directInput, batchId);
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

function imageJobSignature(input: {
  prompt: string;
  prompts?: string[];
  count: number;
  width: number;
  height: number;
  role?: string;
}): string {
  return stableBatchId(
    JSON.stringify({
      prompts: (input.prompts?.length ? input.prompts : [input.prompt]).map((p) =>
        p.replace(/\s+/g, " ").trim()
      ),
      count: input.count,
      width: input.width,
      height: input.height,
      role: input.role ?? "",
    })
  );
}
