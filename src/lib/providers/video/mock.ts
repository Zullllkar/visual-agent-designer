/**
 * Mock Video Provider
 * --------------------------------------------------------------
 * 用于开发和测试的视频生成 Mock 实现。
 * 异步 Job 模拟：提交后延迟返回占位视频。
 */

import type {
  VideoGenerateInput,
  VideoGenerateOutput,
  VideoJobStatus,
  VideoProvider,
} from "./types";

const JOB_TTL_MS = 10 * 60 * 1000;

class MockVideoProvider implements VideoProvider {
  name = "mock-video";
  private jobs = new Map<string, VideoJobStatus>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  async generateVideo(input: VideoGenerateInput): Promise<VideoGenerateOutput> {
    await new Promise((r) => setTimeout(r, 100));
    return this.makeOutput(input);
  }

  async submitVideoJob(input: VideoGenerateInput): Promise<{ jobId: string }> {
    const jobId = `mock-vjob-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const status: VideoJobStatus = {
      jobId,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(jobId, status);

    const timer = setTimeout(() => {
      const current = this.jobs.get(jobId);
      if (!current || current.status === "cancelled") return;
      const completed: VideoJobStatus = {
        ...current,
        status: "completed",
        progress: 100,
        result: this.makeOutput(input),
        updatedAt: new Date().toISOString(),
      };
      this.jobs.set(jobId, completed);
    }, 3000);
    this.timers.set(jobId, timer);

    setTimeout(() => {
      this.jobs.delete(jobId);
      this.timers.delete(jobId);
    }, JOB_TTL_MS);

    return { jobId };
  }

  async getJobStatus(jobId: string): Promise<VideoJobStatus> {
    const status = this.jobs.get(jobId);
    if (!status) throw new Error(`视频 Job ${jobId} 不存在`);
    if (status.status === "queued") {
      return { ...status, status: "running", progress: 50, updatedAt: new Date().toISOString() };
    }
    return status;
  }

  async cancelJob(jobId: string): Promise<void> {
    const timer = this.timers.get(jobId);
    if (timer) clearTimeout(timer);
    const status = this.jobs.get(jobId);
    if (status) {
      this.jobs.set(jobId, {
        ...status,
        status: "cancelled",
        updatedAt: new Date().toISOString(),
      });
    }
  }

  private makeOutput(input: VideoGenerateInput): VideoGenerateOutput {
    return {
      videoUrl: `data:video/mp4;base64,MOCK_VIDEO_DATA_${Date.now()}`,
      model: "mock-video-v1",
      duration: input.duration ?? 5,
      width: input.width ?? 1280,
      height: input.height ?? 720,
      durationMs: 3000,
      thumbnailUrl: `data:image/png;base64,MOCK_THUMBNAIL_${Date.now()}`,
    };
  }
}

export const mockVideoProvider = new MockVideoProvider();
