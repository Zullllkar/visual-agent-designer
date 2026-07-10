"use client";

/**
 * 首页一键生成 SSE（/api/agents/generate/stream）→ Chat 时间线事件
 * --------------------------------------------------------------
 * @author：wangjunhua
 */

import { useCallback, useRef, useState } from "react";
import { createSseParser } from "./sse-parser";
import type { ChatMessage } from "@/lib/agents/chat-schema";
import type { PipelineLogEntry } from "@/lib/agents/pipeline-logger";
import { PIPELINE_STAGE_LABELS } from "@/lib/agents/pipeline-logger";
import type { PipelineProgress } from "@/lib/agents/design-pipeline";
import type { ProjectFile } from "@/lib/project/schema";
import type { ProviderConfig } from "@/lib/providers/registry";
import { makeAssistantTextMessage, makeUserMessage } from "@/store/chat-store";
import type { ChatLiveEvent } from "./chat-live-event";

export type GenerateStreamStatus = "idle" | "streaming" | "done" | "error";

const GENERATE_TIMEOUT_MS = 15 * 60 * 1000;

export interface UseGenerateStreamOptions {
  /** 流结束后保留 liveEvents（IDE 首页跳转生成场景） */
  clearLiveEventsOnDone?: boolean;
  /** 每张生图 / 布局阶段推送的项目快照（用于画布与素材栏实时更新） */
  onProjectSnapshot?: (project: ProjectFile) => void;
}

export function useGenerateStream(opts?: UseGenerateStreamOptions) {
  const [status, setStatus] = useState<GenerateStreamStatus>("idle");
  const [liveEvents, setLiveEvents] = useState<ChatLiveEvent[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const pushLive = useCallback((type: string, data: unknown) => {
    const ev: ChatLiveEvent = { type, data, at: Date.now() };
    setLiveEvents((s) => [...s, ev]);
  }, []);

  const generate = useCallback(
    async (
      idea: string,
      providerConfig: ProviderConfig,
      projectId?: string
    ): Promise<ProjectFile | null> => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      const timer = setTimeout(() => ac.abort(), GENERATE_TIMEOUT_MS);

      setStatus("streaming");
      setLiveEvents([]);
      setError(null);
      setMessages([makeUserMessage(idea.trim())]);

      try {
        const res = await fetch("/api/agents/generate/stream", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            idea,
            providerConfig,
            ...(projectId ? { projectId } : {}),
          }),
          signal: ac.signal,
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            message?: string;
            error?: string;
          };
          throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
        }
        if (!res.body) throw new Error("服务端未返回流式响应");

        const parser = createSseParser();
        const reader = res.body.getReader();
        const streamState: {
          project: ProjectFile | null;
          error: string | null;
        } = { project: null, error: null };

        const handleFrame = (ev: { type: string; data: string }) => {
          if (ev.type === "log") {
            try {
              const entry = JSON.parse(ev.data) as PipelineLogEntry;
              pushLive("pipeline_log", entry);
            } catch {
              /* ignore */
            }
            return;
          }
          if (ev.type === "code_diff") {
            try {
              const diff = JSON.parse(ev.data);
              pushLive("code_diff", diff);
            } catch {
              /* ignore */
            }
            return;
          }
          if (ev.type === "progress") {
            try {
              const p = JSON.parse(ev.data) as PipelineProgress;
              const label = PIPELINE_STAGE_LABELS[p.stage] ?? p.stage;
              pushLive("thinking", {
                text: `\n▸ ${label}${p.detail ? ` — ${p.detail}` : ""}\n`,
              });
            } catch {
              /* ignore */
            }
            return;
          }
          if (ev.type === "error") {
            try {
              const data = JSON.parse(ev.data) as { message?: string };
              streamState.error = data.message ?? "生成失败";
              pushLive("error", { message: streamState.error });
            } catch {
              streamState.error = "生成失败";
            }
            return;
          }
          if (ev.type === "project_snapshot") {
            try {
              const data = JSON.parse(ev.data) as { project?: ProjectFile };
              if (data.project?.id) {
                streamState.project = data.project;
                opts?.onProjectSnapshot?.(data.project);
              }
            } catch {
              /* ignore */
            }
            return;
          }
          if (ev.type === "final_project") {
            const data = JSON.parse(ev.data) as { project?: ProjectFile };
            streamState.project = data.project ?? null;
            if (streamState.project) opts?.onProjectSnapshot?.(streamState.project);
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            for (const ev of parser.flush()) handleFrame(ev);
            break;
          }
          if (!value) continue;
          for (const ev of parser.feed(value)) handleFrame(ev);
        }

        if (streamState.error) throw new Error(streamState.error);
        const finalProject = streamState.project;
        if (!finalProject?.id) throw new Error("服务端未返回有效项目数据");

        const summary =
          `已生成项目「${finalProject.title}」。` +
          (finalProject.pages.length ? ` 包含 ${finalProject.pages.length} 个页面。` : "") +
          (finalProject.brief?.positioning ? ` 定位：${finalProject.brief.positioning}。` : "") +
          ` 即将进入 IDE，可继续评审或修复。`;

        pushLive("assistant_text", { text: summary });
        setMessages((m) => [...m, makeAssistantTextMessage(summary)]);
        if (opts?.clearLiveEventsOnDone !== false) {
          setLiveEvents([]);
        }
        setStatus("done");
        return finalProject;
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          const msg =
            "生成超时（已超过 15 分钟）。请检查网络、代理或换更快模型后重试。";
          setError(msg);
          pushLive("error", { message: msg });
        } else {
          const msg = (e as Error).message;
          setError(msg);
          pushLive("error", { message: msg });
        }
        setStatus("error");
        return null;
      } finally {
        clearTimeout(timer);
        abortRef.current = null;
      }
    },
    [pushLive, opts?.clearLiveEventsOnDone, opts?.onProjectSnapshot]
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("idle");
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setLiveEvents([]);
    setMessages([]);
    setError(null);
  }, []);

  return {
    status,
    liveEvents,
    messages,
    error,
    generate,
    cancel,
    reset,
    isStreaming: status === "streaming",
  };
}
