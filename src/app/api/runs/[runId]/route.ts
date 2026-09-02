import { agentRuns } from "@/lib/agents/agent-run-service";
import { phaseLabel } from "@/lib/agents/agent-phase";
import { IMAGE_CONFIRM_MARKER } from "@/lib/agents/image-generation-confirmation";
import { readEventLog } from "@/lib/agents/event-persist";
import {
  listJobSnapshots,
  markJobSnapshotCancelled,
} from "@/lib/agents/job/job-persist";
import { registerAllJobHandlers } from "@/lib/agents/job/job-handlers";
import { jobScheduler } from "@/lib/agents/job/job-scheduler";
import { loadRun, saveRun } from "@/lib/agents/run-persist";
import {
  toolRequiresConfirmation,
  toolRiskLevel,
} from "@/lib/agents/tools/tool-risk";
import { normalizeGenerateImagesApprovalArgs } from "@/lib/agents/tools/generate-images-approval";
import { appendEvent } from "@/lib/agents/event-persist";
import { injectProviderScratch } from "@/lib/agents/content-preferences";
import type { AgentContext } from "@/lib/agents/types";
import { resolveProviders, type ProviderConfig } from "@/lib/providers/registry";
import { resolveSkillContext } from "@/lib/skills/context";
import { loadMergedProjectFromVad } from "@/lib/vad/storage";
import type { ProjectFile } from "@/lib/project/schema";
import { connectionManager } from "@/lib/ws/connection-manager";
import { eventBuffer } from "@/lib/ws/event-buffer";
import type { WsEvent } from "@/lib/ws/types";

type RunRouteContext = {
  params: Promise<{ runId: string }>;
};

export async function GET(req: Request, ctx: RunRouteContext) {
  registerAllJobHandlers();
  const { runId } = await ctx.params;
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId") ?? undefined;

  if (!projectId) {
    return Response.json({ error: "missing_project_id" }, { status: 400 });
  }

  const loadedRun = agentRuns.getRun(runId) ?? await loadRun(projectId, runId);
  const run = loadedRun ? agentRuns.hydrateRun(loadedRun) : undefined;
  if (!run || run.projectId !== projectId) {
    return Response.json({ error: "run_not_found", runId }, { status: 404 });
  }

  const memoryJobs = jobScheduler.listJobs({ projectId, runId });
  const snapshotJobs = await listJobSnapshots({ projectId, runId });
  const project = await loadMergedProjectFromVad(projectId).catch(() => null);
  const jobsById = new Map<string, unknown>();
  for (const job of snapshotJobs) jobsById.set(job.id, job);
  for (const job of memoryJobs) jobsById.set(job.id, job);

  const events = (await readEventLog(projectId))
    .filter((event) => eventBelongsToRun(event, runId))
    .sort((a, b) => eventTime(a) - eventTime(b))
    .map(toEventSummary);

  return Response.json({
    run: {
      runId: run.runId,
      threadId: run.threadId,
      projectId: run.projectId,
      status: run.status,
      phase: run.phase,
      phaseLabel: phaseLabel(run.phase),
      currentStep: run.currentStep,
      promptSummary: run.promptSummary,
      retryPrompt: retryPromptForRun(run),
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      lastHeartbeatAt: run.lastHeartbeatAt,
      lastEventAt: events.at(-1)?.at,
      durationMs:
        (run.endedAt ?? events.at(-1)?.at ?? run.lastHeartbeatAt ?? Date.now()) -
        run.startedAt,
      error: run.error,
      pendingToolApproval:
        run.pendingToolApproval?.status === "pending"
          ? {
              approvalId: run.pendingToolApproval.approvalId,
              checkpointInterruptId: run.pendingToolApproval.checkpointInterruptId,
              toolName: run.pendingToolApproval.toolName,
              toolCallId: run.pendingToolApproval.toolCallId,
              args: sanitizePendingToolArgs(run, project),
              riskLevel: run.pendingToolApproval.riskLevel,
              reason: run.pendingToolApproval.reason,
              requestedAt: run.pendingToolApproval.requestedAt,
            }
          : undefined,
      jobIds: run.jobIds,
    },
    jobs: [...jobsById.values()].map(toJobSummary),
    events,
  });
}

function sanitizePendingToolArgs(
  run: NonNullable<ReturnType<typeof agentRuns.getRun>>,
  project?: ProjectFile | null
): Record<string, unknown> {
  const pending = run.pendingToolApproval;
  if (!pending || pending.toolName !== "generate_images" || !project) {
    return pending?.args ?? {};
  }
  return normalizeGenerateImagesApprovalArgs(pending.args, {
    project,
    userMessage: run.prompt ?? "",
    agentCtx: {
      projectId: run.projectId,
      threadId: run.threadId,
      scratch: {},
      providers: {
        llm: { kind: "mock" } as never,
        image: { kind: "mock" } as never,
        visionCritic: false,
      },
    },
    providerConfig: {},
    runId: run.runId,
  });
}

function retryPromptForRun(run: { prompt?: string }): string | undefined {
  const prompt = run.prompt?.trim();
  if (!prompt) return undefined;
  if (!prompt.includes(IMAGE_CONFIRM_MARKER)) return prompt;

  const promptLine = prompt
    .split(/\r?\n/)
    .find((line) => line.trim().toLowerCase().startsWith("prompt:"));
  const extracted = promptLine?.replace(/^prompt:\s*/i, "").trim();
  return extracted || undefined;
}

export async function DELETE(req: Request, ctx: RunRouteContext) {
  registerAllJobHandlers();
  const { runId } = await ctx.params;
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId") ?? undefined;

  if (!projectId) {
    return Response.json({ error: "missing_project_id" }, { status: 400 });
  }

  const memoryRun = agentRuns.getRun(runId);
  const run = memoryRun ?? await loadRun(projectId, runId);
  if (!run || run.projectId !== projectId) {
    return Response.json({ error: "run_not_found", runId }, { status: 404 });
  }

  if (memoryRun) {
    agentRuns.cancel(runId);
  } else if (
    run.status === "accepted" ||
    run.status === "running" ||
    run.status === "waiting_user" ||
    run.status === "cancelling" ||
    run.status === "interrupted"
  ) {
    run.status = "cancelled";
    run.endedAt = Date.now();
    run.lastHeartbeatAt = Date.now();
    run.error = run.error ?? "Cancelled from run history";
    await saveRun(projectId, run);
  }

  let cancelledJobs = 0;
  for (const job of jobScheduler.listJobs({ projectId, runId })) {
    if (job.status === "pending" || job.status === "running") {
      jobScheduler.cancel(job.id);
      cancelledJobs++;
    }
  }
  const snapshots = await listJobSnapshots({ projectId, runId });
  for (const job of snapshots) {
    if (job.status === "pending" || job.status === "running") {
      await markJobSnapshotCancelled(projectId, job.id);
      cancelledJobs++;
    }
  }

  return Response.json({
    runId,
    cancelled: true,
    status: agentRuns.getRun(runId)?.status ?? run.status,
    cancelledJobs,
  });
}

export async function POST(req: Request, ctx: RunRouteContext) {
  registerAllJobHandlers();
  const { runId } = await ctx.params;
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId") ?? undefined;

  if (!projectId) {
    return Response.json({ error: "missing_project_id" }, { status: 400 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const body = json && typeof json === "object" ? json as Record<string, unknown> : {};
  const approvalId = typeof body.approvalId === "string" ? body.approvalId : undefined;
  const providerConfig = body.providerConfig as ProviderConfig | undefined;
  const toolArgs = isRecord(body.toolArgs) ? body.toolArgs : undefined;
  if (!approvalId) {
    return Response.json({ error: "missing_approval_id" }, { status: 400 });
  }

  const loadedRun = agentRuns.getRun(runId) ?? await loadRun(projectId, runId);
  const run = loadedRun ? agentRuns.hydrateRun(loadedRun) : undefined;
  if (!run || run.projectId !== projectId) {
    return Response.json({ error: "run_not_found", runId }, { status: 404 });
  }

  const project = await loadMergedProjectFromVad(projectId);
  const agentCtx = await buildAgentContext(providerConfig, project);
  agentCtx.threadId = run.threadId;

  const emit = (event: WsEvent) => {
    const seqEvent = eventBuffer.push(run.threadId, event);
    connectionManager.pushToCanvas(projectId, seqEvent);
    appendEvent(projectId, seqEvent).catch(() => undefined);
    return seqEvent;
  };

  try {
    for await (const event of agentRuns.resumeToolApproval(
      runId,
      {
        threadId: run.threadId,
        prompt: run.prompt ?? "",
        project,
        agentCtx,
        providerConfig: providerConfig ?? {},
      },
      approvalId,
      "approve",
      toolArgs
    )) {
      emit(event as WsEvent);
    }

    return Response.json({
      run,
      resumed: true,
    });
  } catch (err) {
    const message = (err as Error).message;
    emit({
      type: "run.failed",
      data: { runId, error: message, code: "TOOL_APPROVAL_FAILED", retryable: true },
    });
    return Response.json(
      { error: "tool_approval_failed", message },
      { status: 500 }
    );
  }
}

function eventBelongsToRun(event: { data: unknown }, runId: string): boolean {
  const data = event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : {};
  return data.runId === runId;
}

function toEventSummary(event: { type: string; data: unknown; seq?: number; at?: number }) {
  const data = event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : {};
  return {
    type: event.type,
    seq: event.seq,
    at: event.at,
    runId: stringValue(data.runId),
    toolCallId: stringValue(data.toolCallId),
    toolName: stringValue(data.toolName),
    riskLevel: toolRiskLevel(stringValue(data.toolName)),
    requiresConfirmation: toolRequiresConfirmation(stringValue(data.toolName)),
    jobId: stringValue(data.jobId),
    jobType: stringValue(data.jobType),
    progress: numberValue(data.progress),
    message: eventMessage(event.type, data),
    error: stringValue(data.error) ?? stringValue(data.message),
  };
}

function eventTime(event: { at?: number; seq?: number }): number {
  return event.at ?? event.seq ?? 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toJobSummary(job: unknown) {
  const data = job && typeof job === "object" ? job as Record<string, unknown> : {};
  const detail = data.progressDetail && typeof data.progressDetail === "object"
    ? data.progressDetail as Record<string, unknown>
    : undefined;
  return {
    id: stringValue(data.id),
    type: stringValue(data.type),
    status: stringValue(data.status),
    progress: numberValue(data.progress),
    stage: stringValue(detail?.stage),
    completed: numberValue(detail?.completed),
    failed: numberValue(detail?.failed),
    cancelled: numberValue(detail?.cancelled),
    total: numberValue(detail?.total),
    message: stringValue(detail?.message),
    error: stringValue(data.error),
    createdAt: numberValue(data.createdAt),
    startedAt: numberValue(data.startedAt),
    completedAt: numberValue(data.completedAt),
  };
}

function eventMessage(type: string, data: Record<string, unknown>): string | undefined {
  if (type === "llm.requested") {
    const provider = stringValue(data.provider) ?? "unknown";
    const model = stringValue(data.model);
    return model ? `${provider} / ${model}` : provider;
  }
  if (type === "llm.started") return "LLM request started";
  if (type === "llm.completed") return "LLM response completed";
  if (type === "llm.failed") return stringValue(data.error) ?? "LLM request failed";
  if (type === "agent.fallback") return stringValue(data.text) ?? "Fallback engine active";
  if (type === "tool.started") return stringValue(data.toolName) ?? "Tool started";
  if (type === "tool.completed") {
    return stringValue(data.outputSummary) ?? stringValue(data.toolName) ?? "Tool completed";
  }
  if (type.startsWith("job.")) {
    const detail = data.detail && typeof data.detail === "object" ? data.detail as Record<string, unknown> : {};
    return stringValue(detail.message) ?? stringValue(data.jobType) ?? type;
  }
  if (type === "run.waiting_user") return stringValue(data.reason) ?? "Waiting for user";
  return stringValue(data.message) ?? stringValue(data.text);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

async function buildAgentContext(
  providerConfig?: ProviderConfig,
  project?: ProjectFile | null
): Promise<AgentContext> {
  const { skill, designSystem } = await resolveSkillContext(providerConfig, project);
  const scratch: Record<string, unknown> = {};
  injectProviderScratch(scratch, providerConfig);
  return {
    projectId: project?.id ?? "unknown-project",
    scratch,
    providers: resolveProviders(providerConfig),
    skill,
    designSystem,
  };
}
