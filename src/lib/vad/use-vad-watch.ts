"use client";

/**
 * 订阅 .vad 文件变更（SSE）
 * --------------------------------------------------------------
 * 外部编辑器或 Daemon 写入后，自动刷新项目 / 对话 / 文件树。
 *
 * @author：wangjunhua
 */

import { useEffect, useRef } from "react";
import type { VadWatchEvent, VadWatchKind } from "./watch-types";

export interface VadWatchHandlers {
  onProjectChange?: (ev: VadWatchEvent) => void;
  onChatChange?: (ev: VadWatchEvent) => void;
  onArtifactChange?: (ev: VadWatchEvent) => void;
}

const PROJECT_KINDS: VadWatchKind[] = ["project", "canvas", "page"];

function dispatch(ev: VadWatchEvent, handlers: VadWatchHandlers): void {
  if (ev.kind === "chat") {
    handlers.onChatChange?.(ev);
    return;
  }
  if (PROJECT_KINDS.includes(ev.kind)) {
    handlers.onProjectChange?.(ev);
    return;
  }
  if (ev.kind === "artifact") {
    handlers.onArtifactChange?.(ev);
  }
}

export function useVadWatch(
  projectId: string | null | undefined,
  handlers: VadWatchHandlers
): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!projectId || typeof window === "undefined") return;

    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      es = new EventSource(`/api/projects/${encodeURIComponent(projectId)}/watch`);

      es.onmessage = (msg) => {
        try {
          const ev = JSON.parse(msg.data) as VadWatchEvent;
          dispatch(ev, handlersRef.current);
        } catch {
          /* ignore heartbeat / comments */
        }
      };

      es.onerror = () => {
        es?.close();
        es = null;
        if (!closed) {
          retryTimer = setTimeout(connect, 3000);
        }
      };
    };

    connect();

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, [projectId]);
}
