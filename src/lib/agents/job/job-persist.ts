import "server-only";

import { promises as fs } from "node:fs";

import type { Job, JobStatus } from "./job-types";
import { ensureDir } from "@/lib/vad/persist";
import { jobJsonPath, jobsDir } from "@/lib/vad/paths";
import { slimJobResult, slimRecoverableRequest, summarizePayload } from "./to-client-job";

export type JobSnapshot = Omit<Job, "payload"> & {
  payloadSummary?: Record<string, unknown>;
  recoverablePayload?: Record<string, unknown>;
};

export async function saveJobSnapshot(job: Job): Promise<void> {
  if (!job.projectId) return;
  await ensureDir(jobsDir(job.projectId));
  const { payload: _payload, ...rest } = job;
  const snapshot: JobSnapshot = {
    ...rest,
    result: slimJobResult(job.result),
    payloadSummary: summarizePayload(job.payload),
    recoverablePayload: buildRecoverablePayload(job),
  };
  await fs.writeFile(
    jobJsonPath(job.projectId, job.id),
    JSON.stringify(snapshot, null, 2),
    "utf8"
  );
}

function buildRecoverablePayload(job: Job): Record<string, unknown> | undefined {
  if (job.type !== "direct_image_generation") return undefined;
  return {
    providerConfig: job.payload.providerConfig,
    request: slimRecoverableRequest(job.payload.request),
    pendingAssetIds: Array.isArray(job.payload.pendingAssets)
      ? job.payload.pendingAssets.map((asset) => (asset as { id?: unknown }).id).filter((id): id is string => typeof id === "string")
      : [],
  };
}

export async function listJobSnapshots(filter?: {
  projectId?: string;
  runId?: string;
  status?: JobStatus;
}): Promise<JobSnapshot[]> {
  if (!filter?.projectId) return [];
  const dir = jobsDir(filter.projectId);
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }

  const snapshots: JobSnapshot[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(`${dir}/${file}`, "utf8");
      const snapshot = JSON.parse(raw) as JobSnapshot;
      if (filter.runId && snapshot.runId !== filter.runId) continue;
      if (filter.status && snapshot.status !== filter.status) continue;
      delete snapshot.recoverablePayload;
      snapshots.push(snapshot);
    } catch {
      // Ignore corrupted snapshots.
    }
  }
  return snapshots.sort((a, b) => a.createdAt - b.createdAt);
}

export async function loadJobSnapshot(
  projectId: string | undefined,
  jobId: string
): Promise<JobSnapshot | null> {
  if (!projectId) return null;
  try {
    const raw = await fs.readFile(jobJsonPath(projectId, jobId), "utf8");
    return JSON.parse(raw) as JobSnapshot;
  } catch {
    return null;
  }
}

export async function markJobSnapshotCancelled(
  projectId: string | undefined,
  jobId: string
): Promise<JobSnapshot | null> {
  const snapshot = await loadJobSnapshot(projectId, jobId);
  if (!snapshot) return null;
  const next: JobSnapshot = {
    ...snapshot,
    status: "cancelled",
    progress: snapshot.progress ?? 0,
    completedAt: snapshot.completedAt ?? Date.now(),
    error: snapshot.error ?? "Cancelled",
  };
  await fs.writeFile(
    jobJsonPath(projectId!, jobId),
    JSON.stringify(next, null, 2),
    "utf8"
  );
  return next;
}
