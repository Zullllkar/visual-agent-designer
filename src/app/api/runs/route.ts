import { agentRuns, type AgentRun } from "@/lib/agents/agent-run-service";
import { phaseLabel } from "@/lib/agents/agent-phase";
import { IMAGE_CONFIRM_MARKER } from "@/lib/agents/image-generation-confirmation";
import { listRuns as listRunSnapshots } from "@/lib/agents/run-persist";
import { normalizeGenerateImagesApprovalArgs } from "@/lib/agents/tools/generate-images-approval";
import { loadMergedProjectFromVad } from "@/lib/vad/storage";
import type { ProjectFile } from "@/lib/project/schema";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId") ?? undefined;
  const limit = clampLimit(url.searchParams.get("limit"));

  if (!projectId) {
    return Response.json({ error: "missing_project_id" }, { status: 400 });
  }

  const snapshots = await listRunSnapshots(projectId);
  const memoryRuns = agentRuns.listRuns(projectId);
  const byId = new Map<string, AgentRun>();
  for (const run of snapshots) byId.set(run.runId, run);
  for (const run of memoryRuns) byId.set(run.runId, run);

  const runs = [...byId.values()]
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, limit);

  const needsProject = runs.some(
    (run) =>
      run.pendingToolApproval?.status === "pending" &&
      run.pendingToolApproval.toolName === "generate_images"
  );
  const project = needsProject
    ? await loadMergedProjectFromVad(projectId).catch(() => null)
    : null;

  return Response.json({
    runs: runs.map((run) => toRunSummary(run, undefined, project)),
  });
}

function clampLimit(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 12;
  return Math.max(1, Math.min(50, Math.trunc(parsed)));
}

type RunEventStats = {
  llmEvents: number;
  toolEvents: number;
  jobEvents: number;
  approvalEvents: number;
  lastSeq?: number;
  lastEventAt?: number;
};

function toRunSummary(run: AgentRun, stats?: RunEventStats, project?: ProjectFile | null) {
  const retryPrompt = retryPromptForRun(run);
  return {
    runId: run.runId,
    threadId: run.threadId,
    projectId: run.projectId,
    status: run.status,
    phase: run.phase,
    phaseLabel: phaseLabel(run.phase),
    currentStep: run.currentStep,
    promptSummary: run.promptSummary ?? summarizePrompt(run.prompt ?? ""),
    retryPrompt,
    retryInstruction: retryPrompt
      ? buildRetryInstruction(run, retryPrompt)
      : undefined,
    phaseRetryInstruction: buildPhaseRetryInstruction(run, retryPrompt),
    canRetry: Boolean(retryPrompt),
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    lastHeartbeatAt: run.lastHeartbeatAt,
    lastSeq: stats?.lastSeq,
    lastEventAt: stats?.lastEventAt,
    durationMs:
      (run.endedAt ?? stats?.lastEventAt ?? run.lastHeartbeatAt ?? Date.now()) -
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
    jobCount: run.jobIds.length,
    events: stats ?? {
      llmEvents: 0,
      toolEvents: 0,
      jobEvents: 0,
      approvalEvents: 0,
    },
  };
}

function sanitizePendingToolArgs(run: AgentRun, project?: ProjectFile | null): Record<string, unknown> {
  const pending = run.pendingToolApproval;
  if (!pending) return {};
  const args = pending.args ?? {};
  if (pending.toolName !== "generate_images") {
    return stripHeavyApprovalArgs(args);
  }
  if (!project) return stripHeavyApprovalArgs(args);
  return stripHeavyApprovalArgs(
    normalizeGenerateImagesApprovalArgs(args, {
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
    })
  );
}

function stripHeavyApprovalArgs(args: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (
      key === "referenceImages" ||
      key === "images" ||
      key === "src" ||
      key === "imageUrl" ||
      key === "b64_json"
    ) {
      next[`${key}Count`] = Array.isArray(value) ? value.length : 1;
      continue;
    }
    if (typeof value === "string" && (value.startsWith("data:") || value.length > 500)) {
      next[key] = `[omitted ${value.length} chars]`;
      continue;
    }
    next[key] = value;
  }
  return next;
}

function retryPromptForRun(run: AgentRun): string | undefined {
  const prompt = run.prompt?.trim();
  if (!prompt) return undefined;
  if (!prompt.includes(IMAGE_CONFIRM_MARKER)) return prompt;

  const promptLine = prompt
    .split(/\r?\n/)
    .find((line) => line.trim().toLowerCase().startsWith("prompt:"));
  const extracted = promptLine?.replace(/^prompt:\s*/i, "").trim();
  return extracted || undefined;
}

function buildRetryInstruction(run: AgentRun, prompt: string): string {
  return [
    `重试 Run ${run.runId}（阶段：${phaseLabel(run.phase)}，上次状态：${run.status}）。`,
    "请先重新评估当前项目状态和已有素材，不要重复生成无关内容。",
    "如果需要执行生图、修改画布、导出交付包等副作用，先给出明确确认卡片并等待我确认。",
    "",
    "原始任务：",
    prompt,
  ].join("\n");
}

function buildPhaseRetryInstruction(run: AgentRun, prompt?: string): string {
  return [
    `从阶段「${phaseLabel(run.phase)}」重新执行 Run ${run.runId} 的后续流程。`,
    "请先读取当前项目状态、已有 Brief、设计方向、画布和素材，不要假设旧状态仍然有效。",
    "只重做该阶段及后续必要步骤，不要无理由重写已经确认的上游内容。",
    "如果需要执行生图、修改画布、导出交付包、删除素材等副作用，先展示确认卡片并等待我确认。",
    prompt ? "" : undefined,
    prompt ? "原始任务：" : undefined,
    prompt,
  ]
    .filter((line): line is string => typeof line === "string")
    .join("\n");
}

function summarizePrompt(prompt: string): string | undefined {
  const oneLine = prompt.replace(/\s+/g, " ").trim();
  if (!oneLine) return undefined;
  if (oneLine.length <= 160) return oneLine;
  return `${oneLine.slice(0, 157)}...`;
}
