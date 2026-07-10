/**
 * POST /api/agents/generate/stream
 * --------------------------------------------------------------
 * SSE 流式返回流水线日志 + 最终 ProjectFile。
 *
 * event: log       → PipelineLogEntry
 * event: code_diff → 页面 JSON 变更预览
 * event: progress  → { stage, detail? }
 * event: project_snapshot → { project }  （布局 / 生图占位 / 每张完成）
 * event: final_project → { project }
 * event: error     → { message }
 * event: done      → { reason }
 *
 * @author：wangjunhua
 */

import { z } from "zod";
import { generateProjectFromIdea } from "@/lib/agents/orchestrator";
import { ProviderConfigSchema } from "@/lib/providers/config-schema";
import { ProviderRequiredError } from "@/lib/providers/validate";
import {
  PipelineLogger,
  type PipelineLogEntry,
} from "@/lib/agents/pipeline-logger";
import type { PipelineProgress } from "@/lib/agents/design-pipeline";
import { appendPipelineLogEntry } from "@/lib/vad/pipeline-log-persist";
import { loadProjectFromVad } from "@/lib/vad/persist";
import { nanoid } from "nanoid";

const InputSchema = z.object({
  idea: z.string().min(2).max(500),
  providerConfig: ProviderConfigSchema,
  /** 首页预分配的项目 id（与占位 project 一致） */
  projectId: z.string().min(4).max(32).optional(),
});

function encode(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = InputSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_input", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const projectId = parsed.data.projectId ?? nanoid(10);
  const runId = nanoid(8);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(encode(event, data)));
      };

      const logger = new PipelineLogger({
        runId,
        projectId,
        source: "generate",
        idea: parsed.data.idea,
        onEntry: (entry: PipelineLogEntry) => {
          push("log", entry);
          void appendPipelineLogEntry(projectId, entry, {
            runId,
            source: "generate",
          }).catch(() => {});
        },
      });

      try {
        const existing = await loadProjectFromVad(projectId).catch(() => null);

        const project = await generateProjectFromIdea(parsed.data.idea, {
          providerConfig: parsed.data.providerConfig,
          projectId,
          existing,
          logger,
          onProgress: (p: PipelineProgress) => push("progress", p),
          onCodeDiff: (diff) => push("code_diff", diff),
          onProjectSnapshot: (snap) => push("project_snapshot", { project: snap }),
        });

        push("final_project", { project });
        push("done", { reason: "complete", projectId: project.id, runId });
      } catch (err) {
        if (err instanceof ProviderRequiredError) {
          push("error", { message: err.message, code: err.code });
        } else {
          push("error", {
            message: (err as Error).message,
            code: "agent_failed",
          });
        }
        push("done", { reason: "error", runId });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
