/**
 * Queue 注册
 * --------------------------------------------------------------
 * 注册默认任务队列和处理器。
 * 图像生成队列：批量图像生成任务
 * 视频生成队列：异步视频生成任务
 */

import { taskQueue } from "./task-queue";
import { mockVideoProvider } from "@/lib/providers/video/mock";
import type { VideoGenerateInput } from "@/lib/providers/video/types";

export function registerDefaultQueues(): void {
  // ── 图像生成队列 ──────────────────────────────────────────────
  taskQueue.registerQueue(
    "image-generation",
    async (task) => {
      const { prompt, width, height } = task.payload as {
        prompt: string;
        width: number;
        height: number;
      };
      // 实际调用图像 provider，这里返回占位
      return { prompt, width, height, status: "done" };
    },
    { maxAttempts: 2, timeoutMs: 120_000, concurrency: 2 }
  );

  // ── 视频生成队列 ──────────────────────────────────────────────
  taskQueue.registerQueue(
    "video-generation",
    async (task) => {
      const input = task.payload as VideoGenerateInput;
      const result = await mockVideoProvider.generateVideo(input);
      return result;
    },
    { maxAttempts: 1, timeoutMs: 180_000, concurrency: 1 }
  );

  // ── Handoff 导出队列 ──────────────────────────────────────────
  taskQueue.registerQueue(
    "handoff-export",
    async (task) => {
      const { projectId, target } = task.payload as {
        projectId: string;
        target: string;
      };
      return { projectId, target, status: "exported" };
    },
    { maxAttempts: 3, timeoutMs: 60_000, concurrency: 1 }
  );
}

export { taskQueue };
