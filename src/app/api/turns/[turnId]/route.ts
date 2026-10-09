import { agentRuns } from "@/lib/agents/agent-run-service";
import { buildTurnSnapshot } from "@/lib/agents/turn-service";
import { jobScheduler } from "@/lib/agents/job/job-scheduler";
import { listJobSnapshots } from "@/lib/agents/job/job-persist";
import { listRuns as listRunSnapshots } from "@/lib/agents/run-persist";

type RouteContext = { params: Promise<{ turnId: string }> };

/** Unified status for one user request: Run + tool-created background Jobs. */
export async function GET(req: Request, ctx: RouteContext) {
  const { turnId } = await ctx.params;
  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!projectId) return Response.json({ error: "missing_project_id" }, { status: 400 });

  const runs = [
    ...(await listRunSnapshots(projectId)),
    ...agentRuns.listRuns(projectId),
  ];
  const run = runs
    .filter((candidate) => candidate.turnId === turnId)
    .sort((a, b) => b.startedAt - a.startedAt)[0];
  const memoryJobs = jobScheduler.listJobs({ projectId, turnId });
  const snapshots = await listJobSnapshots({ projectId });
  const jobs = [
    ...snapshots.filter((job) => job.turnId === turnId),
    ...memoryJobs,
  ];
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const snapshot = buildTurnSnapshot({
    turnId,
    projectId,
    run,
    jobs: [...byId.values()].map((job) => ({
      id: job.id,
      type: job.type,
      status: job.status,
      progress: job.progress,
      error: job.error,
    })),
  });
  return Response.json(snapshot);
}
