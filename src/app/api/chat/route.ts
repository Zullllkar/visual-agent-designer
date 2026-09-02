/**
 * POST /api/chat（SSE 兼容层）
 * --------------------------------------------------------------
 * 新架构优先走 WebSocket /ws，此 SSE 端点保留为兼容层。
 *
 * 优先使用 runChatTurnViaAgent（LangGraph Agent 模式），
 * 失败时自动回退到 runChatTurn（旧编排器）。
 */

import { z } from "zod";
import { runChatTurn, runChatTurnViaAgent } from "@/lib/agents/chat-orchestrator";
import { ChatMessageSchema } from "@/lib/agents/chat-schema";
import { ProjectFileSchema } from "@/lib/project/schema";
import type { ChatStreamEvent } from "@/lib/agents/chat-schema";
import { ProviderConfigSchema } from "@/lib/providers/config-schema";
import {
  assertRealLlmForAgents,
  ProviderRequiredError,
} from "@/lib/providers/validate";

const InputSchema = z.object({
  /** 当前完整项目；首次对话可为 null */
  project: ProjectFileSchema.nullable().optional(),
  /** 含本轮 user 消息的完整消息历史 */
  messages: z.array(ChatMessageSchema).min(1),
  providerConfig: ProviderConfigSchema,
});

/** 把 ChatStreamEvent 编码为 SSE 帧 */
function encodeEvent(ev: ChatStreamEvent): string {
  return `event: ${ev.type}\ndata: ${JSON.stringify(ev.data)}\n\n`;
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

  try {
    assertRealLlmForAgents(parsed.data.providerConfig);
  } catch (err) {
    if (err instanceof ProviderRequiredError) {
      return Response.json(
        { error: err.code, message: err.message },
        { status: 400 }
      );
    }
    throw err;
  }

  const encoder = new TextEncoder();
  const { events, resultPromise } = runChatTurnViaAgent({
    project: parsed.data.project ?? null,
    messages: parsed.data.messages,
    providerConfig: parsed.data.providerConfig,
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let lastDone: ChatStreamEvent | null = null;
        for await (const event of events) {
          // 截留 done 事件，等 final_project 推完再发，保证前端能"先收到 project 再收 done"
          if (event.type === "done") {
            lastDone = event;
            continue;
          }
          controller.enqueue(encoder.encode(encodeEvent(event)));
        }

        // 在 done 之前推送最终 project
        try {
          const { updatedProject } = await resultPromise;
          if (updatedProject) {
            controller.enqueue(
              encoder.encode(
                `event: final_project\ndata: ${JSON.stringify({
                  project: updatedProject,
                })}\n\n`
              )
            );
          }
        } catch {
          // 即使 resultPromise reject 也要正常关流
        }

        if (lastDone) {
          controller.enqueue(encoder.encode(encodeEvent(lastDone)));
        }
        controller.close();
      } catch (e) {
        controller.enqueue(
          encoder.encode(
            encodeEvent({ type: "error", data: { message: (e as Error).message } })
          )
        );
        controller.enqueue(
          encoder.encode(
            encodeEvent({ type: "done", data: { reason: "complete" } })
          )
        );
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
