import { nanoid } from "nanoid";
import { z } from "zod";

import {
  buildDirectPendingAssets,
  runDirectImageGenerationBatch,
  type DirectImageGenerationRequest,
} from "@/lib/agents/direct-image-generation";
import { threadIdForProject } from "@/lib/agents/checkpoint";
import { registerAllJobHandlers } from "@/lib/agents/job/job-handlers";
import { jobScheduler } from "@/lib/agents/job/job-scheduler";
import { stageGeneratingAssets } from "@/lib/canvas/stage-generating-assets";
import { ProjectFileSchema } from "@/lib/project/schema";
import type { ImageAsset } from "@/lib/project/assets-schema";
import { ProviderConfigSchema } from "@/lib/providers/config-schema";
import { resolveProviders } from "@/lib/providers/registry";
import { loadMergedProjectFromVad, saveProjectToVad } from "@/lib/vad/storage";

const InputSchema = z.object({
  prompt: z.string().min(1).max(2000),
  n: z.number().int().min(1).max(8).optional(),
  width: z.number().int().positive().max(4096).optional(),
  height: z.number().int().positive().max(4096).optional(),
  visualStyle: z.string().max(200).optional(),
  sourcePageId: z.string().optional(),
  negativePrompt: z.string().max(500).optional(),
  referenceImages: z.array(z.string().min(1).max(8_000_000)).max(4).optional(),
  parentAssetId: z.string().optional(),
  editInstruction: z.string().max(1000).optional(),
  editRegion: z
    .object({
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
    })
    .optional(),
  role: z
    .enum(["hero", "illustration", "product-shot", "background", "icon", "avatar"])
    .optional(),
  projectId: z.string().optional(),
  threadId: z.string().optional(),
  async: z.boolean().optional(),
  providerConfig: ProviderConfigSchema,
});

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = InputSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_input", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const {
    prompt,
    n = 1,
    width = 1024,
    height = 1024,
    visualStyle,
    sourcePageId,
    negativePrompt,
    referenceImages,
    parentAssetId,
    editInstruction,
    editRegion,
    role,
    projectId,
    threadId,
    providerConfig,
  } = parsed.data;

  const request: DirectImageGenerationRequest = {
    prompt,
    count: n,
    width,
    height,
    visualStyle,
    sourcePageId,
    negativePrompt,
    referenceImages,
    parentAssetId,
    editInstruction,
    editRegion,
    role,
  };
  const batchId = nanoid(8);

  if (projectId && parsed.data.async !== false) {
    registerAllJobHandlers();
    const project = await loadMergedProjectFromVad(projectId);
    if (!project) {
      return Response.json({ error: "project_not_found", projectId }, { status: 404 });
    }
    const pendingAssets = buildDirectPendingAssets(request, batchId);
    const updatedProject = ProjectFileSchema.parse(
      stageGeneratingAssets(project, pendingAssets)
    );
    await saveProjectToVad(updatedProject);

    const job = jobScheduler.submit({
      type: "direct_image_generation",
      payload: {
        project: updatedProject,
        providerConfig,
        request,
        pendingAssets,
      },
      batchId,
      projectId,
      threadId: threadId ?? threadIdForProject(projectId),
      phase: "GENERATION",
    });

    return Response.json({
      assets: pendingAssets,
      batchId,
      requested: n,
      succeeded: 0,
      project: updatedProject,
      job: {
        jobId: job.id,
        jobType: job.type,
        status: job.status,
        progress: job.progress,
        progressDetail: job.progressDetail,
      },
    });
  }

  const { image } = resolveProviders(providerConfig);
  const result = await runDirectImageGenerationBatch({
    image,
    input: request,
    initialAssets: [],
    pendingAssets: buildDirectPendingAssets(request, batchId),
    concurrency: 2,
    ledgerProjectId: projectId,
  });

  const assets: ImageAsset[] = result.generatedAssets;
  if (assets.length === 0) {
    return Response.json(
      { error: "all_failed", errors: result.errors.slice(0, 5) },
      { status: 502 }
    );
  }

  return Response.json({
    assets,
    batchId,
    requested: n,
    succeeded: assets.length,
    errors: result.errors.length > 0 ? result.errors.slice(0, 5) : undefined,
  });
}
