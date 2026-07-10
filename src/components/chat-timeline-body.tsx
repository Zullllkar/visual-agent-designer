"use client";

/**
 * Chat / 生成流水线共用时间线渲染
 * --------------------------------------------------------------
 * IDE 助理栏与首页一键生成共用，支持 ide | home 主题。
 *
 * @author：wangjunhua
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  FileCode2,
  GitCompare,
  ListChecks,
  Loader2,
  Sparkles,
  XCircle,
} from "lucide-react";
import { buildDiffLines, type CodeDiffPayload } from "@/lib/chat/code-diff";
import type { DiffDecision } from "@/lib/chat/diff-preview";
import { McpQuickCopy } from "@/components/mcp-quick-copy";
import type { ChatMessage } from "@/lib/agents/chat-schema";
import type { ProjectFile } from "@/lib/project/schema";
import { useCanvasUiStore } from "@/store/canvas-ui-store";
import {
  PIPELINE_STAGE_LABELS,
  type PipelineLogEntry,
} from "@/lib/agents/pipeline-logger";
import type { ChatLiveEvent } from "@/lib/chat/chat-live-event";
import { buildChatTimeline, type TimelineItem } from "@/lib/chat/live-timeline";

const LOG_LEVEL_CLASS: Record<string, string> = {
  info: "text-zinc-500",
  success: "text-emerald-500/90",
  warn: "text-amber-500/90",
  error: "text-red-400/90",
};

const LOG_LEVEL_HOME: Record<string, string> = {
  info: "app-subtle",
  success: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  error: "text-red-600 dark:text-red-400",
};

function formatThoughtDuration(ms?: number): string {
  if (!ms || ms < 1000) return "Thought for 1s";
  const s = Math.round(ms / 1000);
  return `Thought for ${s}s`;
}

function formatLogTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

function PendingDiffBanner({
  pendingCount,
  theme,
}: {
  pendingCount: number;
  theme: "ide" | "home";
}) {
  if (pendingCount <= 0) return null;
  return (
    <p
      className={
        theme === "ide"
          ? "text-[11px] text-amber-400/90 font-medium rounded-lg border border-amber-800/40 bg-amber-950/25 px-3 py-2"
          : "text-[11px] text-amber-700 dark:text-amber-400 font-medium rounded-lg border border-amber-200/80 bg-amber-50/80 dark:border-amber-900/40 dark:bg-amber-950/25 px-3 py-2"
      }
    >
      {pendingCount} 处变更待确认：在下方 diff 块点击「应用」或「拒绝」后才会更新画布（请按时间顺序确认）。
    </p>
  );
}

function ActivityBanner({
  items,
  isStreaming,
  theme,
}: {
  items: TimelineItem[];
  isStreaming: boolean;
  theme: "ide" | "home";
}) {
  if (!isStreaming) return null;
  const files = items.filter((x) => x.kind === "file").length;
  const running = items.filter(
    (x) => x.kind === "tool" && x.status === "running"
  ).length;
  const done = items.filter(
    (x) => x.kind === "tool" && x.status === "done"
  ).length;
  const logs = items.filter((x) => x.kind === "pipeline_log").length;
  const parts: string[] = [];
  if (running > 0) parts.push(`正在执行 ${running} 个工具`);
  if (done > 0) parts.push(`已完成 ${done} 个工具`);
  if (files > 0) parts.push(`已写入 ${files} 个文件`);
  if (logs > 0) parts.push(`${logs} 条流水线日志`);
  if (parts.length === 0) return null;
  return (
    <p
      className={
        theme === "ide"
          ? "animate-pulse text-[11px] font-medium text-[var(--muted)]"
          : "text-[11px] app-subtle font-medium animate-pulse"
      }
    >
      {parts.join(" · ")}
    </p>
  );
}

function ThoughtBlock({
  item,
  theme,
}: {
  item: Extract<TimelineItem, { kind: "thought" }>;
  theme: "ide" | "home";
}) {
  if (theme === "ide") {
    if (!item.content.trim() && item.streaming) {
      return (
        <div className="flex items-center gap-2 text-[11px] tracking-[-0.01em] text-[var(--muted)]">
          <Loader2 className="size-3 animate-spin text-[var(--primary)]" />
          <span>Thinking…</span>
        </div>
      );
    }

    return (
      <div className="vad-agent-thought">
        <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] tracking-[-0.01em] text-[var(--muted)]">
          <Sparkles className="size-3 shrink-0 text-[var(--primary)]" />
          <span className="font-medium">
            {item.streaming
              ? "Thinking…"
              : formatThoughtDuration(item.durationMs)}
          </span>
        </div>
        {item.content.trim() ? (
          <div className="border-t border-[var(--border)]/70 px-3 py-2 text-[12px] leading-relaxed tracking-[-0.01em] whitespace-pre-wrap text-[var(--muted-strong)]">
            {item.content}
            {item.streaming ? (
              <span className="ml-0.5 inline-block h-3 w-1 animate-pulse align-middle rounded-sm bg-[var(--primary)]/65" />
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  const border =
    "border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-[var(--surface-muted)]";

  if (!item.content.trim() && item.streaming) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
        <Loader2 className="size-3 animate-spin text-[var(--primary)]" />
        <span>思考中…</span>
      </div>
    );
  }

  return (
    <div className={`overflow-hidden rounded-lg border ${border}`}>
      <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--muted)]">
        <Sparkles className="size-3 shrink-0 text-[var(--primary)]" />
        <span className="font-medium">
          {item.streaming ? "Thinking…" : formatThoughtDuration(item.durationMs)}
        </span>
      </div>
      <div className="border-t border-inherit px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap text-[var(--muted-strong)]">
        {item.content}
        {item.streaming ? (
          <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse align-middle bg-[var(--primary)]/70" />
        ) : null}
      </div>
    </div>
  );
}

const IMAGE_TOOL_NAMES = new Set(["generate_images", "generate_image_variants"]);

function parseGeneratedCount(summary?: string): number {
  if (!summary) return 4;
  const match = summary.match(/(\d+)\s*张/);
  if (match) return Math.min(8, parseInt(match[1], 10));
  return 4;
}

function pickImageThumbnails(project: ProjectFile | undefined, count: number) {
  if (!project?.assets?.length) return [];
  return project.assets
    .filter((a) => a.src && a.status !== "discarded")
    .slice(-count);
}

function CanvasResultThumbnails({
  assets,
  theme,
}: {
  assets: NonNullable<ProjectFile["assets"]>;
  theme: "ide" | "home";
}) {
  const requestFocusAsset = useCanvasUiStore((s) => s.requestFocusAsset);

  if (assets.length === 0) return null;

  return (
    <div
      className={
        "flex flex-wrap gap-2 border-t px-3 py-2.5 " +
        (theme === "ide"
          ? "border-[var(--border)] bg-[var(--surface)]"
          : "border-[color-mix(in_srgb,var(--border)_70%,transparent)]")
      }
    >
      {assets.map((asset) => (
        <button
          key={asset.id}
          type="button"
          onClick={() => requestFocusAsset(asset.id)}
          className="group relative size-14 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] shadow-[var(--shadow-soft)] transition hover:border-[var(--primary)] hover:ring-2 hover:ring-[var(--primary)]/20"
          title="在画布中定位此素材"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset.src}
            alt={asset.prompt.slice(0, 40)}
            className="size-full object-cover transition group-hover:scale-105"
          />
        </button>
      ))}
    </div>
  );
}

function ToolBlock({
  item,
  theme,
  project,
}: {
  item: Extract<TimelineItem, { kind: "tool" }>;
  theme: "ide" | "home";
  project?: ProjectFile;
}) {
  const running = item.status === "running";
  const shell =
    theme === "ide"
      ? running
        ? "vad-agent-tool vad-agent-tool--running"
        : item.status === "error"
          ? "overflow-hidden rounded-[10px] border border-red-200/70 bg-red-50/80 dark:border-red-900/50 dark:bg-red-950/20"
          : "vad-agent-tool"
      : "border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-[var(--surface-muted)] rounded-lg border overflow-hidden";

  const showThumbs =
    !running &&
    item.status === "done" &&
    IMAGE_TOOL_NAMES.has(item.name) &&
    project;

  const thumbs = showThumbs
    ? pickImageThumbnails(project, parseGeneratedCount(item.summary))
    : [];

  return (
    <div className={shell}>
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <span
          className={
            "mt-0.5 grid size-5 shrink-0 place-items-center rounded-md " +
            (running
              ? "bg-[var(--surface)] text-[var(--primary)] shadow-[var(--shadow-soft)]"
              : item.status === "error"
                ? "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400"
                : "bg-[var(--primary)] text-white shadow-[0_1px_0_rgba(255,255,255,0.25)_inset]")
          }
        >
          {running ? (
            <Loader2 className="size-3 animate-spin" />
          ) : item.status === "error" ? (
            <XCircle className="size-3" />
          ) : (
            <Check className="size-3" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11.5px] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
            {item.label}
          </p>
          {item.summary ? (
            <p className="mt-0.5 line-clamp-2 text-[11px] tracking-[-0.01em] text-[var(--muted)]">
              {item.summary}
            </p>
          ) : running ? (
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">执行中…</p>
          ) : null}
        </div>
      </div>
      {showThumbs && thumbs.length > 0 ? (
        <CanvasResultThumbnails assets={thumbs} theme={theme} />
      ) : null}
    </div>
  );
}

function AgentPlanBlock({
  item,
  theme,
}: {
  item: Extract<TimelineItem, { kind: "agent_plan" }>;
  theme: "ide" | "home";
}) {
  const done = item.steps.filter((step) => step.status === "done").length;
  const failed = item.steps.filter((step) => step.status === "error").length;
  const shell =
    theme === "ide"
      ? "border-[var(--border)] bg-[var(--surface-muted)]"
      : "border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-[var(--surface-muted)]";

  return (
    <div className={`rounded-lg border overflow-hidden ${shell}`}>
      <div className="flex items-center justify-between gap-3 border-b border-inherit px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <ListChecks className="size-3.5 shrink-0 text-[var(--primary)]" />
          <span className="text-[11px] font-semibold app-strong">
            Agent 执行计划
          </span>
        </div>
        <span className="shrink-0 text-[9px] font-mono app-subtle">
          {done}/{item.steps.length}
          {failed ? ` · ${failed} 失败` : ""}
        </span>
      </div>
      <div className="space-y-1.5 px-3 py-2.5">
        {item.steps.map((step, index) => {
          const running = step.status === "running";
          const error = step.status === "error";
          return (
            <div
              key={step.id}
              className="flex items-start gap-2.5 rounded-md px-1 py-1"
            >
              <span
                className={
                  "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full " +
                  (running
                    ? "bg-[var(--primary-soft)] text-[var(--primary)]"
                    : error
                      ? "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400"
                      : step.status === "done"
                        ? "bg-[var(--primary)] text-white"
                        : "bg-[var(--surface)] text-[var(--muted)]")
                }
              >
                {running ? (
                  <Loader2 className="size-2.5 animate-spin" />
                ) : error ? (
                  <XCircle className="size-2.5" />
                ) : step.status === "done" ? (
                  <Check className="size-2.5" />
                ) : (
                  <Circle className="size-2" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[9px] text-[var(--muted)]">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <p className="truncate text-[11px] font-medium text-[var(--foreground)]">
                    {step.label}
                  </p>
                </div>
                {step.summary ? (
                  <p className="mt-0.5 line-clamp-2 text-[10px] text-[var(--muted)]">
                    {step.summary}
                  </p>
                ) : null}
              </div>
              {step.durationMs != null ? (
                <span className="shrink-0 pt-0.5 font-mono text-[9px] text-[var(--muted)]">
                  {Math.max(1, Math.round(step.durationMs / 1000))}s
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CodeDiffBlock({
  item,
  theme,
  decision,
  previewMode,
  onAccept,
  onReject,
  onUndoAccept,
}: {
  item: Extract<TimelineItem, { kind: "code_diff" }>;
  theme: "ide" | "home";
  decision?: DiffDecision;
  /** IDE 需确认后再应用 */
  previewMode?: boolean;
  onAccept?: (toolCallId: string) => void;
  onReject?: (toolCallId: string) => void;
  onUndoAccept?: (toolCallId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const toolId = item.toolCallId;
  const showPreviewActions =
    previewMode && !!toolId && !!onAccept && !!onReject && decision === "pending";
  const showUndo =
    previewMode && !!toolId && !!onUndoAccept && decision === "accepted";
  const payload: CodeDiffPayload = {
    path: item.path,
    language: item.language,
    oldText: item.oldText,
    newText: item.newText,
    summary: item.summary,
  };
  const lines = buildDiffLines(payload.oldText, payload.newText);
  const border =
    theme === "ide"
      ? "border-zinc-800 bg-zinc-900/60"
      : "border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-[var(--surface-muted)]";

  return (
    <div className={`rounded-lg border overflow-hidden ${border}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px]"
      >
        <GitCompare className="size-3.5 shrink-0 text-[#B5A075]" />
        <span className="font-mono truncate flex-1 app-strong">{item.path}</span>
        {open ? (
          <ChevronDown className="size-3.5 shrink-0 opacity-50" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 opacity-50" />
        )}
      </button>
      {open ? (
        <div className="border-t border-inherit">
          {item.summary ? (
            <p className="px-3 py-1.5 text-[10px] app-subtle">{item.summary}</p>
          ) : null}
          <pre className="max-h-48 overflow-auto px-3 py-2 text-[10px] font-mono leading-relaxed">
            {lines.map((line, i) => (
              <div
                key={`${line.kind}-${i}`}
                className={
                  line.kind === "add"
                    ? "text-emerald-500/90 bg-emerald-950/30"
                    : line.kind === "remove"
                      ? "text-red-400/90 bg-red-950/25"
                      : "text-zinc-500"
                }
              >
                {line.kind === "add" ? "+ " : line.kind === "remove" ? "- " : "  "}
                {line.text}
              </div>
            ))}
          </pre>
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-inherit">
            <p className="text-[9px] app-subtle">
              {previewMode
                ? decision === "accepted"
                  ? "已应用至画布"
                  : decision === "rejected"
                    ? "已拒绝，未写入项目"
                    : "预览中 · 确认后才会写入画布"
                : "变更已应用"}
            </p>
            <div className="flex shrink-0 items-center gap-1.5">
              {showPreviewActions ? (
                <>
                  <button
                    type="button"
                    onClick={() => onReject!(toolId!)}
                    className="rounded-md border border-zinc-700 bg-zinc-900/80 px-2 py-1 text-[9px] font-medium text-zinc-400 hover:text-zinc-200"
                  >
                    拒绝
                  </button>
                  <button
                    type="button"
                    onClick={() => onAccept!(toolId!)}
                    className="rounded-md border border-emerald-800/50 bg-emerald-950/40 px-2 py-1 text-[9px] font-medium text-emerald-300/90 hover:bg-emerald-900/50"
                  >
                    应用
                  </button>
                </>
              ) : null}
              {showUndo ? (
                <button
                  type="button"
                  onClick={() => onUndoAccept!(toolId!)}
                  className="rounded-md border border-amber-800/50 bg-amber-950/30 px-2 py-1 text-[9px] font-medium text-amber-200/90 hover:bg-amber-900/40"
                >
                  撤销应用
                </button>
              ) : null}
              {previewMode && decision === "rejected" ? (
                <span className="text-[9px] text-zinc-500">已拒绝</span>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PipelineLogLine({
  entry,
  theme,
}: {
  entry: PipelineLogEntry;
  theme: "ide" | "home";
}) {
  const stageLabel = entry.stage
    ? PIPELINE_STAGE_LABELS[entry.stage] ?? entry.stage
    : "";
  const levelClass =
    theme === "ide"
      ? LOG_LEVEL_CLASS[entry.level]
      : LOG_LEVEL_HOME[entry.level];

  return (
    <div
      className={
        "flex gap-2 pl-2 border-l text-[10px] font-mono leading-relaxed " +
        (theme === "ide" ? "border-zinc-800/80" : "border-[var(--border)]")
      }
    >
      <span className="shrink-0 opacity-60">{formatLogTime(entry.at)}</span>
      {stageLabel ? (
        <span className="shrink-0 opacity-60 max-w-[88px] truncate">{stageLabel}</span>
      ) : null}
      <span className={levelClass ?? "app-subtle"}>
        {entry.message}
        {entry.durationMs != null ? ` (${entry.durationMs}ms)` : ""}
      </span>
    </div>
  );
}

function TimelineRow({
  item,
  theme,
  project,
  diffDecisions,
  diffPreviewMode,
  onAcceptDiff,
  onRejectDiff,
  onUndoAcceptDiff,
}: {
  item: TimelineItem;
  theme: "ide" | "home";
  project?: ProjectFile;
  diffDecisions?: Map<string, DiffDecision>;
  diffPreviewMode?: boolean;
  onAcceptDiff?: (toolCallId: string) => void;
  onRejectDiff?: (toolCallId: string) => void;
  onUndoAcceptDiff?: (toolCallId: string) => void;
}) {
  switch (item.kind) {
    case "user":
      return (
        <div
          className={
            theme === "ide"
              ? "vad-agent-msg-user"
              : "rounded-xl border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-[var(--surface-muted)] px-3.5 py-3 text-[13px] font-medium app-strong"
          }
        >
          {item.content}
        </div>
      );
    case "thought":
      return <ThoughtBlock item={item} theme={theme} />;
    case "agent_plan":
      return <AgentPlanBlock item={item} theme={theme} />;
    case "tool":
      return <ToolBlock item={item} theme={theme} project={project} />;
    case "file":
      return (
        <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--muted-strong)]">
          <FileCode2 className="size-3 shrink-0 text-[var(--primary)]" />
          <span className="truncate">{item.path}</span>
        </div>
      );
    case "assistant":
      return (
        <div
          className={
            theme === "ide"
              ? "vad-agent-msg-assistant whitespace-pre-wrap"
              : "whitespace-pre-wrap text-[13px] leading-[1.6] text-[var(--foreground)]"
          }
        >
          {item.content}
          {item.streaming ? (
            <span className="ml-0.5 inline-block h-3 w-1 animate-pulse align-middle rounded-sm bg-[var(--primary)]/65" />
          ) : null}
        </div>
      );
    case "pipeline_log":
      return <PipelineLogLine entry={item.entry} theme={theme} />;
    case "code_diff":
      return (
        <CodeDiffBlock
          item={item}
          theme={theme}
          previewMode={diffPreviewMode}
          decision={
            item.toolCallId && diffDecisions?.has(item.toolCallId)
              ? diffDecisions.get(item.toolCallId)
              : undefined
          }
          onAccept={onAcceptDiff}
          onReject={onRejectDiff}
          onUndoAccept={onUndoAcceptDiff}
        />
      );
    case "handoff":
      return (
        <div
          className={
            "space-y-2 rounded-lg border px-3 py-2.5 " +
            (theme === "ide"
              ? "border-[var(--primary)]/25 bg-[var(--primary-soft)]"
              : "border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-[var(--surface-muted)]")
          }
        >
          <p className="text-[11px] font-medium text-[var(--primary)]">
            Handoff 包已触发下载（{item.target}，{item.fileCount} 个文件）
          </p>
          <McpQuickCopy compact />
        </div>
      );
    case "error":
      return (
        <div className="rounded-lg border border-red-200/80 bg-red-50/90 px-3 py-2 font-mono text-[11px] text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {item.message}
        </div>
      );
    default:
      return null;
  }
}

export function ChatTimelineBody({
  messages,
  liveEvents,
  isStreaming,
  error,
  theme = "ide",
  project,
  maxHeight = "min(420px, 50vh)",
  fillHeight = false,
  className = "",
  diffDecisions,
  diffPreviewMode,
  onAcceptDiff,
  onRejectDiff,
  onUndoAcceptDiff,
}: {
  messages: ChatMessage[];
  liveEvents: ChatLiveEvent[];
  isStreaming: boolean;
  error?: string | null;
  theme?: "ide" | "home";
  project?: ProjectFile;
  maxHeight?: string;
  /** IDE 侧栏内占满剩余高度 */
  fillHeight?: boolean;
  className?: string;
  diffDecisions?: Map<string, DiffDecision>;
  /** true = IDE Chat，diff 需用户确认后再 upsert */
  diffPreviewMode?: boolean;
  onAcceptDiff?: (toolCallId: string) => void;
  onRejectDiff?: (toolCallId: string) => void;
  onUndoAcceptDiff?: (toolCallId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const timeline = useMemo(
    () => buildChatTimeline(messages, liveEvents, isStreaming),
    [messages, liveEvents, isStreaming]
  );

  const pendingPreviewCount = useMemo(() => {
    if (!diffPreviewMode || !diffDecisions) return 0;
    const ids = new Set<string>();
    for (const item of timeline) {
      if (item.kind === "code_diff" && item.toolCallId) {
        ids.add(item.toolCallId);
      }
    }
    let n = 0;
    for (const id of ids) {
      if (diffDecisions.has(id) && diffDecisions.get(id) === "pending") n++;
    }
    return n;
  }, [timeline, diffDecisions, diffPreviewMode]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [timeline.length, isStreaming, liveEvents.length]);

  if (
    timeline.length === 0 &&
    !isStreaming &&
    !error &&
    messages.length === 0
  ) {
    return null;
  }

  const shell =
    theme === "ide"
      ? "bg-[var(--surface)]"
      : "app-card rounded-xl border app-border overflow-hidden";

  return (
    <div
      className={`${shell} ${className}${fillHeight ? " flex flex-col min-h-0" : ""}`}
    >
      {theme === "home" ? (
        <div className="border-b app-border px-4 py-2.5 flex items-center justify-between">
          <p className="text-xs font-bold app-strong">生成进度（流式）</p>
          {isStreaming ? (
            <span className="flex items-center gap-1 text-[10px] font-mono text-[#B5A075]">
              <Loader2 className="size-3 animate-spin" />
              运行中
            </span>
          ) : null}
        </div>
      ) : null}
      <div
        ref={scrollRef}
        className={
          (theme === "ide"
            ? "space-y-4 overflow-y-auto scroll-smooth px-4 py-4"
            : "space-y-2.5 overflow-y-auto scroll-smooth bg-[var(--surface)] px-4 py-3") +
          (fillHeight ? " min-h-0 flex-1" : "")
        }
        style={fillHeight ? undefined : { maxHeight }}
      >
        <ActivityBanner items={timeline} isStreaming={isStreaming} theme={theme} />
        <PendingDiffBanner pendingCount={pendingPreviewCount} theme={theme} />
        {timeline.map((item) => (
          <TimelineRow
            key={item.id}
            item={item}
            theme={theme}
            project={project}
            diffDecisions={diffDecisions}
            diffPreviewMode={diffPreviewMode}
            onAcceptDiff={onAcceptDiff}
            onRejectDiff={onRejectDiff}
            onUndoAcceptDiff={onUndoAcceptDiff}
          />
        ))}
        {error ? (
          <div className="rounded-lg border border-red-200/80 bg-red-50/90 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
