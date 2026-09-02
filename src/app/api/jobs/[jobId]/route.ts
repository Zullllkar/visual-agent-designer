import { registerAllJobHandlers } from "@/lib/agents/job/job-handlers";
import { jobScheduler } from "@/lib/agents/job/job-scheduler";
import { loadJobSnapshot, markJobSnapshotCancelled } from "@/lib/agents/job/job-persist";
import { toClientJob } from "@/lib/agents/job/to-client-job";
import { buildDirectPendingAssets } from "@/lib/agents/direct-image-generation";
import { threadIdForProject } from "@/lib/agents/checkpoint";
import { ProjectFileSchema } from "@/lib/project/schema";
import { loadMergedProjectFromVad, saveProjectToVad } from "@/lib/vad/storage";
import { nanoid } from "nanoid";

type JobRouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function GET(req: Request, ctx: JobRouteContext) {
  registerAllJobHandlers();
  const { jobId } = await ctx.params;
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId") ?? undefined;
  const job = jobScheduler.getJob(jobId) ?? await loadJobSnapshot(projectId, jobId);
  if (!job) {
    return Response.json({ error: "job_not_found", jobId }, { status: 404 });
  }
  return Response.json({ job: toClientJob(job as Record<string, unknown>) });
}

export async function DELETE(req: Request, ctx: JobRouteContext) {
  registerAllJobHandlers();
  const { jobId } = await ctx.params;
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId") ?? undefined;
  const job = jobScheduler.getJob(jobId);
  if (!job) {
    const snapshot = await markJobSnapshotCancelled(projectId, jobId);
    if (!snapshot) {
      return Response.json({ jobId, cancelled: true, missing: true });
    }
    return Response.json({ jobId, cancelled: true, job: snapshot });
  }
  jobScheduler.cancel(jobId);
  return Response.json({ jobId, cancelled: true });
}

export async function POST(req: Request, ctx: JobRouteContext) {
  registerAllJobHandlers();
  const { jobId } = await ctx.params;
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId") ?? undefined;
  const sourceJob = jobScheduler.getJob(jobId) ?? await loadJobSnapshot(projectId, jobId);
  if (!sourceJob) {
    return Response.json({ error: "job_not_found", jobId }, { status: 404 });
  }
  if (sourceJob.type !== "direct_image_generation") {
    return Response.json({ error: "job_not_retryable", jobId }, { status: 400 });
  }
  const recoverable =
    "payload" in sourceJob
      ? (sourceJob.payload as Record<string, unknown>)
      : sourceJob.recoverablePayload;
  const request = recoverable?.request as Parameters<typeof buildDirectPendingAssets>[0] | undefined;
  const providerConfig = recoverable?.providerConfig;
  const resolvedProjectId = sourceJob.projectId ?? projectId;
  if (!request || !providerConfig || !resolvedProjectId) {
    return Response.json({ error: "job_not_retryable", jobId }, { status: 400 });
  }

  const project = await loadMergedProjectFromVad(resolvedProjectId);
  if (!project) {
    return Response.json(
      { error: "project_not_found", projectId: resolvedProjectId },
      { status: 404 }
    );
  }
  const batchId = nanoid(8);
  const pendingAssets = buildDirectPendingAssets(request, batchId);
  const updatedProject = ProjectFileSchema.parse({
    ...project,
    assets: [...(project.assets ?? []), ...pendingAssets],
    updatedAt: new Date().toISOString(),
  });
  await saveProjectToVad(updatedProject);

  const retryJob = jobScheduler.submit({
    type: "direct_image_generation",
    payload: {
      project: updatedProject,
      providerConfig,
      request,
      pendingAssets,
    },
    batchId,
    runId: sourceJob.runId,
    toolCallId: sourceJob.toolCallId,
    projectId: resolvedProjectId,
    threadId: sourceJob.threadId ?? threadIdForProject(resolvedProjectId),
    phase: sourceJob.phase,
  });

  return Response.json({
    retriedFrom: jobId,
    job: toClientJob(retryJob),
    project: updatedProject,
    assets: pendingAssets,
  });
}
