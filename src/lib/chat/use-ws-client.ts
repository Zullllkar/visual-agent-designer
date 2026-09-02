/**
 * useWsClient — WebSocket 客户端 Hook
 * --------------------------------------------------------------
 * 替代 useChatStream 的 SSE 客户端，通过 WebSocket 与 Agent 通信。
 *
 * 暴露：
 *   - status:        idle | streaming | done | error
 *   - liveEvents:    本轮已收到的事件
 *   - send(input):   发起一轮请求
 *   - cancel(runId): 中止运行
 *   - reconnect():   手动重连
 *
 * 特性：
 *   - 自动重连（指数退避）
 *   - 事件回放（重连后自动获取缓存事件）
 *   - 心跳保活
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/agents/chat-schema";
import type { ProjectFile } from "@/lib/project/schema";
import type { ProviderConfig } from "@/lib/providers/registry";
import type { ChatLiveEvent } from "./chat-live-event";

export type WsStreamStatus =
  | "idle"
  | "connecting"
  | "streaming"
  | "waiting_user"
  | "cancelling"
  | "done"
  | "error";

export interface WsClientCallbacks {
  onEvent?: (ev: ChatLiveEvent) => void;
  onDone?: (ev: ChatLiveEvent) => void;
  onError?: (message: string) => void;
  clearLiveEventsOnDone?: boolean;
}

export interface WsSendInput {
  project: ProjectFile | null;
  messages: ChatMessage[];
  providerConfig?: ProviderConfig;
  projectId?: string;
  threadId?: string;
}

export interface WsApprovalInput {
  projectId: string;
  prompt: string;
  count: number;
  /** 多类型：每条不同提示词 */
  prompts?: string[];
  providerConfig?: ProviderConfig;
  threadId?: string;
}

export interface WsToolApprovalInput {
  projectId: string;
  runId: string;
  approvalId: string;
  providerConfig?: ProviderConfig;
  action?: "approve" | "cancel";
  toolArgs?: Record<string, unknown>;
  threadId?: string;
}

function normalizeWsEvent(type: string, data: unknown): ChatLiveEvent | null {
  const payload = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;

  if (type === "message.delta") {
    const text = typeof payload.text === "string" ? payload.text : "";
    return text ? { type: "assistant_text", data: { text }, at: Date.now() } : null;
  }

  if (type === "thinking.delta") {
    const rawText = typeof payload.text === "string" ? payload.text : "";
    const text = rawText.includes("LangGraph Agent")
      ? "\nLLM 请求不可用，已切换到本地规则流程继续执行。\n"
      : rawText;
    return text ? { type: "thinking", data: { text }, at: Date.now() } : null;
  }

  if (type === "tool.started") {
    const id = String(payload.toolCallId ?? `${payload.runId ?? "run"}:${payload.toolName ?? "tool"}`);
    const name = String(payload.toolName ?? "unknown");
    return {
      type: "tool_call",
      data: { id, name, args: payload.args },
      at: Date.now(),
    };
  }

  if (type === "tool.completed") {
    const id = String(payload.toolCallId ?? `${payload.runId ?? "run"}:${payload.toolName ?? "tool"}`);
    const output = payload.output;
    return {
      type: "tool_result",
      data: {
        id,
        ok: payload.ok !== false,
        name: typeof payload.toolName === "string" ? payload.toolName : undefined,
        toolName: typeof payload.toolName === "string" ? payload.toolName : undefined,
        summary: typeof payload.outputSummary === "string" ? payload.outputSummary : undefined,
        data: output,
        artifacts: Array.isArray(payload.artifacts) ? payload.artifacts : undefined,
      },
      at: Date.now(),
    };
  }

  return { type, data, at: Date.now() };
}

export function useWsClient(callbacks?: WsClientCallbacks) {
  const [status, setStatus] = useState<WsStreamStatus>("idle");
  const [liveEvents, setLiveEvents] = useState<ChatLiveEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const runIdRef = useRef<string | null>(null);
  const threadIdRef = useRef<string | null>(null);
  const eventCounterRef = useRef(0);
  const projectIdRef = useRef<string | null>(null);
  const reconnectAttempts = useRef(0);
  const disposedRef = useRef(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingEventsRef = useRef<ChatLiveEvent[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const flushPendingEvents = useCallback(() => {
    const pending = pendingEventsRef.current;
    if (pending.length === 0) return;
    pendingEventsRef.current = [];
    setLiveEvents((current) => [...current, ...pending]);
  }, []);

  const clearFlushTimer = useCallback(() => {
    if (!flushTimerRef.current) return;
    clearTimeout(flushTimerRef.current);
    flushTimerRef.current = null;
  }, []);

  const clearLiveEvents = useCallback(() => {
    clearFlushTimer();
    pendingEventsRef.current = [];
    setLiveEvents([]);
  }, [clearFlushTimer]);

  const pushLiveEvent = useCallback(
    (event: ChatLiveEvent, options?: { immediate?: boolean }) => {
      callbacksRef.current?.onEvent?.(event);

      if (options?.immediate) {
        clearFlushTimer();
        flushPendingEvents();
        setLiveEvents((current) => [...current, event]);
        return;
      }

      pendingEventsRef.current.push(event);
      if (!flushTimerRef.current) {
        flushTimerRef.current = setTimeout(() => {
          flushTimerRef.current = null;
          flushPendingEvents();
        }, 50);
      }
    },
    [clearFlushTimer, flushPendingEvents]
  );

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus("connecting");
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (disposedRef.current || wsRef.current !== ws) return;
      reconnectAttempts.current = 0;
      setStatus("idle");
      if (projectIdRef.current) {
        try {
          ws.send(JSON.stringify({
            action: "canvas.subscribe",
            projectId: projectIdRef.current,
            threadId: threadIdRef.current ?? undefined,
          }));
        } catch {
          setError("WebSocket 订阅失败，正在重连…");
        }
      }
    };

    ws.onmessage = (event) => {
      if (wsRef.current !== ws) return;
      let msg: { type: string; data: unknown; seq?: number; at?: number };
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === "command.ack") {
        const data = msg.data as { runId?: string; threadId?: string };
        runIdRef.current = data.runId ?? null;
        threadIdRef.current = data.threadId ?? null;
        return;
      }

      if (msg.type === "run.cancelling") {
        const event: ChatLiveEvent = {
          id: `ws:${++eventCounterRef.current}`,
          type: msg.type,
          data: msg.data,
          at: msg.at ?? Date.now(),
        };
        pushLiveEvent(event, { immediate: true });
        setStatus("cancelling");
        return;
      }

      if (
        msg.type === "run.completed" ||
        msg.type === "run.cancelled" ||
        msg.type === "run.waiting_user" ||
        msg.type === "run.interrupted"
      ) {
        const terminalEvent: ChatLiveEvent = {
          id: `ws:${++eventCounterRef.current}`,
          type: msg.type,
          data: msg.data,
          at: msg.at ?? Date.now(),
        };
        pushLiveEvent(terminalEvent, { immediate: true });
        callbacksRef.current?.onDone?.(terminalEvent);
        if (callbacksRef.current?.clearLiveEventsOnDone !== false) {
          clearLiveEvents();
        }
        setStatus(msg.type === "run.waiting_user" ? "waiting_user" : "done");
        if (msg.type !== "run.waiting_user") {
          runIdRef.current = null;
        }
        return;
      }

      if (msg.type === "run.failed") {
        const errMsg = (msg.data as { error?: string })?.error ?? "运行失败";
        const failedEvent: ChatLiveEvent = {
          id: `ws:${++eventCounterRef.current}`,
          type: "run.failed",
          data: msg.data,
          at: msg.at ?? Date.now(),
        };
        pushLiveEvent(failedEvent, { immediate: true });
        setError(errMsg);
        setStatus("error");
        callbacksRef.current?.onError?.(errMsg);
        return;
      }

      if (msg.type === "error") {
        const errMsg = (msg.data as { message?: string })?.message ?? "未知错误";
        setError(errMsg);
        callbacksRef.current?.onError?.(errMsg);
        return;
      }

      const live = normalizeWsEvent(msg.type, msg.data);
      if (!live) return;
      const payload = msg.data as { eventId?: unknown };
      live.id =
        typeof payload?.eventId === "string"
          ? payload.eventId
          : typeof msg.seq === "number"
            ? `seq:${msg.seq}`
            : `ws:${++eventCounterRef.current}`;
      if (typeof msg.seq === "number") {
        live.seq = msg.seq;
      }
      if (typeof msg.at === "number") {
        live.at = msg.at;
      }
      pushLiveEvent(live);
    };

    ws.onclose = () => {
      if (wsRef.current !== ws || disposedRef.current) return;
      wsRef.current = null;
      if (reconnectAttempts.current < 8) {
        const delay = Math.min(1000 * 2 ** reconnectAttempts.current, 15000);
        reconnectAttempts.current++;
        if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
        reconnectTimer.current = setTimeout(() => {
          reconnectTimer.current = null;
          connect();
        }, delay);
      } else {
        setStatus("error");
        setError("WebSocket 已断开，自动重连失败，请点击重试");
      }
    };

    ws.onerror = () => {
      if (wsRef.current !== ws) return;
      setError("WebSocket 连接错误，正在重连…");
    };
  }, [clearLiveEvents, pushLiveEvent]);

  const send = useCallback(
    async (input: WsSendInput) => {
      clearLiveEvents();
      setError(null);
      setStatus("streaming");
      projectIdRef.current = input.projectId ?? input.project?.id ?? null;
      threadIdRef.current = input.threadId ?? threadIdRef.current;

      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        connect();
        await new Promise<void>((resolve, reject) => {
          const startedAt = Date.now();
          const check = setInterval(() => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              clearInterval(check);
              resolve();
            } else if (Date.now() - startedAt > 15_000) {
              clearInterval(check);
              reject(new Error("WebSocket 连接超时，请稍后重试"));
            }
          }, 100);
        });
      }

      const lastUser = [...input.messages].reverse().find((m) => m.role === "user");
      const prompt = lastUser?.content ?? "";
      if (!prompt.trim()) {
        setStatus("idle");
        return;
      }

      const payload: Record<string, unknown> = {
        action: "agent.run",
        prompt,
        projectId: input.projectId ?? input.project?.id,
        providerConfig: input.providerConfig,
      };
      if (lastUser?.attachments?.length) payload.attachments = lastUser.attachments;
      if (lastUser?.mentions?.length) payload.mentions = lastUser.mentions;
      const tid = input.threadId ?? threadIdRef.current;
      if (tid) payload.threadId = tid;

      const socket = wsRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        throw new Error("WebSocket 尚未连接");
      }
      socket.send(JSON.stringify(payload));
    },
    [clearLiveEvents, connect]
  );

  const approve = useCallback(
    async (input: WsApprovalInput) => {
      const prompt = input.prompt.trim();
      if (!prompt) return;
      clearLiveEvents();
      setError(null);
      setStatus("streaming");
      projectIdRef.current = input.projectId;
      threadIdRef.current = input.threadId ?? threadIdRef.current;

      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        connect();
        await new Promise<void>((resolve, reject) => {
          const startedAt = Date.now();
          const check = setInterval(() => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              clearInterval(check);
              resolve();
            } else if (Date.now() - startedAt > 15_000) {
              clearInterval(check);
              reject(new Error("WebSocket connection timeout"));
            }
          }, 100);
        });
      }

      const prompts = (input.prompts ?? [])
        .map((p) => p.trim())
        .filter(Boolean)
        .slice(0, 8);
      const payload: Record<string, unknown> = {
        action: "agent.approve",
        prompt: prompts[0] ?? prompt,
        count: Math.min(
          8,
          Math.max(1, Math.round(prompts.length > 1 ? prompts.length : input.count || 1))
        ),
        projectId: input.projectId,
        providerConfig: input.providerConfig,
      };
      if (prompts.length > 0) payload.prompts = prompts;
      const tid = input.threadId ?? threadIdRef.current;
      if (tid) payload.threadId = tid;
      const socket = wsRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        throw new Error("WebSocket is not connected");
      }
      socket.send(JSON.stringify(payload));
    },
    [clearLiveEvents, connect]
  );

  const approveTool = useCallback(
    async (input: WsToolApprovalInput) => {
      if (!input.runId || !input.approvalId) return;
      setError(null);
      setStatus("streaming");
      projectIdRef.current = input.projectId;
      runIdRef.current = input.runId;
      threadIdRef.current = input.threadId ?? threadIdRef.current;

      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        connect();
        await new Promise<void>((resolve, reject) => {
          const startedAt = Date.now();
          const check = setInterval(() => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              clearInterval(check);
              resolve();
            } else if (Date.now() - startedAt > 15_000) {
              clearInterval(check);
              reject(new Error("WebSocket connection timeout"));
            }
          }, 100);
        });
      }

      const socket = wsRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        throw new Error("WebSocket is not connected");
      }
      const tid = input.threadId ?? threadIdRef.current;
      socket.send(JSON.stringify({
        action: input.action === "cancel" ? "tool.cancel" : "tool.approve",
        projectId: input.projectId,
        runId: input.runId,
        approvalId: input.approvalId,
        providerConfig: input.providerConfig,
        ...(tid ? { threadId: tid } : {}),
        ...(input.toolArgs ? { toolArgs: input.toolArgs } : {}),
      }));
    },
    [connect]
  );

  const cancel = useCallback(() => {
    if (runIdRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current?.send(
        JSON.stringify({
          action: "agent.cancel",
          runId: runIdRef.current,
        })
      );
      setStatus("cancelling");
    }
  }, []);

  const reconnect = useCallback(() => {
    reconnectAttempts.current = 0;
    connect();
  }, [connect]);

  useEffect(() => {
    disposedRef.current = false;
    connect();
    return () => {
      disposedRef.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
      clearFlushTimer();
      pendingEventsRef.current = [];
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [clearFlushTimer, connect]);

  return { status, liveEvents, error, send, approve, approveTool, cancel, reconnect };
}
