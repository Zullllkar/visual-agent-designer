/**
 * 内联模式 SSE 流（Next.js 进程内 watch）
 * --------------------------------------------------------------
 * @author：wangjunhua
 */

import {
  vadProjectWatcher,
  formatWatchSse,
} from "@/lib/vad/project-watcher";

export function createInlineWatchResponse(
  projectId: string,
  signal?: AbortSignal
): Response {
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(
        encoder.encode(`: connected inline project=${projectId}\n\n`)
      );

      unsubscribe = vadProjectWatcher.subscribe(projectId, (ev) => {
        controller.enqueue(encoder.encode(formatWatchSse(ev)));
      });

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          /* stream closed */
        }
      }, 25_000);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
    },
  });

  if (signal) {
    signal.addEventListener("abort", () => {
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
    });
  }

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
