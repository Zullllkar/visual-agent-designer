/**
 * Daemon 侧项目 watch SSE
 * --------------------------------------------------------------
 * @author：wangjunhua
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { vadProjectWatcher, formatWatchSse } from "@/lib/vad/project-watcher";

const activeByProject = new Map<string, number>();

export function handleWatchSse(
  req: IncomingMessage,
  res: ServerResponse,
  projectId: string
): void {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  res.write(`: connected project=${projectId}\n\n`);

  const count = (activeByProject.get(projectId) ?? 0) + 1;
  activeByProject.set(projectId, count);

  const unsubscribe = vadProjectWatcher.subscribe(projectId, (ev) => {
    res.write(formatWatchSse(ev));
  });

  const heartbeat = setInterval(() => {
    res.write(": ping\n\n");
  }, 25_000);

  const close = () => {
    clearInterval(heartbeat);
    unsubscribe();
    const n = (activeByProject.get(projectId) ?? 1) - 1;
    if (n <= 0) activeByProject.delete(projectId);
    else activeByProject.set(projectId, n);
    if (!res.writableEnded) res.end();
  };

  req.on("close", close);
  req.on("aborted", close);
}
