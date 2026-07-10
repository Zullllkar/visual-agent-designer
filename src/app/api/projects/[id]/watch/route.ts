/**
 * GET /api/projects/[id]/watch
 * --------------------------------------------------------------
 * SSE：外部或本进程写入 .vad 后推送变更，供 IDE 热更新。
 *
 * @author：wangjunhua
 */

import {
  getDaemonAuthToken,
  getDaemonBaseUrl,
  isDaemonEnabled,
} from "@/lib/vad/daemon-config";
import { createInlineWatchResponse } from "@/lib/vad/watch-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  if (isDaemonEnabled()) {
    const base = getDaemonBaseUrl();
    const url = `${base}/v1/projects/${encodeURIComponent(id)}/watch`;
    const headers: Record<string, string> = {};
    const token = getDaemonAuthToken();
    if (token) headers["x-vad-daemon-token"] = token;

    try {
      const upstream = await fetch(url, {
        headers,
        signal: req.signal,
      });
      if (!upstream.ok || !upstream.body) {
        return createInlineWatchResponse(id, req.signal);
      }
      return new Response(upstream.body, {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
        },
      });
    } catch {
      return createInlineWatchResponse(id, req.signal);
    }
  }

  return createInlineWatchResponse(id, req.signal);
}
