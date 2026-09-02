/**
 * generate_video 工具
 * --------------------------------------------------------------
 * Agent 可生成视频片段，支持异步 Job 模式。
 * 通过 WebSocket 向客户端推送进度更新。
 */

import type { AgentTool, ToolContext, ToolResult } from "./types";
import { mockVideoProvider } from "@/lib/providers/video/mock";
import { jobManager } from "@/lib/providers/video/job-manager";
import type { VideoGenerateInput } from "@/lib/providers/video/types";

export const generateVideoTool: AgentTool = {
  name: "generate_video",
  description:
    "生成视频片段，支持指定时长、分辨率和风格。异步执行，返回 jobId 供进度查询。",
  inputPhase: ["GENERATION", "REVIEW"],
  outputPhase: "GENERATION",
  riskLevel: "moderate",
  requiresConfirmation: true,
  timeoutMs: 300_000,
  parameters: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "视频生成提示词" },
      duration: { type: "number", description: "视频时长（秒），默认 5" },
      width: { type: "number", description: "分辨率宽度，默认 1280" },
      height: { type: "number", description: "分辨率高度，默认 720" },
      fps: { type: "number", description: "帧率，默认 24" },
      style: { type: "string", description: "风格描述" },
      referenceImages: {
        type: "array",
        items: { type: "string" },
        description: "参考图片 URL 列表",
      },
      mode: {
        type: "string",
        enum: ["sync", "async"],
        description: "生成模式：sync 同步等待，async 异步返回 jobId（默认 async）",
      },
    },
    required: ["prompt"],
  },

  async execute(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    const prompt = args.prompt as string;
    if (!prompt) throw new Error("generate_video 需要 prompt 参数");

    const input: VideoGenerateInput = {
      prompt,
      duration: (args.duration as number) ?? 5,
      width: (args.width as number) ?? 1280,
      height: (args.height as number) ?? 720,
      fps: (args.fps as number) ?? 24,
      style: args.style as string | undefined,
      referenceImages: args.referenceImages as string[] | undefined,
    };

    const mode = (args.mode as string) ?? "async";

    if (mode === "sync") {
      const result = await mockVideoProvider.generateVideo(input);
      return {
        summary: `视频生成完成: ${result.width}x${result.height}, ${result.duration}s`,
        data: {
          videoUrl: result.videoUrl,
          thumbnailUrl: result.thumbnailUrl,
          model: result.model,
          duration: result.duration,
          width: result.width,
          height: result.height,
        },
        artifacts: [
          {
            type: "video" as const,
            title: prompt.slice(0, 50),
            url: result.videoUrl,
            mimeType: "video/mp4",
            width: result.width ?? 1280,
            height: result.height ?? 720,
            durationSeconds: result.duration,
          },
        ],
      };
    }

    const jobId = await jobManager.submitVideoJob(
      mockVideoProvider,
      input,
      ctx.agentCtx.projectId
    );

    return {
      summary: `视频生成 Job 已提交: ${jobId}，提示词: "${prompt.slice(0, 40)}..."`,
      data: {
        jobId,
        status: "queued",
        prompt,
        estimatedDuration: input.duration,
        resolution: `${input.width}x${input.height}`,
      },
    };
  },

  async fallback(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    return this.execute(args, ctx);
  },
};
