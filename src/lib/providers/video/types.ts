/**
 * Video Provider 抽象
 * --------------------------------------------------------------
 * 视频生成 Provider 接口定义。
 * 支持异步生成模式：提交 → 轮询 → 获取结果。
 */

export interface VideoGenerateInput {
  prompt: string;
  /** 视频时长（秒），默认 5 */
  duration?: number;
  /** 分辨率宽度，默认 1280 */
  width?: number;
  /** 分辨率高度，默认 720 */
  height?: number;
  /** 帧率，默认 24 */
  fps?: number;
  /** 参考图片（base64 或 URL） */
  referenceImages?: string[];
  /** 风格描述 */
  style?: string;
}

export interface VideoGenerateOutput {
  videoUrl: string;
  model: string;
  duration?: number;
  width?: number;
  height?: number;
  cost?: number;
  durationMs?: number;
  thumbnailUrl?: string;
}

export interface VideoProvider {
  name: string;
  /** 同步生成（可能耗时较长） */
  generateVideo(input: VideoGenerateInput): Promise<VideoGenerateOutput>;
  /** 异步提交，返回 jobId */
  submitVideoJob(input: VideoGenerateInput): Promise<{ jobId: string }>;
  /** 查询 Job 状态 */
  getJobStatus(jobId: string): Promise<VideoJobStatus>;
  /** 取消 Job */
  cancelJob(jobId: string): Promise<void>;
}

export interface VideoJobStatus {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress?: number;
  result?: VideoGenerateOutput;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
