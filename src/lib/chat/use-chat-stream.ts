"use client";

/**
 * useChatStream
 * --------------------------------------------------------------
 * 把 WebSocket 事件流接入 React 状态。
 *
 * 唯一通道：WebSocket（/ws），不再支持 SSE 回退。
 *
 * 暴露：
 *   - status:        idle | streaming | done | error
 *   - liveEvents:    本轮已收到的事件（按到达顺序）
 *   - finalProject:  最后一帧 `final_project` 里的 ProjectFile（如果有）
 *   - send(input):   发起一轮请求
 *   - cancel():      中止 WebSocket 运行
 *
 * 设计要点：
 *   - hook 只关心"流"的解析与状态；不做持久化（持久化交给 chat-store）
 *   - 每次 send() 都会重置 liveEvents/finalProject，但 chat-store 在
 *     `onAssistantText` / `onToolResult` 时已经把这一轮的关键事件 append 到了
 *     消息历史，所以丢失 liveEvents 不影响"已落地的对话"
 */

import { useCallback, useState } from "react";
import type { ChatMessage } from "@/lib/agents/chat-schema";
import type { ProjectFile } from "@/lib/project/schema";
import type { ProviderConfig } from "@/lib/providers/registry";
import type { ChatLiveEvent } from "./chat-live-event";
import { useWsClient, type WsApprovalInput, type WsToolApprovalInput } from "./use-ws-client";

export type ChatStreamStatus =
  | "idle"
  | "streaming"
  | "waiting_user"
  | "cancelling"
  | "done"
  | "error";
export type { ChatLiveEvent } from "./chat-live-event";

export interface ChatStreamCallbacks {
  /** 拿到 final_project 时回调，调用方负责 upsert 到 project store */
  onFinalProject?: (project: ProjectFile) => void;
  /** 每个事件都回调一次（在 setState 之前）；用于把工具调用/结果落入 chat-store */
  onEvent?: (ev: ChatLiveEvent) => void;
  /** 流结束时回调 */
  onDone?: () => void;
  /**
   * 流结束后是否清空 liveEvents。IDE 开启 diff 预览确认时应为 false，
   * 否则 done 后时间线里的 code_diff 会消失。
   */
  clearLiveEventsOnDone?: boolean;
  /** 错误回调（异常 + error 事件都会触发） */
  onError?: (message: string) => void;
}

export interface ChatStreamSendInput {
  project: ProjectFile | null;
  messages: ChatMessage[];
  providerConfig?: ProviderConfig;
  /** 当前会话 thread；多会话时必须传，避免串记忆 */
  threadId?: string;
}

export type ChatStreamApprovalInput = WsApprovalInput;
export type ChatStreamToolApprovalInput = WsToolApprovalInput;

export function useChatStream(callbacks?: ChatStreamCallbacks) {
  const [status, setStatus] = useState<ChatStreamStatus>("idle");
  const [liveEvents, setLiveEvents] = useState<ChatLiveEvent[]>([]);
  const [finalProject, setFinalProject] = useState<ProjectFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  // WebSocket 客户端（唯一通道）
  const wsClient = useWsClient({
    onEvent: (ev) => {
      if (ev.type === "run.cancelling") {
        setStatus("cancelling");
      }
      if (ev.type === "project.update") {
        const project = (ev.data as { project?: ProjectFile })?.project;
        if (project) callbacks?.onFinalProject?.(project);
      }
      callbacks?.onEvent?.(ev);
      setLiveEvents((current) => {
        if (!ev.id) return [...current, ev];
        const index = current.findIndex((item) => item.id === ev.id);
        if (index < 0) return [...current, ev];
        const next = current.slice();
        next[index] = ev;
        return next;
      });
    },
    onDone: (ev) => {
      callbacks?.onDone?.();
      if (callbacks?.clearLiveEventsOnDone !== false) {
        setLiveEvents([]);
      }
      setStatus(ev.type === "run.waiting_user" ? "waiting_user" : "done");
    },
    onError: (msg) => {
      setError(msg);
      setStatus("error");
      callbacks?.onError?.(msg);
    },
    clearLiveEventsOnDone: callbacks?.clearLiveEventsOnDone,
  });

  const send = useCallback(
    async (input: ChatStreamSendInput) => {
      const lastUser = [...input.messages].reverse().find((m) => m.role === "user");
      const prompt = lastUser?.content ?? "";
      if (!prompt.trim()) return;

      setStatus("streaming");
      setLiveEvents([]);
      setFinalProject(null);
      setError(null);

      try {
        await wsClient.send({
          project: input.project,
          messages: input.messages,
          providerConfig: input.providerConfig,
          projectId: input.project?.id,
          threadId: input.threadId,
        });
        return null;
      } catch (err) {
        const message = err instanceof Error ? err.message : "发送失败";
        setError(message);
        setStatus("error");
        callbacks?.onError?.(message);
        return null;
      }
    },
    [callbacks, wsClient.send]
  );

  const cancel = useCallback(() => {
    wsClient.cancel();
  }, [wsClient]);

  /** 切换/新建会话时清空本轮时间线视图（不中止后台 WS） */
  const clearLiveEvents = useCallback((opts?: { resetStatus?: boolean }) => {
    setLiveEvents([]);
    setFinalProject(null);
    setError(null);
    if (opts?.resetStatus) {
      setStatus("idle");
      return;
    }
    setStatus((current) =>
      current === "streaming" ||
      current === "cancelling" ||
      current === "waiting_user"
        ? current
        : "idle"
    );
  }, []);

  const approve = useCallback(
    async (input: ChatStreamApprovalInput) => {
      try {
        await wsClient.approve(input);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Approval failed";
        setError(message);
        setStatus("error");
        callbacks?.onError?.(message);
      }
    },
    [callbacks, wsClient.approve]
  );

  const approveTool = useCallback(
    async (input: ChatStreamToolApprovalInput) => {
      try {
        await wsClient.approveTool(input);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Tool approval failed";
        setError(message);
        setStatus("error");
        callbacks?.onError?.(message);
      }
    },
    [callbacks, wsClient.approveTool]
  );

  return {
    status,
    liveEvents,
    finalProject,
    error,
    send,
    approve,
    approveTool,
    cancel,
    clearLiveEvents,
    reconnect: wsClient.reconnect,
  };
}
