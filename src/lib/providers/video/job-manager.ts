/**
 * Async Job System
 * --------------------------------------------------------------
 * 统一的异步任务管理：图像/视频生成等耗时操作提交为 Job，
 * 支持状态查询、进度推送和取消。
 */

import type { VideoJobStatus, VideoProvider } from "./types";

export type JobType = "video" | "image_batch" | "custom";
export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface JobRecord {
  jobId: string;
  type: JobType;
  status: JobStatus;
  progress: number;
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
  projectId?: string;
}

type ProgressCallback = (job: JobRecord) => void;

class JobManager {
  private jobs = new Map<string, JobRecord>();
  private progressCallbacks = new Map<string, Set<ProgressCallback>>();
  private counter = 0;

  createJob(type: JobType, projectId?: string): string {
    this.counter++;
    const jobId = `job-${type}-${Date.now()}-${this.counter}`;
    const now = new Date().toISOString();
    const record: JobRecord = {
      jobId,
      type,
      status: "queued",
      progress: 0,
      createdAt: now,
      updatedAt: now,
      projectId,
    };
    this.jobs.set(jobId, record);
    return jobId;
  }

  getJob(jobId: string): JobRecord | undefined {
    return this.jobs.get(jobId);
  }

  updateJob(jobId: string, update: Partial<JobRecord>): JobRecord | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;
    const updated: JobRecord = {
      ...job,
      ...update,
      updatedAt: new Date().toISOString(),
    };
    this.jobs.set(jobId, updated);
    this.notifyProgress(jobId, updated);
    return updated;
  }

  cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.status === "completed" || job.status === "failed") return false;
    this.updateJob(jobId, { status: "cancelled", progress: 0 });
    return true;
  }

  onProgress(jobId: string, cb: ProgressCallback): () => void {
    let set = this.progressCallbacks.get(jobId);
    if (!set) {
      set = new Set();
      this.progressCallbacks.set(jobId, set);
    }
    set.add(cb);
    return () => set!.delete(cb);
  }

  private notifyProgress(jobId: string, job: JobRecord): void {
    const cbs = this.progressCallbacks.get(jobId);
    if (cbs) cbs.forEach((cb) => cb(job));
  }

  listJobs(projectId?: string): JobRecord[] {
    const all = Array.from(this.jobs.values());
    if (projectId) return all.filter((j) => j.projectId === projectId);
    return all;
  }

  cleanup(maxAgeMs: number = 30 * 60 * 1000): void {
    const now = Date.now();
    for (const [jobId, job] of this.jobs) {
      if (now - new Date(job.updatedAt).getTime() > maxAgeMs) {
        this.jobs.delete(jobId);
        this.progressCallbacks.delete(jobId);
      }
    }
  }

  /** 提交视频生成 Job 并自动跟踪状态 */
  async submitVideoJob(
    provider: VideoProvider,
    input: Parameters<VideoProvider["submitVideoJob"]>[0],
    projectId?: string
  ): Promise<string> {
    const jobId = this.createJob("video", projectId);
    this.updateJob(jobId, { status: "running", progress: 10 });

    try {
      const { jobId: providerJobId } = await provider.submitVideoJob(input);
      this.updateJob(jobId, { progress: 20 });

      const pollInterval = setInterval(async () => {
        try {
          const status = await provider.getJobStatus(providerJobId);
          if (status.status === "completed") {
            clearInterval(pollInterval);
            this.updateJob(jobId, {
              status: "completed",
              progress: 100,
              result: status.result,
            });
          } else if (status.status === "failed") {
            clearInterval(pollInterval);
            this.updateJob(jobId, {
              status: "failed",
              error: status.error ?? "视频生成失败",
            });
          } else if (status.status === "cancelled") {
            clearInterval(pollInterval);
            this.updateJob(jobId, { status: "cancelled" });
          } else {
            this.updateJob(jobId, {
              progress: Math.max(20, status.progress ?? 50),
            });
          }
        } catch {
          // 轮询失败，继续重试
        }
      }, 2000);

      setTimeout(() => clearInterval(pollInterval), 120000);
    } catch (e) {
      this.updateJob(jobId, {
        status: "failed",
        error: (e as Error).message,
      });
    }

    return jobId;
  }
}

export const jobManager = new JobManager();
