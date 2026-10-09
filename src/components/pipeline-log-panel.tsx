"use client";

/**
 * --------------------------------------------------------------
 * 展示 SSE 实时日志或历史 JSONL 记录。
 * @author：wangjunhua
 */

import { useEffect, useRef } from "react";
import type { PipelineLogEntry } from "@/lib/agents/pipeline-logger";
import { PIPELINE_STAGE_LABELS } from "@/lib/agents/pipeline-logger";

const LEVEL_CLASS: Record<string, string> = {
  info: "text-[var(--muted)]",
  success: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  error: "text-red-600 dark:text-red-400",
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function PipelineLogPanel({
  entries,
  maxHeight = "280px",
  title = "执行日志",
  showHeader = true,
  tone = "terminal",
}: {
  entries: PipelineLogEntry[];
  maxHeight?: string;
  title?: string;
  showHeader?: boolean;
  tone?: "terminal" | "panel";
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  return (
    <div
      className={
        showHeader
          ? "app-card mt-4 overflow-hidden rounded-xl"
          : "overflow-hidden rounded-lg"
      }
    >
      {showHeader ? (
        <div className="border-b app-border px-4 py-2.5">
          <p className="text-xs font-bold app-strong">{title}</p>
          <p className="text-[10px] app-subtle">
            共 {entries.length} 条 · 终端与{" "}
            <code className="rounded bg-[var(--surface-muted)] px-1">
              .vad/projects/&lt;id&gt;/pipeline-log.jsonl
            </code>{" "}
            同步写入
          </p>
        </div>
      ) : null}
      <div
        className={
          tone === "panel"
            ? "vad-inspector-log"
            : "overflow-y-auto bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-300"
        }
        style={{ maxHeight }}
      >
        {entries.length === 0 ? (
          <p className={tone === "panel" ? "text-[var(--muted)]" : "text-zinc-500"}>
            等待日志…
           </p>
        ) : (
          entries.map((e) => (
            <div key={e.id} className="mb-1.5 flex gap-2">
              <span
                className={
                  tone === "panel"
                    ? "vad-inspector-log__time shrink-0"
                    : "shrink-0 text-zinc-600"
                }
              >
                {formatTime(e.at)}
              </span>
              <span
                className={
                  tone === "panel"
                    ? "vad-inspector-log__stage shrink-0"
                    : "shrink-0 text-[var(--primary)]"
                }
              >
                [{PIPELINE_STAGE_LABELS[e.stage ?? ""] ?? e.stage ?? "—"}]
              </span>
              <span className={LEVEL_CLASS[e.level] ?? ""}>
                {e.message}
                {e.durationMs != null ? (
                  <span className={tone === "panel" ? "text-[var(--muted)]" : "text-zinc-500"}>
                    {" "}
                    +{e.durationMs}ms
                  </span>
                ) : null}
              </span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
