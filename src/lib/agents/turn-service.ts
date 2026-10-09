import type { AgentRun, RunStatus } from "./agent-run-service";
import type { Job } from "./job/job-types";

export type TurnStatus = "accepted" | "running" | "waiting_user" | "completed" | "failed" | "cancelled" | "interrupted";

export interface TurnSnapshot {
  turnId: string;
  runId?: string;
  projectId: string;
  phase?: AgentRun["phase"];
  status: TurnStatus;
  runStatus?: RunStatus;
  jobs: Array<{
    id: string;
    type: string;
    status: Job["status"];
    progress: number;
    error?: string;
  }>;
  counts: { tools: number; jobs: number; completedJobs: number; failedJobs: number };
  canHandoff: boolean;
}

export type TurnJob = Pick<Job, "id" | "type" | "status" | "progress" | "error">;

export function buildTurnSnapshot(input: {
  turnId: string;
  projectId: string;
  run?: AgentRun | null;
  jobs?: TurnJob[];
  toolCount?: number;
}): TurnSnapshot {
  const jobs = input.jobs ?? [];
  const activeJob = jobs.some((job) => job.status === "pending" || job.status === "running");
  const failedJob = jobs.some((job) => job.status === "failed");
  const runStatus = input.run?.status;
  let status: TurnStatus = mapRunStatus(runStatus) ?? (activeJob ? "running" : "completed");
  if (runStatus === "completed" && activeJob) status = "running";
  if (runStatus === "completed" && failedJob) status = "failed";
  const canHandoff = status === "completed" && !failedJob;
  return {
    turnId: input.turnId,
    runId: input.run?.runId,
    projectId: input.projectId,
    phase: input.run?.phase,
    status,
    runStatus,
    jobs: jobs.map((job) => ({ id: job.id, type: job.type, status: job.status, progress: job.progress ?? 0, error: job.error })),
    counts: {
      tools: input.toolCount ?? 0,
      jobs: jobs.length,
      completedJobs: jobs.filter((job) => job.status === "completed").length,
      failedJobs: jobs.filter((job) => job.status === "failed").length,
    },
    canHandoff,
  };
}

function mapRunStatus(status?: RunStatus): TurnStatus | undefined {
  if (!status) return undefined;
  if (status === "cancelling") return "running";
  return status;
}
