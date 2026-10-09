"use client";

/**
 * 本机实现面板：预览并启动本机 CLI Agent；事件通过 spawn 的 JSONL 流回传。
 */

import { Loader2, Play, RefreshCw, Square, Terminal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BRIDGE_AGENT_LABELS,
  type BridgeAgentSlug,
  type BuildLogEvent,
  type BuildPreviewResponse,
  type BuildRunPublic,
} from "@/lib/bridge/client-types";
import { useBridgeStatus } from "@/lib/bridge/use-bridge-status";
import type { ProjectFile } from "@/lib/project/schema";

const AGENTS: BridgeAgentSlug[] = ["cursor", "claude", "codex"];

function kindLabel(kind: BuildLogEvent["kind"]): string {
  if (kind === "tool") return "工具";
  if (kind === "thinking") return "思考";
  if (kind === "error") return "错误";
  if (kind === "stderr") return "stderr";
  if (kind === "status") return "状态";
  return "";
}

export function BuildPanel({ project }: { project: ProjectFile }) {
  const { agents, agentsLoading, refreshAgents } = useBridgeStatus({ pollMs: 30_000 });
  const [slug, setSlug] = useState<BridgeAgentSlug>("cursor");
  const [extraPrompt, setExtraPrompt] = useState("");
  const [preview, setPreview] = useState<BuildPreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "start" | "cancel" | null>(null);
  const [run, setRun] = useState<BuildRunPublic | null>(null);
  const [events, setEvents] = useState<BuildLogEvent[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const received = useRef(0);

  const cli = agents?.find((a) => a.slug === slug)?.cli;
  const linked = project.linkedRepo;

  const previewBody = useMemo(
    () => ({
      projectId: project.id,
      agent: slug,
      extraPrompt: extraPrompt.trim() || undefined,
    }),
    [project.id, slug, extraPrompt],
  );

  const loadPreview = useCallback(async () => {
    if (!linked?.path) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    setBusy("preview");
    setPreviewError(null);
    try {
      const res = await fetch("/mcp/build/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(previewBody),
      });
      const data = (await res.json()) as BuildPreviewResponse & { message?: string };
      if (!res.ok) {
        setPreview(null);
        setPreviewError(data.message ?? `HTTP ${res.status}`);
        return;
      }
      setPreview(data);
    } catch (err) {
      setPreview(null);
      setPreviewError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }, [linked?.path, previewBody]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadPreview(), 250);
    return () => window.clearTimeout(timer);
  }, [loadPreview]);

  useEffect(() => {
    if (run?.status !== "running" || !run.id) return;
    const runId = run.id;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(
          `/mcp/build/run?id=${encodeURIComponent(runId)}&after=${received.current}`,
        );
        const data = (await res.json()) as { run?: BuildRunPublic };
        const next = data.run;
        if (cancelled || !next) return;
        if (next.events.length) {
          setEvents((prev) => [...prev, ...next.events]);
          received.current = next.eventCount;
        }
        setRun((prev) => (prev ? { ...next, events: [] } : next));
      } catch {
        // 静默等待下一轮轮询
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 800);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [run?.id, run?.status]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  });

  useEffect(() => {
    let cancelled = false;
    void fetch(`/mcp/build?projectId=${encodeURIComponent(project.id)}`)
      .then((res) => res.json())
      .then((data: { runs?: BuildRunPublic[] }) => {
        if (cancelled) return;
        const latest = data.runs?.[0];
        if (!latest) return;
        setRun({ ...latest, events: [] });
        setEvents(latest.events);
        received.current = latest.eventCount;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  async function start() {
    if (!preview) return;
    setBusy("start");
    setPreviewError(null);
    try {
      const res = await fetch("/mcp/build/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...previewBody, fingerprint: preview.fingerprint, confirm: true }),
      });
      const data = (await res.json()) as { run?: BuildRunPublic; message?: string };
      if (!res.ok || !data.run) {
        setPreviewError(data.message ?? `HTTP ${res.status}`);
        void loadPreview();
        return;
      }
      received.current = data.run.eventCount;
      setEvents(data.run.events);
      setRun({ ...data.run, events: [] });
    } catch (err) {
      setPreviewError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    if (!run) return;
    setBusy("cancel");
    try {
      await fetch("/mcp/build/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: run.id }),
      });
    } finally {
      setBusy(null);
    }
  }

  if (!linked?.path) {
    return (
      <div className="flex h-full min-w-0 flex-col overflow-hidden">
        <div className="vad-inspector-toolbar">
          <span>拉起本机 CLI 实现</span>
        </div>
        <div className="vad-inspector-scroll">
          <div className="vad-inspector-empty">
            <div>
              <p className="text-[13px] font-medium tracking-[-0.02em]">尚未关联代码仓库</p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--muted)]">
                先在导出里关联项目仓库；之后可以把设计稿交给 Cursor Agent / Claude Code / Codex 在本机执行实现。
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const running = run?.status === "running";

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <div className="vad-inspector-toolbar">
        <span>拉起本机 CLI 实现</span>
        <button
          type="button"
          onClick={() => {
            void refreshAgents();
            void loadPreview();
          }}
          className="vad-agent-icon-btn"
          aria-label="刷新 CLI 检测"
        >
          <RefreshCw
            className={`size-3.5 ${agentsLoading || busy === "preview" ? "animate-spin" : ""}`}
          />
        </button>
      </div>
      <div className="vad-inspector-scroll flex min-h-0 flex-1 flex-col gap-3">
        <p className="text-[12px] leading-relaxed text-[var(--muted)]">
          执行目录：{" "}
          <span className="font-mono text-[11px] text-[var(--foreground)]">{linked.path}</span>
        </p>

        <div className="flex flex-wrap gap-1.5">
          {AGENTS.map((id) => {
            const installed = agents?.find((a) => a.slug === id)?.cli?.installed;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setSlug(id)}
                className="vad-inspector-more-btn"
                data-active={slug === id}
              >
                {BRIDGE_AGENT_LABELS[id]}
                {installed === false ? " · 未安装" : ""}
              </button>
            );
          })}
        </div>

        <textarea
          className="min-h-[72px] w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-[12px] leading-relaxed"
          placeholder="补充给实现的额外说明（会附加到 kickoff prompt）"
          value={extraPrompt}
          onChange={(e) => setExtraPrompt(e.target.value)}
          disabled={running}
        />

        {previewError ? <p className="text-[12px] text-[var(--danger)]">{previewError}</p> : null}

        {preview ? (
          <section className="vad-inspector-card">
            <p className="vad-inspector-section">将要执行的命令（确认后启动）</p>
            <pre className="mt-1.5 max-h-28 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed text-[var(--foreground)]">
              {preview.command}
            </pre>
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
              stdin 投递 prompt（{preview.promptChars} 字），不进 argv。注入{" "}
              {preview.envKeys.join("、")} 环境变量。
              {preview.version ? ` ${preview.bin} ${preview.version}` : ""}
            </p>
            {preview.warnings.map((w) => (
              <p key={w} className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                {w}
              </p>
            ))}
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-[var(--muted)]">
                查看 prompt
              </summary>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[10px] leading-relaxed">
                {preview.prompt}
              </pre>
            </details>
          </section>
        ) : cli && cli.installed === false ? (
          <p className="text-[12px] text-[var(--muted)]">
            未检测到 {BRIDGE_AGENT_LABELS[slug]} CLI。
            {cli.installUrl ? (
              <a href={cli.installUrl} target="_blank" rel="noreferrer" className="ml-1 underline">
                查看安装说明
              </a>
            ) : null}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={!preview || running || busy !== null}
            onClick={() => void start()}
            className="inline-flex h-8 items-center gap-1 rounded-lg bg-[var(--primary)] px-2.5 text-[11px] font-semibold text-white disabled:opacity-50"
          >
            {busy === "start" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Play className="size-3.5" />
            )}
            确认并启动
          </button>
          <button
            type="button"
            disabled={!running || busy === "cancel"}
            onClick={() => void cancel()}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 text-[11px] disabled:opacity-50"
          >
            {busy === "cancel" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Square className="size-3.5" />
            )}
            取消
          </button>
        </div>

        <section className="flex min-h-0 flex-1 flex-col">
          <p className="vad-inspector-section flex items-center gap-1">
            <Terminal className="size-3" />
            运行日志
            {run ? ` · ${statusLabel(run.status)}` : ""}
          </p>
          <div
            ref={logRef}
            className="mt-1.5 min-h-[160px] flex-1 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-[10px] leading-relaxed"
          >
            {events.length === 0 ? (
              <p className="text-[var(--muted)]">确认并启动后，CLI 输出会实时显示在这里。</p>
            ) : (
              events.map((ev) => (
                <div
                  key={ev.seq ?? `${ev.ts}:${ev.kind}:${ev.name ?? ""}:${ev.text}`}
                  className={
                    ev.kind === "error" || ev.kind === "stderr"
                      ? "text-[var(--danger)]"
                      : ev.kind === "tool"
                        ? "text-sky-600 dark:text-sky-400"
                        : ev.kind === "status"
                          ? "text-[var(--muted)]"
                          : ""
                  }
                >
                  {kindLabel(ev.kind) ? (
                    <span className="mr-1 opacity-70">[{kindLabel(ev.kind)}]</span>
                  ) : null}
                  {ev.name ? <span className="mr-1">{ev.name}</span> : null}
                  <span className="whitespace-pre-wrap break-all">{ev.text}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function statusLabel(status: BuildRunPublic["status"]): string {
  if (status === "running") return "运行中";
  if (status === "completed") return "已完成";
  if (status === "cancelled") return "已取消";
  return "失败";
}
