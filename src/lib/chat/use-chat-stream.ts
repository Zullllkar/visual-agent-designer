"use client";

/**
 * useChatStream
 * --------------------------------------------------------------
 * 把 fetch /api/chat 的 SSE 流接入 React 状态。
 *
 * 暴露：
 *   - status:        idle | streaming | done | error
 *   - liveEvents:    本轮已收到的事件（按到达顺序）
 *   - finalProject:  最后一帧 `final_project` 里的 ProjectFile（如果有）
 *   - send(input):   发起一轮请求
 *   - cancel():      中止（AbortController）
 *
 * 设计要点：
 *   - hook 只关心"流"的解析与状态；不做持久化（持久化交给 chat-store）
 *   - 每次 send() 都会重置 liveEvents/finalProject，但 chat-store 在
 *     `onAssistantText` / `onToolResult` 时已经把这一轮的关键事件 append 到了
 *     消息历史，所以丢失 liveEvents 不影响"已落地的对话"
 */

import { useCallback, useRef, useState } from "react";
import { createSseParser } from "./sse-parser";
import type { ChatMessage } from "@/lib/agents/chat-schema";
import type { ProjectFile } from "@/lib/project/schema";
import type { ProviderConfig } from "@/lib/providers/registry";

export type ChatStreamStatus = "idle" | "streaming" | "done" | "error";

export type { ChatLiveEvent } from "./chat-live-event";
import type { ChatLiveEvent } from "./chat-live-event";

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
}

export function useChatStream(callbacks?: ChatStreamCallbacks) {
  const [status, setStatus] = useState<ChatStreamStatus>("idle");
  const [liveEvents, setLiveEvents] = useState<ChatLiveEvent[]>([]);
  const [finalProject, setFinalProject] = useState<ProjectFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (input: ChatStreamSendInput) => {
      // 中止可能存在的上一轮
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      setStatus("streaming");
      setLiveEvents([]);
      setFinalProject(null);
      setError(null);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => "");
          throw new Error(`chat request failed: ${res.status} ${text}`);
        }

        const reader = res.body.getReader();
        const parser = createSseParser();
        let lastFinalProject: ProjectFile | null = null;

        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            for (const ev of parser.flush()) {
              handleFrame(ev);
            }
            break;
          }
          if (!value) continue;
          for (const ev of parser.feed(value)) {
            handleFrame(ev);
          }
        }

        function handleFrame(ev: { type: string; data: string }) {
          let data: unknown = ev.data;
          try {
            data = JSON.parse(ev.data);
          } catch {
            // 保留原字符串
          }

          if (ev.type === "final_project") {
            const proj = (data as { project: ProjectFile }).project;
            lastFinalProject = proj;
            setFinalProject(proj);
            callbacks?.onFinalProject?.(proj);
            return;
          }

          if (ev.type === "error") {
            const msg = (data as { message?: string })?.message ?? "unknown error";
            setError(msg);
            callbacks?.onError?.(msg);
          }

          const live: ChatLiveEvent = { type: ev.type, data, at: Date.now() };
          callbacks?.onEvent?.(live);
          setLiveEvents((s) => [...s, live]);
        }

        callbacks?.onDone?.();
        if (callbacks?.clearLiveEventsOnDone !== false) {
          setLiveEvents([]);
        }
        setStatus("done");
        return lastFinalProject;
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          setStatus("idle");
          return null;
        }
        const msg = (e as Error).message;
        setError(msg);
        setStatus("error");
        callbacks?.onError?.(msg);
        return null;
      }
    },
    [callbacks]
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("idle");
  }, []);

  return { status, liveEvents, finalProject, error, send, cancel };
}
