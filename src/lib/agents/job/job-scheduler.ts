/**
 * JobScheduler
 * --------------------------------------------------------------
 * 管理异步 Job 的生命周期：提交、执行、取消、查询。
 * 支持注册不同类型的 Job handler。
 */

import "server-only";

import { nanoid } from "nanoid";
import type {
  Job,
  JobEvent,
  JobHandler,
  JobStatus,
  JobType,
  SubmitJobInput,
} from "./job-types";
import { saveJobSnapshot } from "./job-persist";
import { listJobSnapshots, loadJobSnapshot, markJobSnapshotCancelled } from "./job-persist";
import { loadMergedProjectFromVad } from "@/lib/vad/storage";
import { bindGenerationProject } from "@/lib/generation/ledger-context";

type JobListener = (event: JobEvent) => void;

class JobScheduler {
  private jobs = new Map<string, Job>();
  private handlers = new Map<JobType, JobHandler>();
  private abortControllers = new Map<string, AbortController>();
  private listeners = new Set<JobListener>();
  private concurrency = 3;
  private runningCount = 0;
  private queue: string[] = [];

  /** Requeue recoverable jobs after a process restart. Safe to call repeatedly. */
  async recoverProjectJobs(projectId: string): Promise<number> {
    const snapshots = await listJobSnapshots({ projectId });
    let recovered = 0;
    for (const snapshot of snapshots) {
      if (snapshot.status !== "pending" && snapshot.status !== "running") continue;
      if (this.jobs.has(snapshot.id)) continue;
      const full = await loadJobSnapshot(projectId, snapshot.id);
      if (!full?.recoverablePayload) {
        await markJobSnapshotCancelled(projectId, snapshot.id);
        continue;
      }
      const project = await loadMergedProjectFromVad(projectId).catch(() => null);
      if (!project) continue;
      const recoverable = full.recoverablePayload;
      const pendingAssetIds = new Set(
        Array.isArray(recoverable.pendingAssetIds)
          ? recoverable.pendingAssetIds.filter((id): id is string => typeof id === "string")
          : [],
      );
      const pendingAssets = (project.assets ?? []).filter((asset) =>
        asset.status === "generating" && (pendingAssetIds.size === 0 || pendingAssetIds.has(asset.id)),
      );
      const job: Job = {
        ...snapshot,
        status: "pending",
        payload: {
          project,
          providerConfig: recoverable.providerConfig,
          request: recoverable.request,
          pendingAssets,
        },
        startedAt: undefined,
        completedAt: undefined,
        error: undefined,
      };
      this.jobs.set(job.id, job);
      this.queue.push(job.id);
      this.persist(job);
      this.emit({ type: "job.queued", data: { ...this.eventBase(job), progress: job.progress ?? 0, detail: { ...(job.progressDetail ?? { stage: "queued", completed: 0, failed: 0, total: pendingAssets.length }), message: "应用重启后已恢复" } } });
      recovered++;
    }
    this.tryRunNext();
    return recovered;
  }

  /** 注册 Job 处理器 */
  registerHandler(type: JobType, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }

  /** 监听 Job 事件 */
  onEvent(listener: JobListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 提交一个 Job */
  submit(input: SubmitJobInput): Job {
    const job: Job = {
      id: nanoid(12),
      type: input.type,
      status: "pending",
      payload: input.payload,
      createdAt: Date.now(),
      runId: input.runId,
      turnId: input.turnId ?? (typeof input.payload.turnId === "string" ? input.payload.turnId : undefined),
      batchId:
        input.batchId ??
        (typeof input.payload.batchId === "string" ? input.payload.batchId : undefined) ??
        (Array.isArray(input.payload.pendingAssets)
          ? (input.payload.pendingAssets[0] as { batchId?: string } | undefined)?.batchId
          : undefined),
      projectId: input.projectId,
      threadId: input.threadId,
      toolCallId: input.toolCallId,
      progress: 0,
      progressDetail: {
        stage: "queued",
        completed: 0,
        failed: 0,
        total: inferJobTotal(input.payload),
        message: "等待执行",
      },
      phase: input.phase,
    };
    this.jobs.set(job.id, job);
    this.queue.push(job.id);
    this.persist(job);
    this.emit({
      type: "job.queued",
      data: { ...this.eventBase(job), progress: 0, detail: job.progressDetail },
    });
    this.tryRunNext();
    return job;
  }

  /** 获取 Job 状态 */
  getJob(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }

  /** 取消 Job */
  cancel(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    if (job.status === "pending") {
      job.status = "cancelled";
      job.completedAt = Date.now();
      this.queue = this.queue.filter((id) => id !== jobId);
      this.persist(job);
      this.emit({
        type: "job.cancelled",
        data: { ...this.eventBase(job), progress: job.progress ?? 0 },
      });
      return;
    }
    if (job.status === "running") {
      this.abortControllers.get(jobId)?.abort();
    }
  }

  /** 获取所有 Job */
  listJobs(filter?: { runId?: string; turnId?: string; projectId?: string; status?: JobStatus }): Job[] {
    let result = Array.from(this.jobs.values());
    if (filter?.runId) result = result.filter((j) => j.runId === filter.runId);
    if (filter?.turnId) result = result.filter((j) => j.turnId === filter.turnId);
    if (filter?.projectId) result = result.filter((j) => j.projectId === filter.projectId);
    if (filter?.status) result = result.filter((j) => j.status === filter.status);
    return result.sort((a, b) => a.createdAt - b.createdAt);
  }

  private tryRunNext(): void {
    while (this.runningCount < this.concurrency && this.queue.length > 0) {
      const jobId = this.queue.shift();
      if (!jobId) break;
      const job = this.jobs.get(jobId);
      if (!job || job.status !== "pending") continue;
      this.executeJob(job).catch((e) => {
        console.error(`[JobScheduler] Job ${jobId} unhandled error:`, e);
      });
    }
  }

  private async executeJob(job: Job): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      job.status = "failed";
      job.error = `没有注册 ${job.type} 类型的处理器`;
      job.completedAt = Date.now();
      this.persist(job);
      this.emit({
        type: "job.failed",
        data: { ...this.eventBase(job), error: job.error },
      });
      return;
    }

    const abortController = new AbortController();
    this.abortControllers.set(job.id, abortController);
    job.status = "running";
    job.startedAt = Date.now();
    this.runningCount++;
    this.persist(job);
    this.emit({
      type: "job.started",
      data: { ...this.eventBase(job), progress: job.progress ?? 0, detail: job.progressDetail },
    });

    try {
      bindGenerationProject(job.projectId);
      const result = await handler(job, {
        signal: abortController.signal,
        reportProgress: (detail) => this.reportProgress(job, detail),
      });
      if (abortController.signal.aborted) {
        throw abortError();
      }
      job.status = "completed";
      job.progress = 100;
      job.result = result;
      job.completedAt = Date.now();
      this.persist(job);
      this.emit({
        type: "job.completed",
        data: { ...this.eventBase(job), progress: 100, result },
      });
    } catch (e) {
      if (abortController.signal.aborted) {
        job.status = "cancelled";
        job.completedAt = Date.now();
        this.persist(job);
        this.emit({
          type: "job.cancelled",
          data: { ...this.eventBase(job), progress: job.progress ?? 0 },
        });
      } else {
        job.status = "failed";
        job.error = (e as Error).message;
        job.completedAt = Date.now();
        this.persist(job);
        this.emit({
          type: "job.failed",
          data: { ...this.eventBase(job), error: job.error },
        });
      }
      job.completedAt = job.completedAt ?? Date.now();
    } finally {
      this.abortControllers.delete(job.id);
      this.runningCount--;
      this.tryRunNext();
    }
  }

  private reportProgress(job: Job, detail: Job["progressDetail"]): void {
    if (!detail || job.status !== "running") return;
    const finished = detail.completed + detail.failed;
    const progress = detail.total > 0
      ? Math.min(99, Math.round((finished / detail.total) * 100))
      : 0;
    job.progress = progress;
    job.progressDetail = detail;
    this.persist(job);
    this.emit({
      type: "job.progress",
      data: { ...this.eventBase(job), progress, detail },
    });
  }

  private eventBase(job: Job) {
    const pendingAssets = job.payload.pendingAssets;
    const pendingBatchId = Array.isArray(pendingAssets)
      ? (pendingAssets[0] as { batchId?: unknown } | undefined)?.batchId
      : undefined;
    const batchId =
      typeof job.payload.batchId === "string" ? job.payload.batchId : pendingBatchId;
    const assetId =
      typeof job.payload.mockupAssetId === "string"
        ? job.payload.mockupAssetId
        : typeof job.payload.assetId === "string"
          ? job.payload.assetId
          : undefined;
    return {
      jobId: job.id,
      jobType: job.type,
      batchId: job.batchId ?? (typeof batchId === "string" ? batchId : undefined),
      projectId: job.projectId,
      runId: job.runId,
      turnId: job.turnId,
      threadId: job.threadId,
      toolCallId: job.toolCallId,
      assetId,
    };
  }

  private emit(event: JobEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        console.error("[JobScheduler] listener error:", e);
      }
    }
  }

  private persist(job: Job): void {
    saveJobSnapshot(job).catch(() => {});
  }
}

export const jobScheduler = new JobScheduler();

export function inferJobTotal(payload: Record<string, unknown>): number {
  const pendingAssets = payload.pendingAssets;
  if (Array.isArray(pendingAssets) && pendingAssets.length > 0) {
    return pendingAssets.length;
  }
  const slotIds = payload.slotIds;
  if (Array.isArray(slotIds) && slotIds.length > 0) {
    return slotIds.length;
  }
  const request = payload.request;
  const requestCount =
    request && typeof request === "object"
      ? Number((request as { count?: unknown }).count ?? 0)
      : 0;
  const value = Number(payload.count ?? payload.total ?? requestCount);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function abortError(): Error {
  const error = new Error("Job cancelled");
  error.name = "AbortError";
  return error;
}
