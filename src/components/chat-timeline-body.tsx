"use client";

/**
 * Chat / 生成流水线共用时间线渲染
 * --------------------------------------------------------------
 * IDE 助理栏与首页一键生成共用，支持 ide | home 主题。
 *
 * @author：wangjunhua
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ArrowDown,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock3,
  Copy,
  FileCode2,
  GitCompare,
  HelpCircle,
  Layers,
  ListChecks,
  Loader2,
  Pencil,
  PencilLine,
  Play,
  RotateCcw,
  Send,
  Square,
  Sparkles,
  Terminal,
  XCircle,
} from "lucide-react";
import { buildDiffLines, type CodeDiffPayload } from "@/lib/chat/code-diff";
import type { DiffDecision } from "@/lib/chat/diff-preview";
import {
  extractImageToolThumbRefs,
  imageJobCoversToolPreview,
  mergeJobThumbRefs,
  pickGeneratingImageThumbs,
  pickImageThumbnails,
} from "@/lib/chat/image-tool-thumbnails";
import { McpQuickCopy } from "@/components/mcp-quick-copy";
import {
  ImageLightbox,
  PreviewableThumb,
  type ImageLightboxItem,
} from "@/components/image-lightbox";
import { GeneratingArtworkFace } from "@/components/generating-artwork-face";
import { MarkdownText } from "@/components/markdown-text";
import type { ChatMessage } from "@/lib/agents/chat-schema";
import type { ImageAsset } from "@/lib/project/assets-schema";
import type { ProjectFile } from "@/lib/project/schema";
import { displayAssetTitle } from "@/lib/project/asset-title";
import { useCanvasUiStore } from "@/store/canvas-ui-store";
import { useProjectStore } from "@/store/project-store";
import {
  PIPELINE_STAGE_LABELS,
  type PipelineLogEntry,
} from "@/lib/agents/pipeline-logger";
import type { ChatLiveEvent } from "@/lib/chat/chat-live-event";
import {
  buildChatTimelineTurns,
  type TimelineItem,
  type TimelineTurn,
} from "@/lib/chat/live-timeline";
import { latestThoughtPreview } from "@/lib/chat/thought-message";
import {
  DIRECTION_ADJUST_MESSAGE,
  formatDiscoveryAnswerMessage,
  isDiscoveryAnswerFilled,
  mergeDiscoveryCustomAnswers,
} from "@/lib/agents/discovery-gate";

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

const TURN_WINDOW_SIZE = 28;
const TURN_OVERSCAN = 6;
const ESTIMATED_TURN_HEIGHT = 188;

function formatThoughtDuration(ms?: number): string {
  if (!ms || ms < 1000) return "思考了 1s";
  const s = Math.round(ms / 1000);
  return `思考了 ${s}s`;
}

async function copyText(text: string): Promise<boolean> {
  const value = text.trim();
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function MessageActionBar({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="pointer-events-none absolute -top-2 right-1 z-[1] flex items-center gap-0.5 rounded-md border border-[var(--border)]/80 bg-[var(--surface)] p-0.5 opacity-0 shadow-[var(--shadow-soft)] transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
      {children}
    </div>
  );
}

function MessageActionButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-tip={label}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="grid size-6 place-items-center rounded text-[var(--muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
    >
      {children}
    </button>
  );
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

function normalizeUiError(message: string): string {
  return message.trim().replace(/\s+/g, " ").toLowerCase();
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

function ErrorRecoveryCard({
  message,
  theme,
  retry,
  retryPhase,
}: {
  message: string;
  theme: "ide" | "home";
  retry?: () => void;
  retryPhase?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const ok = await copyText(message);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className={theme === "ide" ? "rounded-lg border border-red-300/70 bg-red-50/80 px-3 py-2.5 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200" : "rounded-lg border border-red-200/80 bg-red-50/90 px-3 py-2.5 text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"} role="alert">
      <div className="flex items-start gap-2">
        <XCircle className="mt-0.5 size-3.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold">本轮执行没有完成</p>
          <p className="mt-1 break-words text-[11px] leading-relaxed opacity-85">{message}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {retryPhase ? <button type="button" onClick={retryPhase} className="rounded-md bg-red-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-red-700">重试当前阶段</button> : null}
            {retry ? <button type="button" onClick={retry} className="rounded-md border border-current/20 px-2 py-1 text-[10px] font-medium hover:bg-black/5 dark:hover:bg-white/5">重试上一条</button> : null}
            <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1 rounded-md border border-current/20 px-2 py-1 text-[10px] hover:bg-black/5 dark:hover:bg-white/5"><Copy className="size-3" />{copied ? "已复制" : "复制错误"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActivityBanner({
  liveEvents,
  isStreaming,
  theme,
}: {
  liveEvents: ChatLiveEvent[];
  isStreaming: boolean;
  theme: "ide" | "home";
}) {
  if (!isStreaming) return null;
  const runningToolIds = new Set<string>();
  const doneToolIds = new Set<string>();
  const activeJobIds = new Set<string>();
  let files = 0;
  let logs = 0;

  for (const ev of liveEvents) {
    if (ev.type === "tool_call") {
      const id = String((ev.data as { id?: string })?.id ?? "");
      if (id) runningToolIds.add(id);
    } else if (ev.type === "tool_result") {
      const id = String((ev.data as { id?: string })?.id ?? "");
      if (id) {
        runningToolIds.delete(id);
        doneToolIds.add(id);
      }
    } else if (ev.type === "file_write") {
      files++;
    } else if (ev.type === "pipeline_log") {
      logs++;
    } else if (
      ev.type === "job.queued" ||
      ev.type === "job.started" ||
      ev.type === "job.progress"
    ) {
      const jobId = String((ev.data as { jobId?: string })?.jobId ?? "");
      if (jobId) activeJobIds.add(jobId);
    } else if (
      ev.type === "job.completed" ||
      ev.type === "job.failed" ||
      ev.type === "job.cancelled"
    ) {
      const jobId = String((ev.data as { jobId?: string })?.jobId ?? "");
      if (jobId) activeJobIds.delete(jobId);
    }
  }

  const parts: string[] = [];
  if (runningToolIds.size > 0) parts.push(`Running ${runningToolIds.size} tools`);
  if (activeJobIds.size > 0) parts.push(`Running ${activeJobIds.size} jobs`);
  if (doneToolIds.size > 0) parts.push(`Done ${doneToolIds.size} tools`);
  if (files > 0) parts.push(`Wrote ${files} files`);
  if (logs > 0) parts.push(`${logs} pipeline logs`);
  if (parts.length === 0) return null;
  return (
    <p
      className={
        theme === "ide"
          ? "animate-pulse text-[11px] font-medium text-[var(--muted)]"
          : "text-[11px] app-subtle font-medium animate-pulse"
      }
    >
      {parts.join(" - ")}
    </p>
  );
}

function CollapsibleThoughtBlock({
  item,
  theme,
}: {
  item: Extract<TimelineItem, { kind: "thought" }>;
  theme: "ide" | "home";
}) {
  const hasContent = Boolean(item.content.trim());
  const [expanded, setExpanded] = useState(false);
  const streaming = Boolean(item.streaming);
  const preview = latestThoughtPreview(item.content);
  const label = streaming
    ? "思考中"
    : formatThoughtDuration(item.durationMs);
  const isIde = theme === "ide";
  const showPreview = !expanded && Boolean(preview);

  if (!hasContent && !streaming) return null;

  const shell = isIde
    ? "vad-agent-thought"
    : "overflow-hidden rounded-lg border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-[var(--surface-muted)]";
  const bodyClass = isIde
    ? "vad-agent-thought__body"
    : "border-t border-inherit px-3 py-2 text-[12px] leading-relaxed text-[var(--muted-strong)]";

  return (
    <div className={shell}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="vad-agent-thought__toggle"
      >
        {expanded ? (
          <ChevronDown className="size-3 shrink-0 opacity-70" />
        ) : (
          <ChevronRight className="size-3 shrink-0 opacity-70" />
        )}
        <span
          className={
            "vad-agent-thought__label" +
            (streaming ? " vad-agent-thought__label--live" : "")
          }
        >
          {label}
        </span>
        {showPreview ? (
          <span className="vad-agent-thought__preview">
            <span className="vad-agent-thought__preview-inner">{preview}</span>
          </span>
        ) : null}
      </button>
      {hasContent && expanded ? (
        <div className={bodyClass}>
          <MarkdownText content={item.content} />
          {streaming ? (
            <span className="vad-agent-stream-caret" aria-hidden />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const IMAGE_TOOL_NAMES = new Set([
  "generate_images",
  "generate_image_variants",
  "restyle_page_images",
]);

function formatTurnSummary(turn: TimelineTurn): string | null {
  if (turn.status === "running" || turn.status === "waiting" || turn.status === "idle") {
    return null;
  }
  const parts: string[] = [];
  if (turn.counts.tools > 0) parts.push(`${turn.counts.tools} 个工具`);
  const imageDone = turn.items
    .filter(
      (item): item is Extract<TimelineItem, { kind: "job" }> =>
        item.kind === "job" &&
        item.status === "completed" &&
        (item.jobType === "image_generation" ||
          item.jobType === "direct_image_generation" ||
          item.jobType === "materialize_slots")
    )
    .reduce((sum, job) => sum + Math.max(job.completed, job.total > 0 ? job.total : 0), 0);
  const imageToolDone = turn.items.some(
    (item) =>
      item.kind === "tool" &&
      item.status === "done" &&
      (item.name === "generate_images" ||
        item.name === "generate_image_variants" ||
        item.name === "materialize_mockup")
  );
  const materializeDone = turn.items.some(
    (item) =>
      item.kind === "job" &&
      item.status === "completed" &&
      item.jobType === "materialize_slots"
  );
  const imageFailed = turn.items.some(
    (item) =>
      item.kind === "job" &&
      item.status === "failed" &&
      (item.jobType === "image_generation" ||
        item.jobType === "direct_image_generation" ||
        item.jobType === "materialize_slots")
  );
  if (imageFailed) parts.push("生图失败");
  else if (imageDone > 0) parts.push(`${imageDone} 张图`);
  else if (imageToolDone) parts.push("已生图");
  if (turn.counts.jobs > 0 && imageDone === 0 && !materializeDone) {
    parts.push(`${turn.counts.jobs} 个任务`);
  }
  if (turn.counts.changes > 0) parts.push(`${turn.counts.changes} 处变更`);
  if (turn.counts.errors > 0) parts.push(`${turn.counts.errors} 个错误`);
  if (turn.startedAt) {
    const endMs = Math.max(
      turn.startedAt,
      ...turn.items.map((item) => {
        if (item.kind === "tool" && item.startedAt) {
          return item.startedAt + (item.durationMs ?? 0);
        }
        if (item.kind === "job" && item.startedAt) {
          return item.startedAt + (item.durationMs ?? 0);
        }
        return turn.startedAt ?? 0;
      })
    );
    const sec = Math.max(1, Math.round((endMs - turn.startedAt) / 1000));
    parts.push(`${sec}s`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function parentGhostSrc(
  project: ProjectFile | undefined,
  parentAssetId?: string
): string | undefined {
  if (!parentAssetId) return undefined;
  const parent = project?.assets?.find((asset) => asset.id === parentAssetId);
  if (!parent?.src?.trim() || parent.src.startsWith("data:image/svg+xml")) {
    return undefined;
  }
  return parent.src;
}

function SidebarImageResults({
  ready,
  generating,
  project,
  theme,
}: {
  ready: ImageAsset[];
  generating: ImageAsset[];
  project?: ProjectFile;
  theme: "ide" | "home";
}) {
  if (ready.length === 0 && generating.length === 0) return null;
  return (
    <div className="space-y-2 px-1.5 pb-2">
      {generating.map((asset) => (
        <div
          key={asset.id}
          className="aspect-[4/3] overflow-hidden rounded-md border border-[var(--border)]"
        >
          <GeneratingArtworkFace
            ghostSrc={parentGhostSrc(project, asset.parentAssetId)}
          />
        </div>
      ))}
      {ready.length > 0 ? (
        <CanvasResultThumbnails assets={ready} theme={theme} />
      ) : null}
    </div>
  );
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
  const isIde = theme === "ide";

  return (
    <div
      className={
        isIde
          ? "flex flex-wrap gap-1.5 px-2 pb-1.5 pt-0.5"
          : "flex flex-wrap gap-2 border-t border-[color-mix(in_srgb,var(--border)_70%,transparent)] px-3 py-2.5"
      }
    >
      {assets.map((asset, index) => (
        <button
          key={`${asset.id}:${asset.batchId ?? "no-batch"}:${asset.createdAt}:${index}`}
          type="button"
          onClick={() => requestFocusAsset(asset.id)}
          className={
            "group relative overflow-hidden border border-[var(--border)] bg-[var(--surface-muted)] transition hover:border-[var(--primary)] hover:ring-2 hover:ring-[var(--primary)]/20 " +
            (isIde
              ? "size-16 rounded-md"
              : "size-14 rounded-lg shadow-[var(--shadow-soft)]")
          }
          title="在画布中定位此素材"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset.src}
            alt={displayAssetTitle(asset)}
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
  hideThumbs = false,
}: {
  item: Extract<TimelineItem, { kind: "tool" }>;
  theme: "ide" | "home";
  project?: ProjectFile;
  hideThumbs?: boolean;
}) {
  const running = item.status === "running";
  const isImageTool = IMAGE_TOOL_NAMES.has(item.name);
  // 生图类工具：侧栏只展示摘要 + 缩略图，不展开裸 JSON args/output
  const hasDetails = isImageTool
    ? Boolean(item.artifacts?.length)
    : Boolean(item.args || item.output || item.artifacts?.length);
  // 失败默认展开；成功保持一行，细节按需展开
  const [expanded, setExpanded] = useState(item.status === "error");
  const [preview, setPreview] = useState<ImageLightboxItem | null>(null);
  const isIde = theme === "ide";
  const isMaterializeTool = item.name === "materialize_mockup";
  const materializeAssetId =
    typeof item.args?.targetAssetId === "string"
      ? item.args.targetAssetId
      : typeof item.args?.assetId === "string"
        ? item.args.assetId
        : typeof item.args?.mockupAssetId === "string"
          ? item.args.mockupAssetId
          : undefined;
  const materializeCtx = isMaterializeTool
    ? resolveMaterializeContext(project, materializeAssetId)
    : null;
  const shell = isIde
    ? item.status === "error"
      ? "overflow-hidden rounded-md border border-red-200/70 bg-red-50/60 dark:border-red-900/50 dark:bg-red-950/20"
      : isMaterializeTool
        ? "overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-muted)]/35"
        : "overflow-hidden rounded-md border border-transparent hover:border-[var(--border)]/80"
    : running
      ? "vad-agent-tool vad-agent-tool--running"
      : item.status === "error"
        ? "overflow-hidden rounded-[10px] border border-red-200/70 bg-red-50/80 dark:border-red-900/50 dark:bg-red-950/20"
        : "border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-[var(--surface-muted)] rounded-lg border overflow-hidden";

  const thumbRefs = IMAGE_TOOL_NAMES.has(item.name)
    ? extractImageToolThumbRefs(item.output, item.summary)
    : null;
  const generatingThumbs =
    thumbRefs && project && !hideThumbs
      ? pickGeneratingImageThumbs(project, thumbRefs)
      : [];
  const readyThumbs =
    thumbRefs && project && !hideThumbs
      ? pickImageThumbnails(project, thumbRefs)
      : [];
  const showThumbs = readyThumbs.length > 0 || generatingThumbs.length > 0;

  const statusLabel = running
    ? "运行中"
    : item.status === "error"
      ? "失败"
      : "完成";

  if (isMaterializeTool) {
    return (
      <div className={shell}>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-2.5 px-2 py-2 text-left hover:bg-[var(--surface-muted)]/60"
        >
          {materializeCtx?.mockup?.src ? (
            <PreviewableThumb
              src={materializeCtx.mockup.src}
              className="size-11 rounded-md"
              title={`拆解 ${materializeCtx.mockup.id.slice(0, 10)}`}
              subtitle={
                materializeCtx.mockup.width
                  ? `${materializeCtx.mockup.width}×${materializeCtx.mockup.height}`
                  : undefined
              }
              onPreview={setPreview}
            />
          ) : (
            <span className="grid size-11 shrink-0 place-items-center rounded-md border border-[var(--border)] bg-[var(--background)]">
              {running ? (
                <Loader2 className="size-3.5 animate-spin text-[var(--primary)]" />
              ) : (
                <Layers className="size-3.5 text-[var(--primary)]" />
              )}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-[11.5px] font-semibold">
              {running ? (
                <Loader2 className="size-3 animate-spin text-[var(--primary)]" />
              ) : item.status === "error" ? (
                <XCircle className="size-3 text-red-600" />
              ) : (
                <Check className="size-3 text-emerald-600" />
              )}
              {item.label}
              <span className="font-medium text-[var(--muted)]">
                · {statusLabel}
              </span>
            </span>
            <span className="mt-0.5 block truncate font-mono text-[10px] app-subtle">
              {materializeCtx?.mockup
                ? `${materializeCtx.mockup.id.slice(0, 10)} · 媒 ${materializeCtx.mediaReady}/${materializeCtx.mediaTotal} · 码 ${materializeCtx.codeTotal}`
                : item.summary?.slice(0, 64) || "Vision 拆解 Layout IR"}
            </span>
            {running ? (
              <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-[var(--border)]">
                <span className="block h-full w-2/3 animate-pulse rounded-full bg-[var(--primary)]" />
              </span>
            ) : null}
          </span>
          {expanded ? (
            <ChevronDown className="size-3.5 shrink-0 text-[var(--muted)]" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-[var(--muted)]" />
          )}
        </button>
        {expanded ? (
          <div className="space-y-2 border-t border-[var(--border)]/70 px-2 py-2">
            {running ? (
              <div className="rounded-md border border-[#2a2d36] bg-[#12141a] px-2 py-1.5 font-mono text-[10px] text-[#b7f0c5]">
                <p className="text-[#8ec7ff]">$ decompose --vision</p>
                <p>{">"} reading mockup pixels…</p>
                <p>{">"} classifying media vs code regions…</p>
                <p className="animate-pulse">▌</p>
              </div>
            ) : null}
            {item.summary ? (
              <p className="text-[11px] text-[var(--muted-strong)]">{item.summary}</p>
            ) : null}
            {materializeCtx && materializeCtx.materials.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {materializeCtx.materials.slice(0, 6).map((mat) => (
                  <PreviewableThumb
                    key={mat.id}
                    src={mat.src}
                    className="size-10 rounded"
                    title={mat.id.slice(0, 10)}
                    onPreview={setPreview}
                  />
                ))}
              </div>
            ) : null}
            {item.args ? (
              <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words text-[10px] app-subtle">
                {JSON.stringify(item.args, null, 2)}
              </pre>
            ) : null}
          </div>
        ) : null}
        <ImageLightbox item={preview} onClose={() => setPreview(null)} />
      </div>
    );
  }

  return (
    <div className={shell}>
      <button
        type="button"
        disabled={!hasDetails}
        onClick={() => hasDetails && setExpanded((value) => !value)}
        className={
          "flex w-full items-center gap-2 px-1.5 py-1 text-left " +
          (hasDetails ? "hover:bg-[var(--surface-muted)]/70" : "")
        }
      >
        <span
          className={
            "grid size-3.5 shrink-0 place-items-center " +
            (running
              ? "text-[var(--muted-strong)]"
              : item.status === "error"
                ? "text-red-600 dark:text-red-400"
                : "text-[var(--muted)]")
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
        <span className="min-w-0 flex-1 truncate text-[11px] tracking-[-0.01em] text-[var(--muted-strong)]">
          <span className="font-medium text-[var(--foreground)]/90">{item.label}</span>
          <span className="text-[var(--muted)]"> · {statusLabel}</span>
          {!expanded && item.summary ? (
            <span className="text-[var(--muted)]">
              {" "}
              · {item.summary.replace(/\s+/g, " ").slice(0, 72)}
            </span>
          ) : null}
          {!expanded && item.durationMs && item.durationMs >= 1000 ? (
            <span className="ml-1 text-[var(--muted)]">· {Math.round(item.durationMs / 100) / 10}s</span>
          ) : null}
        </span>
        {hasDetails ? (
          expanded ? (
            <ChevronDown className="size-3.5 shrink-0 text-[var(--muted)]" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-[var(--muted)]" />
          )
        ) : null}
      </button>
      {expanded && hasDetails ? (
        <div className="border-t border-[var(--border)]/70 px-2.5 py-2 text-[10px] text-[var(--muted)]">
          {item.summary ? (
            <p className="mb-2 text-[11px] text-[var(--muted-strong)]">{item.summary}</p>
          ) : null}
          {item.artifacts?.length ? (
            <div className="mb-2 flex flex-wrap gap-2">
              {item.artifacts.map((artifact) => artifact.url ? (
                <a key={artifact.url} href={artifact.url} target="_blank" rel="noreferrer" className="block size-16 overflow-hidden rounded-md border border-[var(--border)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={artifact.url} alt={artifact.title ?? `${item.label} 产物`} className="size-full object-cover" />
                </a>
              ) : null)}
            </div>
          ) : null}
          {!isImageTool && item.args ? (
            <pre className="mb-2 max-h-32 overflow-auto whitespace-pre-wrap break-words">
              {JSON.stringify(item.args, null, 2)}
            </pre>
          ) : null}
          {!isImageTool && item.output ? (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words">
              {typeof item.output === "string"
                ? item.output
                : JSON.stringify(item.output, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}
      {showThumbs ? (
        <SidebarImageResults
          ready={readyThumbs}
          generating={generatingThumbs}
          project={project}
          theme={theme}
        />
      ) : null}
    </div>
  );
}

function resolveMaterializeContext(
  project: ProjectFile | undefined,
  assetId?: string
): {
  mockup?: ImageAsset;
  materials: ImageAsset[];
  mediaReady: number;
  mediaTotal: number;
  codeTotal: number;
} {
  if (!project) {
    return { materials: [], mediaReady: 0, mediaTotal: 0, codeTotal: 0 };
  }
  const mockup =
    (assetId
      ? project.assets?.find((a) => a.id === assetId)
      : undefined) ??
    project.assets?.find(
      (a) =>
        a.src &&
        a.source !== "materialized" &&
        Boolean(project.materializations?.[a.id])
    );
  const record = mockup
    ? project.materializations?.[mockup.id]
    : undefined;
  const materials: ImageAsset[] = [];
  let mediaReady = 0;
  let mediaTotal = 0;
  let codeTotal = 0;
  if (record) {
    for (const node of record.layout.nodes) {
      if (node.rebuildInCode === true) {
        codeTotal += 1;
        continue;
      }
      mediaTotal += 1;
      if (node.status === "ready" && node.materialAssetId) {
        mediaReady += 1;
        const mat = project.assets?.find((a) => a.id === node.materialAssetId);
        if (mat?.src) materials.push(mat);
      }
    }
  }
  return { mockup, materials, mediaReady, mediaTotal, codeTotal };
}

function MaterializeJobCard({
  item,
  project,
  onCancelJob,
  onRetryJob,
}: {
  item: Extract<TimelineItem, { kind: "job" }>;
  project?: ProjectFile;
  onCancelJob?: (jobId: string) => void;
  onRetryJob?: (jobId: string) => void;
}) {
  const [expanded, setExpanded] = useState(
    item.status === "queued" ||
      item.status === "running" ||
      item.status === "failed"
  );
  const [preview, setPreview] = useState<ImageLightboxItem | null>(null);
  const [tick, setTick] = useState(0);
  const active = item.status === "queued" || item.status === "running";
  const failed = item.status === "failed";
  const cancelled = item.status === "cancelled";
  const ctx = resolveMaterializeContext(project, item.assetId);
  const progress = Math.max(active ? 4 : 0, Math.min(100, item.progress || 0));
  const countSummary =
    item.total > 0
      ? `${item.completed}/${item.total}`
      : ctx.mediaTotal > 0
        ? `${ctx.mediaReady}/${ctx.mediaTotal}`
        : "";

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 700);
    return () => window.clearInterval(id);
  }, [active]);

  const stageLines = useMemo(() => {
    const idShort = (ctx.mockup?.id ?? item.assetId ?? item.jobId).slice(0, 8);
    const lines = [
      `$ materialize --mockup ${idShort}`,
      item.status === "queued" ? "> queued · waiting for worker…" : "> worker attached",
    ];
    if (item.status !== "queued") {
      lines.push("> resolve layout IR + style lock");
    }
    if (item.stage === "generating" || item.status === "running" || item.status === "completed") {
      lines.push(
        `> generate slots ${item.completed}/${Math.max(item.total, 1)}` +
          (item.failed ? ` · failed ${item.failed}` : "")
      );
    }
    if (item.stage === "persisting" || item.status === "completed") {
      lines.push("> persist assets/materials + design/layouts");
    }
    if (item.status === "completed") {
      lines.push(
        `✓ done` +
          (ctx.mediaReady || ctx.codeTotal
            ? ` · media ${ctx.mediaReady}/${ctx.mediaTotal || "?"} · code ${ctx.codeTotal}`
            : "")
      );
    } else if (failed) {
      lines.push(`✗ ${item.error?.slice(0, 80) || "failed"}`);
    } else if (cancelled) {
      lines.push("■ cancelled");
    } else if (active) {
      lines.push(tick % 2 === 0 ? "▌ running…" : " running…");
    }
    return lines;
  }, [
    active,
    cancelled,
    ctx.codeTotal,
    ctx.mediaReady,
    ctx.mediaTotal,
    ctx.mockup?.id,
    failed,
    item.assetId,
    item.completed,
    item.error,
    item.failed,
    item.jobId,
    item.stage,
    item.status,
    item.total,
    tick,
  ]);

  const statusText =
    item.status === "queued"
      ? "排队中"
      : item.status === "running"
        ? "执行中"
        : item.status === "completed"
          ? "已完成"
          : item.status === "cancelled"
            ? "已取消"
            : "失败";

  return (
    <div
      className={
        "overflow-hidden rounded-lg border " +
        (failed
          ? "border-red-300/70 bg-red-50/50 dark:border-red-900/50 dark:bg-red-950/25"
          : active
            ? "border-[var(--primary)]/35 bg-[color-mix(in_srgb,var(--primary)_6%,transparent)]"
            : "border-[var(--border)] bg-[var(--surface-muted)]/40")
      }
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        className="flex w-full cursor-pointer items-stretch gap-2.5 px-2 py-2 text-left hover:bg-[var(--surface-muted)]/50"
        aria-expanded={expanded}
      >
        {ctx.mockup?.src ? (
          <PreviewableThumb
            src={ctx.mockup.src}
            className="size-12 rounded-md"
            title={`拆解 ${ctx.mockup.id.slice(0, 10)}`}
            subtitle={`${ctx.mockup.width}×${ctx.mockup.height}`}
            onPreview={setPreview}
          />
        ) : (
          <span className="grid size-12 shrink-0 place-items-center rounded-md border border-[var(--border)] bg-[var(--background)]">
            <Layers className="size-4 text-[var(--primary)]" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[11.5px] font-semibold tracking-[-0.01em]">
            {active ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-[var(--primary)]" />
            ) : failed ? (
              <XCircle className="size-3.5 shrink-0 text-red-600" />
            ) : cancelled ? (
              <Square className="size-3 shrink-0 text-[var(--muted)]" />
            ) : (
              <Check className="size-3.5 shrink-0 text-emerald-600" />
            )}
            拆成素材
            <span className="font-medium text-[var(--muted)]">· {statusText}</span>
            {countSummary ? (
              <span className="tabular-nums text-[var(--muted)]">
                · {countSummary}
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block truncate font-mono text-[10px] text-[var(--muted)]">
            {ctx.mockup
              ? `${ctx.mockup.id.slice(0, 10)} · ${ctx.mockup.width}×${ctx.mockup.height}`
              : item.assetId
                ? item.assetId.slice(0, 12)
                : item.jobId.slice(0, 10)}
            {item.message ? ` · ${item.message.slice(0, 48)}` : ""}
          </span>
          {active ? (
            <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-[var(--border)]">
              <span
                className="block h-full rounded-full bg-[var(--primary)] transition-[width] duration-300"
                style={{ width: `${progress}%` }}
              />
            </span>
          ) : null}
        </span>
        {expanded ? (
          <ChevronDown className="mt-1 size-3.5 shrink-0 text-[var(--muted)]" />
        ) : (
          <ChevronRight className="mt-1 size-3.5 shrink-0 text-[var(--muted)]" />
        )}
      </div>

      {expanded ? (
        <div className="space-y-2 border-t border-[var(--border)]/70 px-2 pb-2 pt-2">
          <div className="overflow-hidden rounded-md border border-[#2a2d36] bg-[#12141a] font-mono text-[10px] text-[#b7f0c5] shadow-inner">
            <div className="flex items-center gap-1.5 border-b border-white/10 px-2 py-1 text-[9px] text-white/55">
              <Terminal className="size-3" />
              materialize · job {item.jobId.slice(0, 8)}
              {active ? (
                <span className="ml-auto inline-flex items-center gap-1 text-[var(--primary)]">
                  <span className="size-1.5 animate-pulse rounded-full bg-[var(--primary)]" />
                  live
                </span>
              ) : (
                <span className="ml-auto text-white/35">{statusText}</span>
              )}
            </div>
            <div className="max-h-36 space-y-0.5 overflow-y-auto px-2 py-1.5 leading-relaxed">
              {stageLines.map((line, i) => (
                <p
                  key={`${i}-${line}`}
                  className={
                    line.startsWith("✗")
                      ? "text-red-300"
                      : line.startsWith("✓")
                        ? "text-emerald-300"
                        : line.startsWith("$")
                          ? "text-[#8ec7ff]"
                          : "text-[#b7f0c5]/90"
                  }
                >
                  {line}
                </p>
              ))}
            </div>
            {active ? (
              <div className="h-0.5 overflow-hidden bg-white/10">
                <div
                  className="h-full bg-gradient-to-r from-transparent via-[#7dd3fc] to-transparent"
                  style={{
                    width: "40%",
                    transform: `translateX(${(tick % 5) * 40}%)`,
                    transition: "transform 0.7s linear",
                  }}
                />
              </div>
            ) : null}
          </div>

          {ctx.materials.length > 0 ? (
            <div>
              <p className="mb-1 text-[10px] font-medium app-subtle">
                产出材料 · {ctx.materials.length}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {ctx.materials.slice(0, 8).map((mat) => (
                  <PreviewableThumb
                    key={mat.id}
                    src={mat.src}
                    className="size-11 rounded"
                    title={mat.id.slice(0, 10)}
                    subtitle={(mat.prompt || "").slice(0, 40)}
                    onPreview={setPreview}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {(active && onCancelJob) || (failed && onRetryJob) || item.error ? (
            <div className="flex flex-wrap gap-1.5">
              {active && onCancelJob ? (
                <button
                  type="button"
                  onClick={() => onCancelJob(item.jobId)}
                  className="inline-flex h-6 items-center gap-1 rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-[10px] font-medium hover:border-red-400 hover:text-red-500"
                >
                  <Square className="size-3" />
                  取消
                </button>
              ) : null}
              {failed && onRetryJob ? (
                <button
                  type="button"
                  onClick={() => onRetryJob(item.jobId)}
                  className="inline-flex h-6 items-center gap-1 rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-[10px] font-medium hover:border-[var(--primary)]"
                >
                  <Sparkles className="size-3" />
                  重试
                </button>
              ) : null}
              {item.durationMs != null ? (
                <span className="inline-flex h-6 items-center gap-1 px-1 text-[10px] app-subtle">
                  <Clock3 className="size-2.5" />
                  {Math.max(1, Math.round(item.durationMs / 1000))}s
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <ImageLightbox item={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function ActionableJobBlock({
  item,
  theme,
  project,
  linkedTool,
  onCancelJob,
  onRetryJob,
}: {
  item: Extract<TimelineItem, { kind: "job" }>;
  theme: "ide" | "home";
  project?: ProjectFile;
  linkedTool?: Extract<TimelineItem, { kind: "tool" }>;
  onCancelJob?: (jobId: string) => void;
  onRetryJob?: (jobId: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const active = item.status === "queued" || item.status === "running";
  const failed = item.status === "failed";
  const cancelled = item.status === "cancelled";
  const isImageJob =
    item.jobType === "image_generation" ||
    item.jobType === "direct_image_generation";
  const isMaterializeJob = item.jobType === "materialize_slots";
  if (isMaterializeJob) {
    return (
      <MaterializeJobCard
        item={item}
        project={project}
        onCancelJob={onCancelJob}
        onRetryJob={onRetryJob}
      />
    );
  }
  const title = isImageJob ? "图片生成" : "后台任务";
  const statusText =
    item.status === "queued"
      ? "排队中"
      : item.status === "running"
        ? "执行中"
        : item.status === "completed"
          ? "已完成"
          : item.status === "cancelled"
            ? "已取消"
            : "失败";
  const countSummary =
    item.total > 0
      ? `${item.completed}/${item.total}${item.failed ? ` · ${item.failed} failed` : ""}`
      : "";
  // 已完成：优先短计数；进行中/失败才展示长 message
  const summary =
    active || failed
      ? item.message ??
        (countSummary || item.stage || item.jobId.slice(0, 8))
      : countSummary ||
        (item.durationMs != null
          ? `${Math.max(1, Math.round(item.durationMs / 1000))}s`
          : item.stage ?? "");
  const determinate = !active || item.completed > 0 || item.progress >= 8;
  const progress = Math.max(0, Math.min(100, item.progress || 0));
  const jobThumbRefs = mergeJobThumbRefs(
    { batchId: item.batchId, total: item.total },
    linkedTool
  );
  const jobReadyThumbs =
    isImageJob && project && !active && item.status === "completed"
      ? pickImageThumbnails(project, jobThumbRefs)
      : [];
  const jobGeneratingThumbs =
    isImageJob && project && active
      ? pickGeneratingImageThumbs(project, jobThumbRefs)
      : [];
  const hasActions =
    Boolean(active && onCancelJob) ||
    Boolean(failed && onRetryJob) ||
    Boolean(item.error);
  const hasDetails =
    hasActions ||
    Boolean(item.error) ||
    Boolean(item.message) ||
    item.durationMs != null ||
    item.total > 0;
  const [expanded, setExpanded] = useState(failed || Boolean(item.error));
  const isIde = theme === "ide";
  const doneQuiet = !active && !failed;

  async function copyError() {
    if (!item.error) return;
    await navigator.clipboard.writeText(item.error);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  // IDE：与 Tool 同行风格；完成态更短更淡
   if (isIde) {
    return (
      <div
        className={
          failed
            ? "overflow-hidden rounded-md border border-red-200/70 bg-red-50/60 dark:border-red-900/50 dark:bg-red-950/20"
            : "overflow-hidden rounded-md border border-transparent hover:border-[var(--border)]/80"
        }
      >
        <button
          type="button"
          disabled={!hasDetails}
          onClick={() => hasDetails && setExpanded((value) => !value)}
          className={
            "flex w-full items-center gap-2 px-2 text-left " +
            (doneQuiet ? "py-1" : "py-1.5") +
            (hasDetails ? " hover:bg-[var(--surface-muted)]/70" : "")
          }
        >
          <span
            className={
              "grid size-4 shrink-0 place-items-center " +
              (failed
                ? "text-red-600 dark:text-red-400"
                : active
                  ? "text-[var(--primary)]"
                  : "text-[var(--muted)]/70")
            }
          >
            {active ? (
              <Loader2 className="size-3 animate-spin" />
            ) : failed ? (
              <XCircle className="size-3" />
            ) : cancelled ? (
              <Square className="size-2.5" />
            ) : (
              <Check className="size-3" />
            )}
          </span>
          <span
            className={
              "min-w-0 flex-1 truncate tracking-[-0.01em] " +
              (doneQuiet
                ? "text-[11px] text-[var(--muted)]"
                : "text-[11.5px] text-[var(--foreground)]")
            }
          >
            <span className={doneQuiet ? "font-medium" : "font-medium text-[var(--foreground)]"}>
              {title}
            </span>
            <span className="text-[var(--muted)]"> · {statusText}</span>
            {!expanded && summary ? (
              <span className="text-[var(--muted)]">
                {" "}
                · {summary.replace(/\s+/g, " ").slice(0, doneQuiet ? 32 : 56)}
              </span>
            ) : null}
          </span>
          {active && determinate && item.total > 0 ? (
            <span className="shrink-0 text-[10px] tabular-nums text-[var(--muted)]">
              {Math.round(progress)}%
            </span>
          ) : null}
          {hasDetails ? (
            expanded ? (
              <ChevronDown className="size-3.5 shrink-0 text-[var(--muted)]" />
            ) : (
              <ChevronRight className="size-3.5 shrink-0 text-[var(--muted)]" />
            )
          ) : null}
        </button>
        {active ? (
          <div className="mx-2 mb-1.5 h-0.5 overflow-hidden rounded-full bg-[var(--border)]/70">
            <div
              className={
                determinate
                  ? "h-full rounded-full bg-[var(--primary)] transition-[width] duration-300"
                  : "h-full w-2/5 animate-pulse rounded-full bg-[var(--primary)]"
              }
              style={determinate ? { width: `${Math.max(8, progress)}%` } : undefined}
            />
          </div>
        ) : null}
        {expanded && hasDetails ? (
          <div className="border-t border-[var(--border)]/70 px-2.5 py-2 text-[10px] text-[var(--muted)]">
            {item.message || countSummary ? (
              <p className="mb-1.5 text-[11px] text-[var(--muted-strong)]">
                {item.message ?? countSummary}
              </p>
            ) : null}
            {item.error ? (
              <p className="mb-2 whitespace-pre-wrap break-words text-[11px] text-red-600 dark:text-red-400">
                {item.error}
              </p>
            ) : null}
            {item.durationMs != null ? (
              <p className="mb-2 inline-flex items-center gap-1 text-[var(--muted)]">
                <Clock3 className="size-2.5" />
                {Math.max(1, Math.round(item.durationMs / 1000))}s
              </p>
            ) : null}
            {hasActions ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {active && onCancelJob ? (
                  <button
                    type="button"
                    onClick={() => onCancelJob(item.jobId)}
                    className="inline-flex h-6 items-center gap-1 rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-[10px] font-medium text-[var(--muted-strong)] hover:border-red-400 hover:text-red-500"
                  >
                    <Square className="size-3" />
                    Cancel
                  </button>
                ) : null}
                {failed && onRetryJob ? (
                  <button
                    type="button"
                    onClick={() => onRetryJob(item.jobId)}
                    className="inline-flex h-6 items-center gap-1 rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-[10px] font-medium text-[var(--muted-strong)] hover:border-[var(--primary)]"
                  >
                    <Sparkles className="size-3" />
                    Retry
                  </button>
                ) : null}
                {item.error ? (
                  <button
                    type="button"
                    onClick={() => void copyError()}
                    className="inline-flex h-6 items-center gap-1 rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-[10px] font-medium text-[var(--muted-strong)] hover:border-[var(--primary)]"
                  >
                    {copied ? <Check className="size-3" /> : <FileCode2 className="size-3" />}
                    {copied ? "Copied" : "Copy error"}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {jobReadyThumbs.length > 0 || jobGeneratingThumbs.length > 0 ? (
          <SidebarImageResults
            ready={jobReadyThumbs}
            generating={jobGeneratingThumbs}
            project={project}
            theme={theme}
          />
        ) : null}
      </div>
    );
  }

  const shell =
    "border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-[var(--surface-muted)]";

  return (
    <div className={`overflow-hidden rounded-lg border ${shell}`}>
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <span
          className={
            "mt-0.5 grid size-5 shrink-0 place-items-center rounded-md " +
            (failed
              ? "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400"
              : active
                ? "bg-[var(--surface)] text-[var(--primary)]"
                : "bg-[var(--primary)] text-white")
          }
        >
          {active ? (
            <Loader2 className="size-3 animate-spin" />
          ) : failed ? (
            <XCircle className="size-3" />
          ) : cancelled ? (
            <Square className="size-2.5" />
          ) : (
            <Check className="size-3" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-[11.5px] font-semibold text-[var(--foreground)]">
              {title}
            </p>
            <span className="shrink-0 text-[10px] font-medium text-[var(--muted)]">
              {statusText}
            </span>
          </div>
          <p
            className={
              "mt-0.5 text-[11px] text-[var(--muted)] " +
              (failed && item.error
                ? "whitespace-pre-wrap break-words text-red-600 dark:text-red-400"
                : "truncate")
            }
          >
            {item.error ?? (summary || countSummary)}
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--border)]/70">
            <div
              className={
                "h-full rounded-full " +
                (failed
                  ? "bg-red-500"
                  : cancelled
                    ? "bg-[var(--muted)]"
                    : determinate
                      ? "bg-[var(--primary)] transition-[width] duration-300"
                      : "w-2/5 animate-pulse bg-[var(--primary)]")
              }
              style={
                determinate || failed || cancelled
                  ? { width: `${Math.max(active ? 8 : 0, progress)}%` }
                  : undefined
              }
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-3 text-[9.5px] text-[var(--muted)]">
            <span>
              {item.total > 0
                ? `${item.completed}/${item.total}${item.failed ? ` - ${item.failed} failed` : ""}`
                : item.stage ?? "Preparing"}
            </span>
            {item.durationMs != null ? (
              <span className="inline-flex items-center gap-1">
                <Clock3 className="size-2.5" />
                {Math.max(1, Math.round(item.durationMs / 1000))}s
              </span>
            ) : null}
          </div>
          {hasActions ? (
            <div className="mt-2 flex items-center gap-1.5">
              {active && onCancelJob ? (
                <button
                  type="button"
                  onClick={() => onCancelJob(item.jobId)}
                  className="inline-flex h-6 items-center gap-1 rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-[10px] font-medium text-[var(--muted-strong)] hover:border-red-400 hover:text-red-500"
                >
                  <Square className="size-3" />
                  Cancel
                </button>
              ) : null}
              {failed && onRetryJob ? (
                <button
                  type="button"
                  onClick={() => onRetryJob(item.jobId)}
                  className="inline-flex h-6 items-center gap-1 rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-[10px] font-medium text-[var(--muted-strong)] hover:border-[var(--primary)]"
                >
                  <Sparkles className="size-3" />
                  Retry
                </button>
              ) : null}
              {item.error ? (
                <button
                  type="button"
                  onClick={() => void copyError()}
                  className="inline-flex h-6 items-center gap-1 rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-[10px] font-medium text-[var(--muted-strong)] hover:border-[var(--primary)]"
                >
                  {copied ? <Check className="size-3" /> : <FileCode2 className="size-3" />}
                  {copied ? "Copied" : "Copy error"}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {jobReadyThumbs.length > 0 || jobGeneratingThumbs.length > 0 ? (
        <SidebarImageResults
          ready={jobReadyThumbs}
          generating={jobGeneratingThumbs}
          project={project}
          theme={theme}
        />
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
                        ? "bg-[var(--surface-muted)] text-[var(--success)]"
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

function DiscoveryFormCard({
  item,
  theme,
  onSubmit,
}: {
  item: Extract<TimelineItem, { kind: "discovery" }>;
  theme: "ide" | "home";
  onSubmit?: (text: string) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>(
    () => {
      const initial: Record<string, string | string[]> = {};
      for (const q of item.questions) {
        if (q.default !== undefined) initial[q.id] = q.default;
      }
      return initial;
    }
  );
  const [customTexts, setCustomTexts] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const handleRadioChange = (qid: string, value: string) => {
    setCustomTexts((prev) => ({ ...prev, [qid]: "" }));
    setAnswers((prev) => ({ ...prev, [qid]: value }));
  };

  const handleCheckboxChange = (qid: string, value: string, maxSel?: number) => {
    setAnswers((prev) => {
      const current = (prev[qid] as string[]) ?? [];
      let next: string[];
      if (current.includes(value)) {
        next = current.filter((v) => v !== value);
      } else {
        if (maxSel && current.length >= maxSel) return prev;
        next = [...current, value];
      }
      return { ...prev, [qid]: next };
    });
  };

  const handleTextChange = (qid: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [qid]: value }));
  };

  const handleCustomChange = (qid: string, value: string) => {
    setCustomTexts((prev) => ({ ...prev, [qid]: value }));
  };

  const mergedAnswers = useMemo(
    () => mergeDiscoveryCustomAnswers(item.questions, answers, customTexts),
    [answers, customTexts, item.questions]
  );

  const canSubmit = useMemo(() => {
    return item.questions.every((q) =>
      isDiscoveryAnswerFilled(q, mergedAnswers[q.id])
    );
  }, [item.questions, mergedAnswers]);

  const handleSubmit = () => {
    if (!canSubmit || submitted) return;
    setSubmitted(true);

    const answerText = formatDiscoveryAnswerMessage(
      item.questions,
      mergedAnswers
    );

    onSubmit?.(answerText);
  };

  const shell =
    theme === "ide"
      ? "border-[var(--primary)]/30 bg-[var(--primary-soft)]"
      : "border-[color-mix(in_srgb,var(--primary)_25%,transparent)] bg-[var(--surface-muted)]";

  return (
    <div className={`rounded-lg border overflow-hidden ${shell}`}>
      <div className="flex items-center gap-2 border-b border-inherit px-3 py-2.5">
        <HelpCircle className="size-3.5 shrink-0 text-[var(--primary)]" />
        <span className="text-[11px] font-semibold app-strong">{item.title}</span>
      </div>
      {item.description ? (
        <p className="px-3 pt-2 text-[11px] app-subtle">{item.description}</p>
      ) : null}
      <div className="space-y-3 px-3 py-3">
        {item.questions.map((q) => (
          <div key={q.id}>
            <label className="mb-1.5 block text-[11px] font-medium text-[var(--foreground)]">
              {q.label}
              {q.required ? <span className="ml-1 text-[var(--primary)]">*</span> : null}
            </label>
            {q.type === "radio" && q.options ? (
              <div className="space-y-1.5">
                <div className="flex flex-wrap gap-1.5">
                {q.options.map((opt) => {
                  const selected =
                    !customTexts[q.id]?.trim() && answers[q.id] === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      disabled={submitted}
                      onClick={() => handleRadioChange(q.id, opt)}
                      className={
                        "rounded-lg border px-2.5 py-1 text-[11px] transition " +
                        (selected
                          ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                          : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted-strong)] hover:border-[var(--primary)]/50") +
                        (submitted ? " opacity-60 cursor-not-allowed" : "")
                      }
                    >
                      {q.optionLabels?.[opt] ?? opt}
                    </button>
                  );
                })}
                </div>
                <input
                  type="text"
                  value={customTexts[q.id] ?? ""}
                  onChange={(e) =>
                    handleCustomChange(q.id, e.target.value)
                  }
                  disabled={submitted}
                  placeholder={q.placeholder || "没有合适的，自己写"}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] text-[var(--foreground)] placeholder:text-[var(--muted)] focus:border-[var(--primary)] focus:outline-none disabled:opacity-60"
                />
              </div>
            ) : q.type === "checkbox" && q.options ? (
              <div className="space-y-1.5">
                <div className="flex flex-wrap gap-1.5">
                {q.options.map((opt) => {
                  const selected = ((answers[q.id] as string[]) ?? []).includes(opt);
                  return (
                    <button
                      key={opt}
                      type="button"
                      disabled={submitted}
                      onClick={() => handleCheckboxChange(q.id, opt, q.maxSelections)}
                      className={
                        "rounded-lg border px-2.5 py-1 text-[11px] transition " +
                        (selected
                          ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                          : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted-strong)] hover:border-[var(--primary)]/50") +
                        (submitted ? " opacity-60 cursor-not-allowed" : "")
                      }
                    >
                      {q.optionLabels?.[opt] ?? opt}
                    </button>
                  );
                })}
                {q.maxSelections ? (
                  <span className="self-center text-[10px] app-subtle">最多选 {q.maxSelections} 项</span>
                ) : null}
                </div>
                <input
                  type="text"
                  value={customTexts[q.id] ?? ""}
                  onChange={(e) =>
                    handleCustomChange(q.id, e.target.value)
                  }
                  disabled={submitted}
                  placeholder={q.placeholder || "没有合适的，自己写"}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] text-[var(--foreground)] placeholder:text-[var(--muted)] focus:border-[var(--primary)] focus:outline-none disabled:opacity-60"
                />
              </div>
            ) : q.type === "textarea" ? (
              <textarea
                value={(answers[q.id] as string) ?? ""}
                onChange={(e) => handleTextChange(q.id, e.target.value)}
                disabled={submitted}
                placeholder={q.placeholder ?? ""}
                rows={2}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] text-[var(--foreground)] placeholder:text-[var(--muted)] focus:border-[var(--primary)] focus:outline-none disabled:opacity-60"
              />
            ) : (
              <input
                type="text"
                value={(answers[q.id] as string) ?? ""}
                onChange={(e) => handleTextChange(q.id, e.target.value)}
                disabled={submitted}
                placeholder={q.placeholder ?? ""}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] text-[var(--foreground)] placeholder:text-[var(--muted)] focus:border-[var(--primary)] focus:outline-none disabled:opacity-60"
              />
            )}
          </div>
        ))}
        <div className="flex items-center justify-between gap-2 pt-1">
          {submitted ? (
            <p className="flex items-center gap-1.5 text-[10px] font-medium text-[var(--success)]">
              <Check className="size-3" />
              已提交，Agent 正在根据你的回答规划...
            </p>
          ) : (
            <p className="text-[10px] app-subtle">
              已预填，可直接提交或改一题
             </p>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || submitted}
            className={
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition " +
              (canSubmit && !submitted
                ? "bg-[var(--primary)] text-white hover:opacity-90"
                : "bg-[var(--surface-muted)] text-[var(--muted)] cursor-not-allowed")
            }
          >
            <Send className="size-3" />
            提交
          </button>
        </div>
      </div>
    </div>
  );
}

function DirectionConfirmCard({
  item,
  theme,
  onSubmit,
}: {
  item: Extract<TimelineItem, { kind: "direction" }>;
  theme: "ide" | "home";
  onSubmit?: (text: string) => void;
}) {
  const [submitted, setSubmitted] = useState(false);
  const shell =
    theme === "ide"
      ? "border-[var(--primary)]/30 bg-[var(--primary-soft)]"
      : "border-[color-mix(in_srgb,var(--primary)_25%,transparent)] bg-[var(--surface-muted)]";
  const details = [
    ["调性", item.tone],
    ["配色", item.palette],
    ["字体", item.typography],
    ["图片风格", item.imageStyle],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  const submit = (text: string) => {
    if (submitted) return;
    setSubmitted(true);
    onSubmit?.(text);
  };

  return (
    <div className={`rounded-lg border overflow-hidden ${shell}`}>
      <div className="flex items-center gap-2 border-b border-inherit px-3 py-2.5">
        <Sparkles className="size-3.5 shrink-0 text-[var(--primary)]" />
        <span className="text-[11px] font-semibold app-strong">{item.title}</span>
      </div>
      <div className="space-y-2.5 px-3 py-3">
        <p className="text-[11px] leading-relaxed text-[var(--foreground)]">{item.summary}</p>
        {details.length > 0 ? (
          <div className="grid grid-cols-1 gap-1.5">
            {details.map(([label, value]) => (
              <div key={label} className="flex gap-2 text-[10px]">
                <span className="w-14 shrink-0 app-subtle">{label}</span>
                <span className="text-[var(--muted-strong)]">{value}</span>
              </div>
            ))}
          </div>
        ) : null}
        {submitted ? (
          <p className="flex items-center gap-1.5 text-[10px] font-medium text-[var(--success)]">
            <Check className="size-3" /> 已确认，Agent 将继续生成视觉素材
          </p>
        ) : (
          <div className="flex justify-end gap-1.5 pt-1">
            <button
              type="button"
              onClick={() => submit(DIRECTION_ADJUST_MESSAGE)}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[10px] font-medium text-[var(--muted-strong)] hover:border-[var(--primary)]/50"
            >
              我想调整
            </button>
            <button
              type="button"
              onClick={() => submit("[视觉方向确认] 当前视觉方向满意，请继续生成视觉素材。")}
              className="rounded-lg bg-[var(--primary)] px-2.5 py-1.5 text-[10px] font-medium text-white hover:opacity-90"
            >
              确认方向
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ImageGenerationConfirmCard({
  item,
  onCancelRun,
  onConfirm,
}: {
  item: Extract<TimelineItem, { kind: "image_confirm" }>;
  onCancelRun?: () => void;
  onConfirm?: (prompt: string, count: number, prompts?: string[]) => void;
}) {
  const initialPrompts =
    item.prompts && item.prompts.length > 0 ? item.prompts : [item.prompt];
  const [prompts, setPrompts] = useState(initialPrompts);
  const [count, setCount] = useState(item.count);
  const [submitted, setSubmitted] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const multi = prompts.length > 1;
  const meta = multi
    ? `${prompts.length} 张 · ${item.width} × ${item.height}`
    : `${count} 张 · ${item.width} × ${item.height}`;

  const submit = () => {
    const cleaned = prompts.map((p) => p.trim()).filter(Boolean);
    if (submitted || cancelled || cleaned.length === 0) return;
    const safeCount = multi
      ? cleaned.length
      : Math.min(8, Math.max(1, Math.round(Number(count) || 1)));
    setSubmitted(true);
    onConfirm?.(cleaned[0], safeCount, cleaned);
  };

  function cancelTool() {
    setCancelled(true);
    onCancelRun?.();
  }

  return (
    <div className="vad-approve">
      <div className="vad-approve-head">
        <h3>生成图片</h3>
        <span className="vad-approve-meta">{meta}</span>
      </div>
      <div className="vad-approve-body">
        <div className="space-y-2">
        {prompts.map((prompt, index) => (
          <label key={`prompt-${index}`} className="block">
            {multi ? <span className="vad-approve-field"><span>画面 {index + 1}</span></span> : null}
            <textarea
              value={prompt}
              onChange={(event) => {
                const next = [...prompts];
                next[index] = event.target.value;
                setPrompts(next);
              }}
              disabled={submitted || cancelled}
              rows={multi ? 4 : 6}
              className="vad-approve-prompt"
            />
          </label>
        ))}
        </div>
        {!multi ? (
          <details className="vad-approve-extra">
            <summary>调整选项</summary>
            <div className="vad-approve-extra-grid">
              <label className="vad-approve-field">
                <span>张数</span>
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={count}
                  onChange={(event) => setCount(Number(event.target.value))}
                  disabled={submitted || cancelled}
                />
              </label>
            </div>
          </details>
        ) : null}
        {cancelled ? (
          <p className="vad-approve-status">已取消</p>
        ) : submitted ? (
          <p className="vad-approve-status is-ok">已开始生成</p>
        ) : (
          <div className="vad-approve-actions">
            <button type="button" onClick={() => void cancelTool()} className="vad-approve-btn">
              取消
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!prompts.some((p) => p.trim())}
              className="vad-approve-btn vad-approve-btn--primary"
            >
              生成
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolConfirmCard({
  item,
  theme,
  onSubmit,
  onConfirm,
  onCancelTool,
}: {
  item: Extract<TimelineItem, { kind: "tool_confirm" }>;
  theme: "ide" | "home";
  onSubmit?: (text: string) => void;
  onConfirm?: (
    runId: string,
    approvalId: string,
    args?: Record<string, unknown>
  ) => Promise<void> | void;
  onCancelTool?: (runId: string, approvalId: string) => Promise<void> | void;
}) {
  const [submitted, setSubmitted] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [running, setRunning] = useState(false);
  const [approved, setApproved] = useState(false);
  const [rememberApproval, setRememberApproval] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const argsText = formatToolArgs(item.args);
  const [draftArgs, setDraftArgs] = useState(argsText);
  const [editingArgs, setEditingArgs] = useState(false);
  const isImageTool =
    item.toolName === "generate_images" ||
    item.toolName === "generate_image_variants";
  const [imageDraft, setImageDraft] = useState(() => imageApprovalDraftFromArgs(item.args));
  const shell =
    theme === "ide"
      ? "border-[var(--border)] bg-[var(--surface)] shadow-sm"
      : "border-[color-mix(in_srgb,var(--primary)_25%,transparent)] bg-[var(--surface-muted)]";

  function requestChanges() {
    if (submitted || cancelled || running || approved) return;
    setSubmitted(true);
    onSubmit?.(
      [
        `[工具执行调整] 请不要直接执行 ${item.toolName}。`,
        "请重新说明你准备做什么、为什么需要这个工具，并给出可编辑的执行参数。",
        "当前参数：",
        argsText,
      ].join("\n")
    );
  }

  async function approveTool() {
    if (submitted || cancelled || running || approved) return;
    if (!item.runId || !item.approvalId || !onConfirm) {
      setError("缺少工具确认上下文，无法直接执行。请点击修改计划让 Agent 重新生成请求。");
      return;
    }
    setError(null);
    setRunning(true);
    try {
      const nextArgs = isImageTool
        ? { ...imageApprovalArgs(imageDraft, item.args), ...(rememberApproval ? { rememberApproval: true } : {}) }
        : { ...parseToolArgs(draftArgs), ...(rememberApproval ? { rememberApproval: true } : {}) };
      await onConfirm(item.runId, item.approvalId, nextArgs);
      setApproved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  async function cancelTool() {
    if (submitted || cancelled || running || approved) return;
    if (!item.runId || !item.approvalId || !onCancelTool) {
      setError("Missing tool confirmation context. Use Cancel Run to stop the active run.");
      return;
    }
    setError(null);
    setRunning(true);
    try {
      await onCancelTool(item.runId, item.approvalId);
      setCancelled(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  function updateImageDraft(next: ImageToolApprovalDraft) {
    setImageDraft(next);
    setDraftArgs(formatToolArgs(imageApprovalArgsForPreview(next, item.args)));
  }

  const imagePrompts =
    imageDraft.prompts.length > 0
      ? imageDraft.prompts
      : imageDraft.prompt
        ? [imageDraft.prompt]
        : [""];
  const imageMulti = imagePrompts.length > 1;
  const imageMeta = `${imageMulti ? imagePrompts.length : imageDraft.count} 张 · ${imageDraft.width} × ${imageDraft.height}`;
  const imageLocked = running || approved || cancelled || submitted;

  if (isImageTool) {
    return (
      <div className="vad-approve">
        <div className="vad-approve-head">
          <h3>生成图片</h3>
          <span className="vad-approve-meta">{imageMeta}</span>
        </div>
        <div className="vad-approve-body">
          <div className="space-y-2">
            {imagePrompts.map((prompt, index) => (
              <label key={`img-prompt-${index}`} className="block">
                {imageMulti ? (
                  <span className="vad-approve-field">
                    <span>画面 {index + 1}</span>
                  </span>
                ) : null}
                <textarea
                  value={prompt}
                  onChange={(event) => {
                    const next = [...imagePrompts];
                    next[index] = event.target.value;
                    updateImageDraft({
                      ...imageDraft,
                      prompts: next,
                      prompt: next[0] ?? "",
                      count: imageMulti ? next.length : imageDraft.count,
                    });
                  }}
                  disabled={imageLocked}
                  rows={imageMulti ? 4 : 6}
                  className="vad-approve-prompt"
                />
              </label>
            ))}
          </div>
          <details className="vad-approve-extra">
            <summary>调整选项</summary>
            <div className="vad-approve-extra-grid">
              {!imageMulti ? (
                <label className="vad-approve-field">
                  <span>张数</span>
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={imageDraft.count}
                    onChange={(event) =>
                      updateImageDraft({
                        ...imageDraft,
                        count: clampNumber(event.target.value, 1, 8),
                      })
                    }
                    disabled={imageLocked}
                  />
                </label>
              ) : null}
              <label className="vad-approve-field">
                <span>宽度</span>
                <input
                  type="number"
                  min={256}
                  max={2048}
                  step={64}
                  value={imageDraft.width}
                  onChange={(event) =>
                    updateImageDraft({
                      ...imageDraft,
                      width: clampNumber(event.target.value, 256, 2048),
                    })
                  }
                  disabled={imageLocked}
                />
              </label>
              <label className="vad-approve-field">
                <span>高度</span>
                <input
                  type="number"
                  min={256}
                  max={2048}
                  step={64}
                  value={imageDraft.height}
                  onChange={(event) =>
                    updateImageDraft({
                      ...imageDraft,
                      height: clampNumber(event.target.value, 256, 2048),
                    })
                  }
                  disabled={imageLocked}
                />
              </label>
            </div>
            {!imageLocked ? (
              <button type="button" onClick={requestChanges} className="vad-approve-quiet">
                 让 Agent 改方案
               </button>
            ) : null}
          </details>
          {cancelled ? (
          <p className="vad-approve-status">已取消</p>
          ) : approved ? (
          <p className="vad-approve-status is-ok">已开始生成</p>
          ) : submitted ? (
            <p className="vad-approve-status is-ok">已要求调整方案</p>
          ) : (
            <div className="vad-approve-actions">
              <button
                type="button"
                onClick={() => void cancelTool()}
                disabled={running}
                className="vad-approve-btn"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void approveTool()}
                disabled={running || !imagePrompts.some((p) => p.trim())}
                className="vad-approve-btn vad-approve-btn--primary"
              >
                {running ? <Loader2 className="size-3 animate-spin" /> : null}
                生成
              </button>
            </div>
          )}
          {!imageLocked && item.riskLevel === "moderate" ? (
            <label className="mt-2 flex items-center gap-1.5 text-[10px] text-[var(--muted)]">
              <input type="checkbox" checked={rememberApproval} onChange={(event) => setRememberApproval(event.target.checked)} />
              本项目后续自动允许此类操作
            </label>
          ) : null}
          {error ? <p className="vad-approve-error">{error}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className={`overflow-hidden rounded-lg border ${shell}`}>
      <div className="flex items-start justify-between gap-3 border-b border-inherit px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ListChecks className="size-3.5 shrink-0 text-[var(--primary)]" />
            <span className="text-[11px] font-semibold app-strong">Agent 请求执行工具</span>
          </div>
          <p className="mt-1 truncate text-[10px] text-[var(--muted-strong)]">{item.title}</p>
          {(item.model || item.estimatedSeconds || item.affectedAssets?.length) ? (
            <p className="mt-1 text-[10px] text-[var(--muted)]">
              {[item.model, item.estimatedSeconds ? `预计 ${item.estimatedSeconds}s` : null, item.affectedAssets?.length ? `影响 ${item.affectedAssets.length} 个素材` : null].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </div>
        <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase ${toolConfirmRiskClass(item.riskLevel)}`}>
          {item.riskLevel === "destructive" ? "高风险" : "需确认"}
        </span>
      </div>
      <div className="space-y-3 px-3 py-3">
        <div>
          <p className="mb-1.5 text-[10px] font-semibold text-[var(--muted)]">
            {item.toolName}
          </p>
          <div className="mb-1.5 flex justify-end">
            <button
              type="button"
              onClick={() => setEditingArgs((value) => !value)}
              disabled={running || approved || cancelled}
              className="rounded-md px-1.5 py-0.5 text-[9px] font-medium text-[var(--muted-strong)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
            >
              {editingArgs ? "Preview" : "Edit JSON"}
            </button>
          </div>
          {editingArgs ? (
            <textarea
              value={draftArgs}
              onChange={(event) => setDraftArgs(event.target.value)}
              spellCheck={false}
              className="min-h-32 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-2 font-mono text-[10px] leading-relaxed text-[var(--muted-strong)] outline-none focus:border-[var(--primary)]/60"
            />
          ) : (
            <pre className="max-h-40 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-2 text-[10px] leading-relaxed text-[var(--muted-strong)]">
              {draftArgs}
            </pre>
          )}
        </div>
        {cancelled ? (
          <p className="flex items-center gap-1.5 text-[10px] font-medium text-[var(--muted-strong)]">
            <XCircle className="size-3" />
            已取消。不会执行该工具。
           </p>
        ) : approved ? (
          <p className="flex items-center gap-1.5 text-[10px] font-medium text-[var(--success)]">
            <Check className="size-3" />
            已确认执行。结果会同步到时间线和画布。
            </p>
        ) : submitted ? (
          <p className="flex items-center gap-1.5 text-[10px] font-medium text-[var(--success)]">
            <Check className="size-3" />
            已要求 Agent 重新说明和调整。
            </p>
        ) : (
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => void cancelTool()}
              disabled={running}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[10px] font-medium text-[var(--muted-strong)] hover:border-red-400/60 hover:text-red-500"
            >
              <XCircle className="size-3" />
              取消
            </button>
            <button
              type="button"
              onClick={requestChanges}
              disabled={running}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[10px] font-medium text-[var(--muted-strong)] hover:border-[var(--primary)]/50 disabled:opacity-50"
            >
              <PencilLine className="size-3" />
              修改计划
            </button>
            <button
              type="button"
              onClick={() => void approveTool()}
              disabled={running}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-2.5 py-1.5 text-[10px] font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
              确认执行
            </button>
          </div>
        )}
        {!submitted && !cancelled && !approved && item.riskLevel === "moderate" ? (
          <label className="mt-2 flex items-center gap-1.5 text-[10px] text-[var(--muted)]">
            <input type="checkbox" checked={rememberApproval} onChange={(event) => setRememberApproval(event.target.checked)} />
            本项目后续自动允许此类操作
          </label>
        ) : null}
        {error ? (
          <p className="rounded-md bg-red-500/10 px-2 py-1.5 text-[10px] text-red-600 dark:text-red-300">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function formatToolArgs(args: Record<string, unknown> | undefined): string {
  if (!args || Object.keys(args).length === 0) return "{}";
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

type ImageToolApprovalDraft = {
  prompt: string;
  prompts: string[];
  count: number;
  width: number;
  height: number;
  role: string;
  mode: string;
};

function parseToolArgs(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Tool arguments must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function imageApprovalDraftFromArgs(
  args: Record<string, unknown> | undefined
): ImageToolApprovalDraft {
  const fromList = Array.isArray(args?.prompts)
    ? args.prompts
        .filter((p): p is string => typeof p === "string")
        .map((p) => p.trim())
        .filter(Boolean)
    : [];
  const prompt = stringArg(args?.prompt) || fromList[0] || "";
  const prompts = fromList.length > 0 ? fromList : prompt ? [prompt] : [];
  return {
    prompt,
    prompts,
    count: Math.max(
      prompts.length,
      numberArg(args?.count, prompts.length || 1, 1, 8),
    ),
    width: numberArg(args?.width, 1024, 256, 2048),
    height: numberArg(args?.height, 1024, 256, 2048),
    role: stringArg(args?.role) || "product-shot",
    mode: stringArg(args?.mode) || "async",
  };
}

function imageApprovalArgs(
  draft: ImageToolApprovalDraft,
  originalArgs: Record<string, unknown> | undefined
): Record<string, unknown> {
  const prompts = (draft.prompts.length > 0 ? draft.prompts : [draft.prompt])
    .map((p) => p.trim())
    .filter(Boolean);
  if (prompts.length === 0) throw new Error("Image prompt cannot be empty.");
  return imageApprovalArgsForPreview(
    { ...draft, prompt: prompts[0], prompts },
    originalArgs
  );
}

function imageApprovalArgsForPreview(
  draft: ImageToolApprovalDraft,
  originalArgs: Record<string, unknown> | undefined
): Record<string, unknown> {
  const prompts = (draft.prompts.length > 0 ? draft.prompts : [draft.prompt])
    .map((p) => p.trim())
    .filter(Boolean);
  const multi = prompts.length > 1;
  return {
    ...(originalArgs ?? {}),
    confirmed: true,
    prompt: prompts[0] ?? draft.prompt,
    prompts,
    count: multi ? prompts.length : clampNumber(draft.count, 1, 8),
    width: clampNumber(draft.width, 256, 2048),
    height: clampNumber(draft.height, 256, 2048),
    role: draft.role || "product-shot",
    mode: draft.mode || "async",
  };
}

function stringArg(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberArg(value: unknown, fallback: number, min: number, max: number): number {
  return clampNumber(typeof value === "number" ? value : fallback, min, max);
}

function clampNumber(value: unknown, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function toolConfirmRiskClass(risk: "safe" | "moderate" | "destructive" | "external"): string {
  if (risk === "destructive") return "bg-red-500/10 text-red-700 dark:text-red-300";
  if (risk === "moderate") return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (risk === "external") return "bg-purple-500/10 text-purple-700 dark:text-purple-300";
  return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
}

function pipelineStageLabel(stage?: string): string {
  if (!stage) return "";
  return PIPELINE_STAGE_LABELS[stage] ?? stage;
}

function PipelineLogLine({
  entry,
  theme,
}: {
  entry: PipelineLogEntry;
  theme: "ide" | "home";
}) {
  const stageLabel = pipelineStageLabel(entry.stage);
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

/** Cursor 风：连续流水线日志默认一行摘要，展开看明细 */
function PipelineLogsGroup({
  item,
  theme,
}: {
  item: Extract<TimelineItem, { kind: "pipeline_logs" }>;
  theme: "ide" | "home";
}) {
  const [expanded, setExpanded] = useState(false);
  const { entries } = item;
  if (entries.length === 0) return null;

  const last = entries[entries.length - 1];
  const stages = Array.from(
    new Set(
      entries
        .map((entry) => pipelineStageLabel(entry.stage))
        .filter(Boolean)
    )
  );
  const errorCount = entries.filter((entry) => entry.level === "error").length;
  const summaryTail =
    last.message.replace(/\s+/g, " ").slice(0, 64) ||
    stages.slice(-2).join(" → ") ||
    "pipeline";

  return (
    <div
      className={
        theme === "ide"
          ? "overflow-hidden rounded-md border border-transparent hover:border-[var(--border)]/80"
          : "overflow-hidden rounded-lg border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-[var(--surface-muted)]"
      }
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-[var(--surface-muted)]/70"
      >
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0 text-[var(--muted)]" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-[var(--muted)]" />
        )}
        <ListChecks className="size-3 shrink-0 text-[var(--muted)]" />
        <span className="min-w-0 flex-1 truncate text-[11px] tracking-[-0.01em] text-[var(--muted)]">
          <span className="font-medium text-[var(--muted-strong)]">
            {entries.length} 步流水线
          </span>
          {stages.length > 0 ? (
            <span>
              {" "}
              · {stages.slice(0, 3).join(" → ")}
              {stages.length > 3 ? "…" : ""}
            </span>
          ) : null}
          {!expanded ? <span> · {summaryTail}</span> : null}
          {errorCount > 0 ? (
            <span className="text-red-500"> · {errorCount} 错误</span>
          ) : null}
        </span>
      </button>
      {expanded ? (
        <div className="space-y-1 border-t border-[var(--border)]/70 px-2 py-2">
          {entries.map((entry) => (
            <PipelineLogLine key={entry.id} entry={entry} theme={theme} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TimelineRow({
  item,
  theme,
  project,
  turnItems,
  diffDecisions,
  diffPreviewMode,
  onAcceptDiff,
  onRejectDiff,
  onUndoAcceptDiff,
  onDiscoverySubmit,
  onCancelJob,
  onRetryJob,
  onCancelRun,
  onImageConfirm,
  onToolConfirm,
  onToolCancel,
  onRetryUserMessage,
  onEditUserMessage,
  onRetryRun,
}: {
  item: TimelineItem;
  theme: "ide" | "home";
  project?: ProjectFile;
  turnItems?: TimelineItem[];
  diffDecisions?: Map<string, DiffDecision>;
  diffPreviewMode?: boolean;
  onAcceptDiff?: (toolCallId: string) => void;
  onRejectDiff?: (toolCallId: string) => void;
  onUndoAcceptDiff?: (toolCallId: string) => void;
  onDiscoverySubmit?: (text: string) => void;
  onCancelJob?: (jobId: string) => void;
  onRetryJob?: (jobId: string) => void;
  onCancelRun?: () => void;
  onImageConfirm?: (prompt: string, count: number, prompts?: string[]) => void;
  onToolConfirm?: (
    runId: string,
    approvalId: string,
    args?: Record<string, unknown>
  ) => Promise<void> | void;
  onToolCancel?: (runId: string, approvalId: string) => Promise<void> | void;
  onRetryUserMessage?: (messageId: string, content: string) => void;
  onEditUserMessage?: (messageId: string, content: string) => void;
  onRetryRun?: () => void;
}) {
  switch (item.kind) {
    case "user":
      return (
        <div
          className={
            "group relative " +
            (theme === "ide"
              ? "vad-agent-msg-user"
              : "rounded-xl border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-[var(--surface-muted)] px-3.5 py-3 text-[13px] font-medium app-strong")
          }
        >
          <MarkdownText content={item.content} />
          {theme === "ide" ? (
            <MessageActionBar>
              <MessageActionButton
                label="复制"
                onClick={() => void copyText(item.content)}
              >
                <Copy className="size-3" />
              </MessageActionButton>
              {onEditUserMessage ? (
                <MessageActionButton
                  label="编辑"
                  onClick={() => onEditUserMessage(item.id, item.content)}
                >
                  <Pencil className="size-3" />
                </MessageActionButton>
              ) : null}
              {onRetryUserMessage ? (
                <MessageActionButton
                  label="重试"
                  onClick={() => onRetryUserMessage(item.id, item.content)}
                >
                  <RotateCcw className="size-3" />
                </MessageActionButton>
              ) : null}
            </MessageActionBar>
          ) : null}
        </div>
      );
    case "thought":
      return <CollapsibleThoughtBlock key={item.id} item={item} theme={theme} />;
    case "activity":
      return (
        <div
          className={
            item.tone === "warning"
              ? "rounded-md border border-amber-200/70 bg-amber-50/70 px-2.5 py-2 text-[10.5px] leading-relaxed text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200"
              : "rounded-md border border-[var(--border)] bg-[var(--surface-muted)]/70 px-2.5 py-2 text-[10.5px] leading-relaxed text-[var(--muted-strong)]"
          }
        >
          {item.text}
        </div>
      );
    case "agent_plan":
      return <AgentPlanBlock item={item} theme={theme} />;
    case "tool":
      return (
        <ToolBlock
          item={item}
          theme={theme}
          project={project}
          hideThumbs={imageJobCoversToolPreview(
            item,
            (turnItems ?? []).flatMap((row) =>
              row.kind === "job"
                ? [
                    {
                      toolCallId: row.toolCallId,
                      jobType: row.jobType,
                      batchId: row.batchId,
                    },
                  ]
                : []
            )
          )}
        />
      );
    case "job":
      return (
        <ActionableJobBlock
          item={item}
          theme={theme}
          project={project}
          linkedTool={
            (turnItems ?? []).find(
              (row): row is Extract<TimelineItem, { kind: "tool" }> =>
                row.kind === "tool" && row.id === item.toolCallId
            ) ??
            (turnItems ?? []).find(
              (row): row is Extract<TimelineItem, { kind: "tool" }> =>
                row.kind === "tool" &&
                Boolean(
                  item.batchId &&
                    extractImageToolThumbRefs(row.output, row.summary)
                      .batchId === item.batchId
                )
            )
          }
          onCancelJob={onCancelJob}
          onRetryJob={onRetryJob}
        />
      );
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
            "group relative " +
            (theme === "ide"
              ? "vad-agent-msg-assistant"
              : "text-[13px] leading-[1.6] text-[var(--foreground)]")
          }
        >
          <MarkdownText content={item.content} />
          {item.streaming ? (
            <span className="vad-agent-stream-caret" aria-hidden />
          ) : null}
          {theme === "ide" && !item.streaming && item.content.trim() ? (
            <MessageActionBar>
              <MessageActionButton
                label="复制"
                onClick={() => void copyText(item.content)}
              >
                <Copy className="size-3" />
              </MessageActionButton>
            </MessageActionBar>
          ) : null}
        </div>
      );
    case "pipeline_log":
      return (
        <PipelineLogsGroup
          item={{
            kind: "pipeline_logs",
            id: item.id,
            entries: [item.entry],
          }}
          theme={theme}
        />
      );
    case "pipeline_logs":
      return <PipelineLogsGroup item={item} theme={theme} />;
    case "discovery":
      return (
        <DiscoveryFormCard
          item={item}
          theme={theme}
          onSubmit={onDiscoverySubmit}
        />
      );
    case "direction":
      return (
        <DirectionConfirmCard
          item={item}
          theme={theme}
          onSubmit={onDiscoverySubmit}
        />
      );
    case "image_confirm":
      return (
        <ImageGenerationConfirmCard
          item={item}
          onCancelRun={onCancelRun}
          onConfirm={onImageConfirm}
        />
      );
    case "tool_confirm":
      return (
        <ToolConfirmCard
          item={item}
          theme={theme}
          onSubmit={onDiscoverySubmit}
          onConfirm={onToolConfirm}
          onCancelTool={onToolCancel}
        />
      );
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

function TurnBlock({
  turn,
  theme,
  project,
  diffDecisions,
  diffPreviewMode,
  onAcceptDiff,
  onRejectDiff,
  onUndoAcceptDiff,
  onDiscoverySubmit,
  onCancelJob,
  onRetryJob,
  onCancelRun,
  onImageConfirm,
  onToolConfirm,
  onToolCancel,
  onRetryUserMessage,
  onEditUserMessage,
  onRetryRun,
}: {
  turn: TimelineTurn;
  theme: "ide" | "home";
  project?: ProjectFile;
  diffDecisions?: Map<string, DiffDecision>;
  diffPreviewMode?: boolean;
  onAcceptDiff?: (toolCallId: string) => void;
  onRejectDiff?: (toolCallId: string) => void;
  onUndoAcceptDiff?: (toolCallId: string) => void;
  onDiscoverySubmit?: (text: string) => void;
  onCancelJob?: (jobId: string) => void;
  onRetryJob?: (jobId: string) => void;
  onCancelRun?: () => void;
  onImageConfirm?: (prompt: string, count: number, prompts?: string[]) => void;
  onToolConfirm?: (
    runId: string,
    approvalId: string,
    args?: Record<string, unknown>
  ) => Promise<void> | void;
  onToolCancel?: (runId: string, approvalId: string) => Promise<void> | void;
  onRetryUserMessage?: (messageId: string, content: string) => void;
  onEditUserMessage?: (messageId: string, content: string) => void;
  onRetryRun?: () => void;
}) {
  const statusMeta = getTurnStatusMeta(turn.status);
  const summaryParts = [
    turn.counts.tools ? `${turn.counts.tools} 个工具` : "",
    turn.counts.jobs ? `${turn.counts.jobs} 个任务` : "",
    turn.counts.files ? `${turn.counts.files} 个文件` : "",
    turn.counts.changes ? `${turn.counts.changes} 处变更` : "",
    turn.counts.errors ? `${turn.counts.errors} 个错误` : "",
  ].filter(Boolean);

  const rowProps = {
    theme,
    project,
    turnItems: turn.items,
    diffDecisions,
    diffPreviewMode,
    onAcceptDiff,
    onRejectDiff,
    onUndoAcceptDiff,
    onDiscoverySubmit,
    onCancelJob,
    onRetryJob,
    onCancelRun,
    onImageConfirm,
    onToolConfirm,
    onToolCancel,
    onRetryUserMessage,
    onEditUserMessage,
  } as const;

  // IDE：对话风（无任务卡头）；Home 保留原任务卡
  if (theme === "ide") {
    const turnSummary = formatTurnSummary(turn);
    return (
      <section className="vad-agent-row-enter space-y-2.5">
        {turn.user ? <TimelineRow item={turn.user} {...rowProps} /> : null}
        <div className="space-y-1.5 pl-0.5">
          {summaryParts.length > 0 || turn.status === "running" || turn.status === "waiting" ? (
            <div className="flex items-center gap-1.5 px-0.5 text-[10px] text-[var(--muted)]">
              <span className="font-medium text-[var(--foreground)]">{statusMeta.label}</span>
              {summaryParts.length > 0 ? <span>· {summaryParts.join(" · ")}</span> : null}
            </div>
          ) : null}
          {turn.status === "waiting" ? (
            <div className="flex items-center gap-1.5 px-0.5 text-[10px] text-amber-600 dark:text-amber-400">
              <span className="grid size-3.5 place-items-center">{statusMeta.icon}</span>
              <span>{statusMeta.label}</span>
            </div>
          ) : null}
          {turn.items.map((item, index) => (
            <div
              key={`${item.id}:${item.kind}:${index}`}
              className="vad-agent-row-enter"
            >
              <TimelineRow item={item} {...rowProps} />
            </div>
          ))}
          {turn.status === "running" && turn.items.length === 0 ? (
            <TurnWorkingPlaceholder project={project} />
          ) : null}
          {turnSummary ? (
            <p className="px-0.5 pt-0.5 text-[10px] tracking-[-0.01em] text-[var(--muted)]/80">
              {turnSummary}
            </p>
          ) : null}
        </div>
      </section>
    );
  }

  const shell =
    "rounded-xl border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-[var(--surface)]";
  const header =
    "border-b border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-[var(--surface-muted)]";

  return (
    <section className={`${shell} overflow-hidden`}>
      <div className={`${header} px-3 py-2`}>
        <div className="flex items-start gap-2.5">
          <span
            className={
              "mt-0.5 grid size-5 shrink-0 place-items-center rounded-md " +
              statusMeta.iconClass
            }
          >
            {statusMeta.icon}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-[11.5px] font-semibold text-[var(--foreground)]">
                {turn.title}
              </p>
              <span className="shrink-0 text-[10px] font-medium text-[var(--muted)]">
                {statusMeta.label}
              </span>
            </div>
            {summaryParts.length > 0 ? (
              <p className="mt-0.5 truncate text-[10px] text-[var(--muted)]">
                {summaryParts.join(" - ")}
              </p>
            ) : null}
          </div>
        </div>
      </div>
      <div className="space-y-3 px-3 py-3">
        {turn.user ? <TimelineRow item={turn.user} {...rowProps} /> : null}
        {turn.items.map((item, index) => (
          <TimelineRow
            key={`${item.id}:${item.kind}:${index}`}
            item={item}
            {...rowProps}
          />
        ))}
        {turn.status === "running" && turn.items.length === 0 ? (
          <TurnWorkingPlaceholder project={project} />
        ) : null}
      </div>
    </section>
  );
}

function TurnWorkingPlaceholder({ project }: { project?: ProjectFile }) {
  const generating = (project?.assets ?? []).filter(
    (a) => a.status === "generating"
  ).length;
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);
  const waitHint =
    generating > 0
      ? `画布上有 ${generating} 张素材生成中，进度会同步到这里…`
      : elapsed >= 20
        ? `已等待 ${elapsed}s，模型还没有返回内容。可按 Esc 停止后重试`
        : elapsed > 0
          ? `正在连接模型 / 规划下一步… ${elapsed}s`
          : "正在连接模型 / 规划下一步，请稍候…";
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-dashed border-[var(--primary)]/35 bg-[color-mix(in_srgb,var(--primary)_6%,transparent)] px-3 py-2.5">
      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-md bg-[var(--surface)] text-[var(--primary)]">
        <Loader2 className="size-3 animate-spin" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] font-semibold text-[var(--foreground)]">
          Agent 正在处理任务
        </p>
        <p className="mt-0.5 text-[11px] text-[var(--muted)]">{waitHint}</p>
      </div>
    </div>
  );
}

function getTurnStatusMeta(status: TimelineTurn["status"]) {
  if (status === "running") {
    return {
      label: "执行中",
      icon: <Loader2 className="size-3 animate-spin" />,
      iconClass: "bg-[var(--surface)] text-[var(--primary)]",
    };
  }
  if (status === "waiting") {
    return {
      label: "等待确认",
      icon: <HelpCircle className="size-3" />,
      iconClass: "bg-[var(--primary-soft)] text-[var(--primary)]",
    };
  }
  if (status === "failed") {
    return {
      label: "失败",
      icon: <XCircle className="size-3" />,
      iconClass: "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400",
    };
  }
  if (status === "cancelled") {
    return {
      label: "已取消",
      icon: <Square className="size-2.5" />,
      iconClass: "bg-[var(--surface)] text-[var(--muted)]",
    };
  }
  if (status === "completed") {
    return {
      label: "已完成",
      icon: <Check className="size-3" />,
      iconClass: "bg-[var(--primary)] text-white",
    };
  }
  return {
    label: "空闲",
    icon: <Circle className="size-2.5" />,
    iconClass: "bg-[var(--surface)] text-[var(--muted)]",
  };
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
  onDiscoverySubmit,
  onCancelRun,
  onImageConfirm,
  onToolConfirm,
  onToolCancel,
  onRetryUserMessage,
  onEditUserMessage,
  onRetryRun,
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
  onDiscoverySubmit?: (text: string) => void;
  onCancelRun?: () => void;
  onImageConfirm?: (prompt: string, count: number, prompts?: string[]) => void;
  onToolConfirm?: (
    runId: string,
    approvalId: string,
    args?: Record<string, unknown>
  ) => Promise<void> | void;
  onToolCancel?: (runId: string, approvalId: string) => Promise<void> | void;
  onRetryUserMessage?: (messageId: string, content: string) => void;
  onEditUserMessage?: (messageId: string, content: string) => void;
  onRetryRun?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollContentRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localCancelledJobIds, setLocalCancelledJobIds] = useState<Set<string>>(
    () => new Set()
  );
  const [showFullHistory, setShowFullHistory] = useState(false);
  const [turnWindowStart, setTurnWindowStart] = useState(0);
  const upsertProject = useProjectStore((s) => s.upsert);
  const rawTurns = useMemo(
    () => buildChatTimelineTurns(messages, liveEvents, isStreaming),
    [messages, liveEvents, isStreaming]
  );
  const turns = useMemo(() => {
    if (localCancelledJobIds.size === 0) return rawTurns;
    return rawTurns.map((turn) => ({
      ...turn,
      items: turn.items.map((item) =>
        item.kind === "job" && localCancelledJobIds.has(item.jobId)
          ? {
              ...item,
              status: "cancelled" as const,
              progress: item.progress || 0,
              message: item.message ?? "Cancelled",
            }
          : item
      ),
    }));
  }, [rawTurns, localCancelledJobIds]);
  const timeline = useMemo(
    () => turns.flatMap((turn) => (turn.user ? [turn.user, ...turn.items] : turn.items)),
    [turns]
  );
  const hiddenTurnCount = showFullHistory ? 0 : Math.max(0, turns.length - 12);
  const baseVisibleTurns = showFullHistory ? turns : turns.slice(-12);
  const shouldWindowTurns = showFullHistory && turns.length > TURN_WINDOW_SIZE + TURN_OVERSCAN;
  const windowStart = shouldWindowTurns
    ? Math.min(turnWindowStart, Math.max(0, baseVisibleTurns.length - TURN_WINDOW_SIZE))
    : 0;
  const windowEnd = shouldWindowTurns
    ? Math.min(baseVisibleTurns.length, windowStart + TURN_WINDOW_SIZE)
    : baseVisibleTurns.length;
  const visibleTurns = shouldWindowTurns
    ? baseVisibleTurns.slice(windowStart, windowEnd)
    : baseVisibleTurns;
  const topSpacerHeight = shouldWindowTurns ? windowStart * ESTIMATED_TURN_HEIGHT : 0;
  const bottomSpacerHeight = shouldWindowTurns
    ? Math.max(0, baseVisibleTurns.length - windowEnd) * ESTIMATED_TURN_HEIGHT
    : 0;

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

  // 流式指纹：内容变长（assistant/thought/job progress）也会触发贴底，不只看事件条数
  const streamFingerprint = useMemo(() => {
    let assistantChars = 0;
    let thoughtChars = 0;
    let jobProgress = 0;
    for (const item of timeline) {
      if (item.kind === "assistant") assistantChars += item.content.length;
      if (item.kind === "thought") thoughtChars += item.content.length;
      if (item.kind === "job") jobProgress += item.progress + item.completed;
    }
    return `${isStreaming}:${liveEvents.length}:${assistantChars}:${thoughtChars}:${jobProgress}:${timeline.length}`;
  }, [timeline, isStreaming, liveEvents.length]);

  // 新一轮开始时重新贴底（用户刚发送）
  useEffect(() => {
    if (isStreaming) {
      stickToBottomRef.current = true;
      setShowJumpToLatest(false);
    }
  }, [isStreaming]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottomRef.current) return;
    const pin = () => {
      el.scrollTop = el.scrollHeight;
    };
    pin();
    const raf = requestAnimationFrame(pin);
    return () => cancelAnimationFrame(raf);
  }, [streamFingerprint, visibleTurns.length]);

  // 内容高度变化时（流式打字 / Markdown 重排）持续贴底
   useEffect(() => {
    const el = scrollRef.current;
    const content = scrollContentRef.current;
    if (!el || !content || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (!stickToBottomRef.current) return;
      el.scrollTop = el.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!shouldWindowTurns) {
      if (turnWindowStart !== 0) setTurnWindowStart(0);
      return;
    }
    const maxStart = Math.max(0, baseVisibleTurns.length - TURN_WINDOW_SIZE);
    if (turnWindowStart > maxStart) setTurnWindowStart(maxStart);
  }, [baseVisibleTurns.length, shouldWindowTurns, turnWindowStart]);

  if (
    turns.length === 0 &&
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
  const timelineErrorMessages = new Set(
    timeline
      .filter((item): item is Extract<TimelineItem, { kind: "error" }> => item.kind === "error")
      .map((item) => normalizeUiError(item.message))
  );
  const displayError = [error, localError].find((message) => {
    if (!message) return false;
    return !timelineErrorMessages.has(normalizeUiError(message));
  });
  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");

  async function handleCancelJob(jobId: string) {
    setLocalError(null);
    setLocalCancelledJobIds((current) => {
      const next = new Set(current);
      next.add(jobId);
      return next;
    });
    try {
      const query = project?.id ? `?projectId=${encodeURIComponent(project.id)}` : "";
      const res = await fetch(`/api/jobs/${jobId}${query}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      }
    } catch (err) {
      setLocalCancelledJobIds((current) => {
        const next = new Set(current);
        next.delete(jobId);
        return next;
      });
      setLocalError((err as Error).message);
    }
  }

  async function handleRetryJob(jobId: string) {
    setLocalError(null);
    setLocalCancelledJobIds((current) => {
      if (!current.has(jobId)) return current;
      const next = new Set(current);
      next.delete(jobId);
      return next;
    });
    try {
      const query = project?.id ? `?projectId=${project.id}` : "";
      const res = await fetch(`/api/jobs/${jobId}${query}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      }
      if (data.project && project?.id === data.project.id) {
        upsertProject(data.project as ProjectFile);
      }
    } catch (err) {
      setLocalError((err as Error).message);
    }
  }

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
      <div className={fillHeight ? "relative min-h-0 flex-1 overflow-hidden" : "relative"}>
      <div
        ref={scrollRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
          // 滞回：贴底 <48 隐藏；远离 >120 才显示，避免流式增高时 Jump 按钮闪烁
          if (distance < 48) {
            stickToBottomRef.current = true;
            setShowJumpToLatest(false);
          } else if (distance > 120) {
            stickToBottomRef.current = false;
            if (!isStreaming || distance > 160) {
              setShowJumpToLatest(true);
            }
          }
          if (shouldWindowTurns) {
            const estimatedStart = Math.floor(el.scrollTop / ESTIMATED_TURN_HEIGHT) - TURN_OVERSCAN;
            const maxStart = Math.max(0, baseVisibleTurns.length - TURN_WINDOW_SIZE);
            const nextStart = Math.max(0, Math.min(maxStart, estimatedStart));
            setTurnWindowStart((current) => (current === nextStart ? current : nextStart));
          }
        }}
        className={
          (theme === "ide"
            ? "vad-agent-timeline overflow-y-auto overscroll-contain touch-pan-y scroll-smooth px-4 py-4"
            : "vad-agent-timeline overflow-y-auto overscroll-contain touch-pan-y scroll-smooth bg-[var(--surface)] px-4 py-3") +
          (fillHeight ? " absolute inset-0 min-h-0" : "")
        }
        style={fillHeight ? undefined : { maxHeight }}
      >
        <div
          ref={scrollContentRef}
          className={theme === "ide" ? "space-y-4" : "space-y-2.5"}
        >
        {theme === "home" ? (
          <ActivityBanner liveEvents={liveEvents} isStreaming={isStreaming} theme={theme} />
        ) : null}
        <PendingDiffBanner pendingCount={pendingPreviewCount} theme={theme} />
        {hiddenTurnCount > 0 ? (
          <button
            type="button"
            onClick={() => {
              stickToBottomRef.current = false;
              setTurnWindowStart(0);
              setShowFullHistory(true);
              requestAnimationFrame(() => {
                scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
              });
            }}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-[11px] font-medium text-[var(--muted-strong)] transition hover:border-[var(--primary)]/50 hover:text-[var(--foreground)]"
          >
            查看更早的 {hiddenTurnCount} 轮对话
          </button>
        ) : null}
        {topSpacerHeight > 0 ? (
          <div aria-hidden style={{ height: topSpacerHeight }} />
        ) : null}
        {visibleTurns.map((turn, index) => (
          <TurnBlock
            key={`${turn.id}:${index}`}
            turn={turn}
            theme={theme}
            project={project}
            diffDecisions={diffDecisions}
            diffPreviewMode={diffPreviewMode}
            onAcceptDiff={onAcceptDiff}
            onRejectDiff={onRejectDiff}
            onUndoAcceptDiff={onUndoAcceptDiff}
            onDiscoverySubmit={onDiscoverySubmit}
            onCancelJob={handleCancelJob}
            onRetryJob={handleRetryJob}
            onCancelRun={onCancelRun}
            onImageConfirm={onImageConfirm}
            onToolConfirm={onToolConfirm}
            onToolCancel={onToolCancel}
            onRetryUserMessage={onRetryUserMessage}
            onEditUserMessage={onEditUserMessage}
          />
        ))}
        {bottomSpacerHeight > 0 ? (
          <div aria-hidden style={{ height: bottomSpacerHeight }} />
        ) : null}
        {displayError ? <ErrorRecoveryCard theme={theme} message={displayError} retry={lastUserMessage && onRetryUserMessage ? () => onRetryUserMessage(lastUserMessage.id, lastUserMessage.content ?? "") : undefined} retryPhase={onRetryRun} /> : null}
        </div>
      </div>
      <button
        type="button"
        aria-label="回到最新消息"
        title="回到最新消息"
        data-visible={showJumpToLatest ? "true" : "false"}
        tabIndex={showJumpToLatest ? 0 : -1}
        onClick={() => {
          const el = scrollRef.current;
          if (!el) return;
          stickToBottomRef.current = true;
          el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
          setShowJumpToLatest(false);
        }}
        className="vad-agent-jump absolute bottom-3 right-4 grid size-7 place-items-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] shadow-[var(--shadow-soft)] hover:text-[var(--foreground)]"
      >
        <ArrowDown className="size-3.5" />
      </button>
      </div>
    </div>
  );
}
