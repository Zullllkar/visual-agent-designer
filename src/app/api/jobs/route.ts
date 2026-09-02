import { registerAllJobHandlers } from "@/lib/agents/job/job-handlers";
import { jobScheduler } from "@/lib/agents/job/job-scheduler";
import { listJobSnapshots } from "@/lib/agents/job/job-persist";
import { toClientJob } from "@/lib/agents/job/to-client-job";

export async function GET(req: Request) {
  registerAllJobHandlers();
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId") ?? undefined;
  const runId = url.searchParams.get("runId") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  const filter = {
    projectId,
    runId,
    status: isJobStatus(status) ? status : undefined,
  };
  const memoryJobs = jobScheduler.listJobs(filter);
  const snapshots = await listJobSnapshots(filter);
  const byId = new Map<string, unknown>();
  for (const job of snapshots) byId.set(job.id, job);
  for (const job of memoryJobs) byId.set(job.id, job);
  const jobs = [...byId.values()]
    .map((job) => toClientJob(job as Record<string, unknown>))
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  return Response.json({ jobs });
}

function isJobStatus(
  value: string | undefined
): value is "pending" | "running" | "completed" | "failed" | "cancelled" {
  return (
    value === "pending" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  );
}
