/**
 * Replicate Video Provider
 * --------------------------------------------------------------
 * 通过 Replicate API 生成视频，支持异步 Job 模式。
 * 需要环境变量 REPLICATE_API_KEY。
 */

import type {
  VideoGenerateInput,
  VideoGenerateOutput,
  VideoJobStatus,
  VideoProvider,
} from "./types";

interface ReplicatePrediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output: string | string[];
  error: string | null;
  urls: { get: string; cancel: string };
  created_at: string;
  completed_at: string | null;
}

export class ReplicateVideoProvider implements VideoProvider {
  name = "replicate-video";
  private apiKey: string;
  private model: string;
  private baseURL: string;

  constructor(opts: { apiKey: string; model: string; baseURL?: string }) {
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.baseURL = opts.baseURL ?? "https://api.replicate.com/v1";
  }

  async generateVideo(input: VideoGenerateInput): Promise<VideoGenerateOutput> {
    const prediction = await this.submitPrediction(input);
    const result = await this.pollPrediction(prediction.id, 180_000);
    return this.toOutput(result, input);
  }

  async submitVideoJob(input: VideoGenerateInput): Promise<{ jobId: string }> {
    const prediction = await this.submitPrediction(input);
    return { jobId: prediction.id };
  }

  async getJobStatus(jobId: string): Promise<VideoJobStatus> {
    const prediction = await this.getPrediction(jobId);
    const now = new Date().toISOString();

    switch (prediction.status) {
      case "starting":
        return { jobId, status: "queued", progress: 0, createdAt: prediction.created_at, updatedAt: now };
      case "processing":
        return { jobId, status: "running", progress: 50, createdAt: prediction.created_at, updatedAt: now };
      case "succeeded":
        return {
          jobId,
          status: "completed",
          progress: 100,
          createdAt: prediction.created_at,
          updatedAt: prediction.completed_at ?? now,
          result: this.outputFromPrediction(prediction, undefined),
        };
      case "failed":
        return {
          jobId,
          status: "failed",
          progress: 0,
          createdAt: prediction.created_at,
          updatedAt: prediction.completed_at ?? now,
          error: prediction.error ?? "生成失败",
        };
      case "canceled":
        return { jobId, status: "cancelled", progress: 0, createdAt: prediction.created_at, updatedAt: now };
      default:
        return { jobId, status: "queued", progress: 0, createdAt: prediction.created_at, updatedAt: now };
    }
  }

  async cancelJob(jobId: string): Promise<void> {
    try {
      await fetch(`${this.baseURL}/predictions/${jobId}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
    } catch {
      // 取消失败忽略
    }
  }

  private async submitPrediction(input: VideoGenerateInput): Promise<ReplicatePrediction> {
    const res = await fetch(`${this.baseURL}/predictions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Prefer: "wait=1",
      },
      body: JSON.stringify({
        version: this.model,
        input: {
          prompt: input.prompt,
          ...(input.duration ? { duration: input.duration } : {}),
          ...(input.width && input.height ? { width: input.width, height: input.height } : {}),
          ...(input.fps ? { fps: input.fps } : {}),
          ...(input.style ? { style: input.style } : {}),
        },
      }),
    });
    if (!res.ok) throw new Error(`Replicate submit failed: ${res.status}`);
    return res.json();
  }

  private async getPrediction(id: string): Promise<ReplicatePrediction> {
    const res = await fetch(`${this.baseURL}/predictions/${id}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) throw new Error(`Replicate get failed: ${res.status}`);
    return res.json();
  }

  private async pollPrediction(id: string, timeoutMs: number): Promise<ReplicatePrediction> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const prediction = await this.getPrediction(id);
      if (prediction.status === "succeeded") return prediction;
      if (prediction.status === "failed" || prediction.status === "canceled") {
        throw new Error(prediction.error ?? `Prediction ${prediction.status}`);
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error("Prediction timeout");
  }

  private outputFromPrediction(
    prediction: ReplicatePrediction,
    input?: VideoGenerateInput
  ): VideoGenerateOutput {
    const videoUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    return {
      videoUrl,
      model: this.model,
      duration: input?.duration ?? 5,
      width: input?.width ?? 1280,
      height: input?.height ?? 720,
      durationMs: prediction.completed_at
        ? new Date(prediction.completed_at).getTime() - new Date(prediction.created_at).getTime()
        : 0,
    };
  }

  private toOutput(prediction: ReplicatePrediction, input: VideoGenerateInput): VideoGenerateOutput {
    return this.outputFromPrediction(prediction, input);
  }
}
