"use client";

/**
 * IDE 智能助理侧栏 — Cursor Agent 质感
 * --------------------------------------------------------------
 * 毛玻璃顶栏 · 渐隐消息流 · 浮起 Composer · 克制空态
 * 配色沿用 Canvas Studio tokens。
 *
 * @author：wangjunhua
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowUp,
  AtSign,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  History,
  Image as ImageIcon,
  Loader2,
  Package,
  Palette,
  Square,
  X,
  XCircle,
} from "lucide-react";
import type { ChatMessage } from "@/lib/agents/chat-schema";
import type { ProjectFile } from "@/lib/project/schema";
import type { TurnSnapshot } from "@/lib/agents/turn-service";
import type { ReferenceAsset } from "@/lib/project/assets-schema";
import { upsertComposerReference, referenceFromAsset } from "@/lib/chat/composer-refs";
import type { ProviderConfig } from "@/lib/providers/registry";
import {
  useCanvasSelectionStore,
  type CanvasSelection,
} from "@/store/canvas-selection-store";
import { useCanvasUiStore } from "@/store/canvas-ui-store";
import type { ChatLiveEvent } from "@/lib/chat/use-chat-stream";
import type { DiffDecision } from "@/lib/chat/diff-preview";
import { filesToReferenceAssets } from "@/lib/chat/composer-attachments";
import {
  applySlashSelection,
  buildSlashItems,
  filterSlashItems,
  parseSlashQuery,
  type SlashItem,
} from "@/lib/chat/composer-slash";
import { ComposerModelChip } from "@/components/brand/composer-model-marks";
import { ConversationSwitcher } from "@/components/ide/conversation-switcher";
import { ComposerSlashMenu } from "@/components/ide/composer-slash-menu";
import { useChatStore } from "@/store/chat-store";
import { ChatTimelineBody } from "@/components/chat-timeline-body";
import { toolDisplayLabel } from "@/lib/chat/live-timeline";
import { useProjectStore } from "@/store/project-store";
import { isCanvasVisibleAsset } from "@/lib/project/asset-visibility";
import { releaseStuckGeneratingAssets } from "@/lib/canvas/spawn-child-asset";
import { useSkillCatalog } from "@/lib/skills/use-skill-catalog";

type RecoverableTimelineJob = {
  id: string;
  type: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress?: number;
  error?: string;
  result?: unknown;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  projectId?: string;
  runId?: string;
  threadId?: string;
  toolCallId?: string;
  batchId?: string;
  progressDetail?: {
    stage?: string;
    completed?: number;
    failed?: number;
    cancelled?: number;
    total?: number;
    message?: string;
  };
};

type AgentRunSummary = {
  runId: string;
  turnId?: string;
  threadId: string;
  projectId: string;
  status:
    | "accepted"
    | "running"
    | "waiting_user"
    | "cancelling"
    | "completed"
    | "failed"
    | "cancelled"
    | "interrupted";
  phase: string;
  phaseLabel: string;
  currentStep?: string;
  promptSummary?: string;
  retryPrompt?: string;
  retryInstruction?: string;
  phaseRetryInstruction?: string;
  canRetry?: boolean;
  startedAt: number;
  endedAt?: number;
  lastHeartbeatAt?: number;
  lastEventAt?: number;
  lastSeq?: number;
  durationMs: number;
  error?: string;
  pendingToolApproval?: {
    approvalId: string;
    checkpointInterruptId?: string;
    toolName: string;
    toolCallId?: string;
    args?: Record<string, unknown>;
    riskLevel: "safe" | "moderate" | "destructive" | "external";
    reason: string;
    model?: string;
    estimatedSeconds?: number;
    affectedAssets?: string[];
    requestedAt: number;
  };
  jobCount: number;
  events: {
    llmEvents: number;
    toolEvents: number;
    jobEvents: number;
    approvalEvents: number;
  };
};

type AgentRunDetail = {
  run: {
    runId: string;
    status: AgentRunSummary["status"];
    phaseLabel: string;
    durationMs: number;
    startedAt?: number;
    lastEventAt?: number;
    error?: string;
  };
  jobs: Array<{
    id?: string;
    type?: string;
    status?: string;
    progress?: number;
    stage?: string;
    completed?: number;
    failed?: number;
    cancelled?: number;
    total?: number;
    message?: string;
    error?: string;
  }>;
  events: Array<{
    type: string;
    seq?: number;
    at?: number;
    toolName?: string;
    riskLevel?: "safe" | "moderate" | "destructive" | "external";
    requiresConfirmation?: boolean;
    jobType?: string;
    progress?: number;
    message?: string;
    error?: string;
  }>;
};

function jobToTimelineEvent(job: RecoverableTimelineJob): ChatLiveEvent | null {
  const base = {
    jobId: job.id,
    jobType: job.type,
    projectId: job.projectId,
    runId: job.runId,
    threadId: job.threadId,
    toolCallId: job.toolCallId,
    batchId: job.batchId,
  };
  const at = job.completedAt ?? job.startedAt ?? job.createdAt ?? Date.now();
  const progress = job.progress ?? (job.status === "completed" ? 100 : 0);
  const id = `job:${job.id}:${job.status}`;

  if (job.status === "pending") {
    return {
      id,
      type: "job.queued",
      data: { ...base, progress, detail: job.progressDetail },
      at,
    };
  }
  if (job.status === "running") {
    return {
      id,
      type: "job.progress",
      data: { ...base, progress, detail: job.progressDetail },
      at,
    };
  }
  if (job.status === "completed") {
    return {
      id,
      type: "job.completed",
      data: { ...base, progress: 100, detail: job.progressDetail, result: job.result },
      at,
    };
  }
  if (job.status === "failed") {
    return {
      id,
      type: "job.failed",
      data: {
        ...base,
        progress,
        detail: job.progressDetail,
        error: job.error ?? "Job failed",
      },
      at,
    };
  }
  if (job.status === "cancelled") {
    return {
      id,
      type: "job.cancelled",
      data: { ...base, progress, detail: job.progressDetail },
      at,
    };
  }
  return null;
}

function pendingApprovalToTimelineEvent(run: AgentRunSummary): ChatLiveEvent | null {
  const pending = run.pendingToolApproval;
  if (!pending || run.status !== "waiting_user") return null;
  return {
    id: `pending-tool-confirm:${run.runId}:${pending.approvalId}`,
    type: "tool.confirm",
    at: pending.requestedAt ?? run.lastHeartbeatAt ?? run.startedAt,
    data: {
      runId: run.runId,
      approvalId: pending.approvalId,
      checkpointInterruptId: pending.checkpointInterruptId,
      title: `Execute ${pending.toolName}`,
      toolName: pending.toolName,
      toolCallId: pending.toolCallId,
      riskLevel: pending.riskLevel,
      args: pending.args,
      reason: pending.reason,
      model: pending.model,
      estimatedSeconds: pending.estimatedSeconds,
      affectedAssets: pending.affectedAssets,
      restored: true,
    },
  };
}

export function ChatStreamView({
  project,
  messages,
  liveEvents,
  status,
  connectionStatus,
  error,
  input,
  setInput,
  send,
  cancel,
  activePage,
  selection,
  providerConfig,
  onOpenImages,
  onOpenSettings,
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
  onRunPrompt,
  showEmptyHints = true,
  panelTitle = "Agent",
  composerDisabled = false,
  composerPlaceholder,
  queuedCount = 0,
  queuedItems,
  onClearQueue,
  onRemoveQueued,
  onRetryUserMessage,
  onEditUserMessage,
  runningConversationId,
}: {
  project: ProjectFile;
  messages: ChatMessage[];
  liveEvents: ChatLiveEvent[];
  status: string;
  connectionStatus?: "idle" | "connecting" | "streaming" | "waiting_user" | "cancelling" | "done" | "error";
  error: string | null;
  input: string;
  setInput: (value: string) => void;
  send: (
    text?: string,
    options?: { references?: ReferenceAsset[]; omitSelection?: boolean }
  ) => void;
  cancel: () => void;
  activePage: ProjectFile["pages"][number] | null;
  selection: CanvasSelection | null;
  providerConfig: ProviderConfig;
  onOpenImages: () => void;
  onOpenSettings?: () => void;
  diffDecisions?: Map<string, DiffDecision>;
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
  onRunPrompt?: (prompt: string) => void;
  showEmptyHints?: boolean;
  panelTitle?: string;
  composerDisabled?: boolean;
  composerPlaceholder?: string;
  queuedCount?: number;
  queuedItems?: string[];
  onClearQueue?: () => void;
  onRemoveQueued?: (index: number) => void;
  onRetryUserMessage?: (messageId: string, content: string) => void;
  onEditUserMessage?: (messageId: string, content: string) => void;
  runningConversationId?: string | null;
}) {
  const isStreaming = status === "streaming";
  const isCancelling = status === "cancelling";
  const isWaitingForUser = status === "waiting_user";
  const clearSelection = useCanvasSelectionStore((s) => s.clear);
  const [composerRefs, setComposerRefs] = useState<ReferenceAsset[]>([]);
  const [omitSelection, setOmitSelection] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [slashQuery, setSlashQuery] = useState<{ start: number; query: string } | null>(
    null
  );
  const [slashIndex, setSlashIndex] = useState(0);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const attachInputRef = useRef<HTMLInputElement | null>(null);
  const appliedComposerRefToken = useRef(0);
  const composerFocusToken = useCanvasUiStore((s) => s.composerFocusToken);
  const composerRefToken = useCanvasUiStore((s) => s.composerRefToken);
  const composerRefOffer = useCanvasUiStore((s) => s.composerRefOffer);
  const [recoveredJobs, setRecoveredJobs] = useState<RecoverableTimelineJob[]>([]);
  const [runHistory, setRunHistory] = useState<AgentRunSummary[]>([]);
  const [turnSnapshot, setTurnSnapshot] = useState<TurnSnapshot | null>(null);
  const [showRunHistory, setShowRunHistory] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [autoExpandFailedRunId, setAutoExpandFailedRunId] = useState<
    string | null
  >(null);
  const activeConversationTitle = useChatStore(
    (s) => s.getActiveConversation(project.id)?.title ?? "新对话"
  );

  // 画布重新选中时恢复 @ 引用
  useEffect(() => {
    setOmitSelection(false);
  }, [selection?.assetId, selection?.pageId, selection?.nodeId]);

  // 作品板空态 / 设为参考 → 聚焦 Composer
  useEffect(() => {
    if (composerFocusToken === 0) return;
    const el = composerInputRef.current;
    if (!el || composerDisabled) return;
    el.focus();
  }, [composerFocusToken, composerDisabled]);

  // 画布「设为参考」→ Composer chip（每 token 只消费一次，同图替换不叠）
  useEffect(() => {
    if (composerRefToken === 0 || !composerRefOffer) return;
    if (appliedComposerRefToken.current === composerRefToken) return;
    appliedComposerRefToken.current = composerRefToken;
    const offer = composerRefOffer;
    setComposerRefs((current) => upsertComposerReference(current, offer));
    useCanvasUiStore.getState().clearComposerRefOffer();
  }, [composerRefToken, composerRefOffer]);

  const composerDraftToken = useCanvasUiStore((s) => s.composerDraftToken);
  const composerDraftOffer = useCanvasUiStore((s) => s.composerDraftOffer);
  const appliedComposerDraftToken = useRef(0);
  useEffect(() => {
    if (composerDraftToken === 0 || !composerDraftOffer) return;
    if (appliedComposerDraftToken.current === composerDraftToken) return;
    appliedComposerDraftToken.current = composerDraftToken;
    setInput(composerDraftOffer);
    useCanvasUiStore.getState().clearComposerDraftOffer();
  }, [composerDraftToken, composerDraftOffer, setInput]);

  const upsertProject = useProjectStore((s) => s.upsert);
  const reloadFromDisk = useProjectStore((s) => s.reloadFromDisk);
  const { skills } = useSkillCatalog();
  const appliedJobProjectIdsRef = useRef<Set<string>>(new Set());
  const cleanedTerminalImageJobsRef = useRef<Set<string>>(new Set());
  const releasedStuckAssetsKeyRef = useRef<string>("");
  const lastImageJobReloadKeyRef = useRef("");
  const runHistoryJsonRef = useRef("");
  useEffect(() => {
    let disposed = false;
    let inFlight = false;

    async function loadRecoveredJobs() {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await fetch(`/api/jobs?projectId=${encodeURIComponent(project.id)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !Array.isArray(data.jobs)) return;
        if (!disposed) {
          setRecoveredJobs(data.jobs as RecoverableTimelineJob[]);
        }
      } catch {
        // The task center is the explicit error surface; timeline recovery stays quiet.
      } finally {
        inFlight = false;
      }
    }

    void loadRecoveredJobs();
    // 执行中加快轮询，避免生图进度长时间空白
    const intervalMs =
      status === "streaming" || status === "cancelling" || status === "waiting_user"
        ? 1500
        : 4000;
    const timer = window.setInterval(() => void loadRecoveredJobs(), intervalMs);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [project.id, status]);

  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    const loadTurn = async () => {
      const turnId = runHistory[0]?.turnId;
      if (!turnId || inFlight) return;
      inFlight = true;
      try {
        const response = await fetch(`/api/turns/${encodeURIComponent(turnId)}?projectId=${encodeURIComponent(project.id)}`);
        const snapshot = await response.json().catch(() => null);
        if (!disposed && response.ok && snapshot?.turnId === turnId) setTurnSnapshot(snapshot as TurnSnapshot);
      } catch {
        // Turn status is an enhancement; the live event stream remains authoritative.
      } finally {
        inFlight = false;
      }
    };
    void loadTurn();
    const timer = window.setInterval(() => void loadTurn(), status === "streaming" || status === "waiting_user" ? 1500 : 4000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [project.id, runHistory, status]);

  useEffect(() => {
    let disposed = false;
    let inFlight = false;

    async function loadRunHistory() {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await fetch(
          `/api/runs?projectId=${encodeURIComponent(project.id)}&limit=8`
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !Array.isArray(data.runs)) return;
        const json = JSON.stringify(data.runs);
        if (disposed || runHistoryJsonRef.current === json) return;
        runHistoryJsonRef.current = json;
        setRunHistory(data.runs as AgentRunSummary[]);
      } catch {
        // Run history is an audit aid; transport errors stay out of the chat.
      } finally {
        inFlight = false;
      }
    }

    void loadRunHistory();
    const intervalMs =
      status === "streaming" || status === "cancelling" || status === "waiting_user"
        ? 2000
        : 5000;
    const timer = window.setInterval(() => void loadRunHistory(), intervalMs);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [project.id, status]);

  // 失败时只标记可展开目标，不自动撑开运行记录（减少 chrome）
  useEffect(() => {
    const latest = runHistory[0];
    if (!latest) return;
    if (
      latest.status === "failed" ||
      latest.status === "interrupted" ||
      Boolean(latest.error)
    ) {
      setAutoExpandFailedRunId(latest.runId);
    }
  }, [runHistory]);

  // Esc 停止当前轮
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (!isStreaming && !isCancelling) return;
      event.preventDefault();
      cancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancel, isStreaming, isCancelling]);

  const timelineEvents = useMemo(() => {
    const liveJobIds = new Set(
      liveEvents
        .filter((event) => event.type.startsWith("job."))
        .map((event) => String((event.data as { jobId?: string })?.jobId ?? ""))
        .filter(Boolean)
    );
    const liveApprovalIds = new Set(
      liveEvents
        .filter((event) => event.type === "tool.confirm")
        .map((event) => String((event.data as { approvalId?: string })?.approvalId ?? ""))
        .filter(Boolean)
    );
    // 只恢复进行中的 job。已完成/失败的历史 materialize 等卡片若反复注入，
    // 会卡在侧栏对话中间，把新消息拆到上下两截。
     const recoveredEvents = recoveredJobs
      .filter((job) => !liveJobIds.has(job.id))
      .filter((job) => job.status === "pending" || job.status === "running")
      .map(jobToTimelineEvent)
      .filter((event): event is ChatLiveEvent => Boolean(event));
    const liveHasImageApproval = liveEvents.some((event) => {
      if (event.type === "image_generation.confirm") return true;
      if (event.type !== "tool.confirm") return false;
      const toolName = String((event.data as { toolName?: string })?.toolName ?? "");
      return (
        toolName === "generate_images" || toolName === "generate_image_variants"
      );
    });
    const pendingApprovalEvents = runHistory
      .map(pendingApprovalToTimelineEvent)
      .filter((event): event is ChatLiveEvent => Boolean(event))
      .filter((event) => {
        const approvalId = String((event.data as { approvalId?: string }).approvalId ?? "");
        if (!approvalId || liveApprovalIds.has(approvalId)) return false;
        const toolName = String((event.data as { toolName?: string }).toolName ?? "");
        if (
          liveHasImageApproval &&
          (toolName === "generate_images" ||
            toolName === "generate_image_variants")
        ) {
          return false;
        }
        return true;
      });
    const imagePending = pendingApprovalEvents.filter((event) => {
      const toolName = String((event.data as { toolName?: string }).toolName ?? "");
      return (
        toolName === "generate_images" || toolName === "generate_image_variants"
      );
    });
    const otherPending = pendingApprovalEvents.filter((event) => {
      const toolName = String((event.data as { toolName?: string }).toolName ?? "");
      return (
        toolName !== "generate_images" && toolName !== "generate_image_variants"
      );
    });
    const latestImagePending = imagePending.at(-1);
    return [
      ...otherPending,
      ...(latestImagePending ? [latestImagePending] : []),
      ...recoveredEvents,
      ...liveEvents,
    ];
  }, [liveEvents, recoveredJobs, runHistory]);

  const awaitingClickConfirm = timelineEvents.some(
    (event) =>
      event.type === "tool.confirm" || event.type === "image_generation.confirm"
  );
  const lockComposerForConfirm = isWaitingForUser && awaitingClickConfirm;

  useEffect(() => {
    for (const event of timelineEvents) {
      if (event.type !== "job.completed") continue;
      const data = event.data as {
        jobId?: string;
        projectId?: string;
        result?: { updatedProject?: ProjectFile };
      };
      const updatedProject = data.result?.updatedProject;
      if (!data.jobId || !updatedProject || updatedProject.id !== project.id) continue;
      if (appliedJobProjectIdsRef.current.has(data.jobId)) continue;
      appliedJobProjectIdsRef.current.add(data.jobId);
      upsertProject(updatedProject);
    }
  }, [project.id, timelineEvents, upsertProject]);

  // 生图 job 进行中：从磁盘拉回已持久化的 generating 占位 / 完成图
  useEffect(() => {
    const imageJobEvents = timelineEvents.filter((event) => {
      if (!event.type.startsWith("job.")) return false;
      const data = event.data as { jobType?: string; projectId?: string };
      return (
        data.projectId === project.id &&
        (data.jobType === "image_generation" ||
          data.jobType === "direct_image_generation")
      );
    });
    if (imageJobEvents.length === 0) return;
    const latestByJob = new Map<string, ChatLiveEvent>();
    for (const event of imageJobEvents) {
      const jobId = String((event.data as { jobId?: string })?.jobId ?? "");
      if (jobId) latestByJob.set(jobId, event);
    }
    const active = [...latestByJob.values()].filter(
      (event) =>
        event.type === "job.queued" ||
        event.type === "job.started" ||
        event.type === "job.progress"
    );
    if (active.length === 0) return;
    const reloadKey = active
      .map((event) => {
        const data = event.data as {
          jobId?: string;
          progress?: number;
          detail?: { completed?: number };
        };
        return `${data.jobId}:${data.progress ?? 0}:${data.detail?.completed ?? 0}`;
      })
      .sort()
      .join("|");
    if (reloadKey === lastImageJobReloadKeyRef.current) return;
    lastImageJobReloadKeyRef.current = reloadKey;
    void reloadFromDisk(project.id);
  }, [project.id, reloadFromDisk, timelineEvents]);

  useEffect(() => {
    const imageJobEvents = timelineEvents.filter((event) => {
      if (!event.type.startsWith("job.")) return false;
      const data = event.data as { jobType?: string; projectId?: string };
      return (
        data.projectId === project.id &&
        (data.jobType === "image_generation" || data.jobType === "direct_image_generation")
      );
    });
    if (imageJobEvents.length === 0) return;
    const latestByJob = new Map<string, ChatLiveEvent>();
    for (const event of imageJobEvents) {
      const jobId = String((event.data as { jobId?: string })?.jobId ?? "");
      if (jobId) latestByJob.set(jobId, event);
    }
    const latestImageJobEvents = [...latestByJob.values()];
    const hasActiveImageJob = latestImageJobEvents.some(
      (event) =>
        event.type === "job.queued" ||
        event.type === "job.started" ||
        event.type === "job.progress"
    );
    if (hasActiveImageJob) return;
    const terminal = [...latestImageJobEvents].reverse().find(
      (event) =>
        event.type === "job.completed" ||
        event.type === "job.failed" ||
        event.type === "job.cancelled"
    );
    const terminalData = terminal?.data as { jobId?: string; batchId?: string } | undefined;
    const terminalJobId = String(terminalData?.jobId ?? "");
    const batchId = terminalData?.batchId;
    if (terminalJobId && cleanedTerminalImageJobsRef.current.has(terminalJobId)) return;
    const currentAssets = project.assets ?? [];
    const nextAssets = releaseStuckGeneratingAssets(currentAssets, {
      hasActiveImageJob: false,
      terminalBatchId: typeof batchId === "string" ? batchId : null,
    });
    if (nextAssets === currentAssets) return;
    if (terminalJobId) cleanedTerminalImageJobsRef.current.add(terminalJobId);
    upsertProject({
      ...project,
      pages: project.pages,
      assets: nextAssets,
      updatedAt: new Date().toISOString(),
    });
  }, [project, timelineEvents, upsertProject]);

  useEffect(() => {
    if (isStreaming || isCancelling) return;
    const latestByJob = new Map<string, ChatLiveEvent>();
    for (const event of timelineEvents) {
      if (!event.type.startsWith("job.")) continue;
      const data = event.data as { jobType?: string; projectId?: string; jobId?: string };
      if (
        data.projectId !== project.id ||
        (data.jobType !== "image_generation" &&
          data.jobType !== "direct_image_generation")
      ) {
        continue;
      }
      const jobId = String(data.jobId ?? "");
      if (jobId) latestByJob.set(jobId, event);
    }
    const hasActiveImageJob = [...latestByJob.values()].some(
      (event) =>
        event.type === "job.queued" ||
        event.type === "job.started" ||
        event.type === "job.progress"
    );
    if (hasActiveImageJob) return;
    const currentAssets = project.assets ?? [];
    const stuckKey = currentAssets
      .filter(
        (asset) =>
          (asset.status ?? "candidate") === "generating" || asset.model === "pending"
      )
      .map((asset) => `${asset.id}:${asset.status ?? ""}:${asset.model ?? ""}`)
      .sort()
      .join("|");
    if (stuckKey && stuckKey === releasedStuckAssetsKeyRef.current) return;
    const nextAssets = releaseStuckGeneratingAssets(currentAssets, {
      hasActiveImageJob: false,
    });
    if (nextAssets === currentAssets) {
      releasedStuckAssetsKeyRef.current = stuckKey;
      return;
    }
    releasedStuckAssetsKeyRef.current = stuckKey;
    upsertProject({
      ...project,
      pages: project.pages,
      assets: nextAssets,
      updatedAt: new Date().toISOString(),
    });
  }, [isCancelling, isStreaming, project, timelineEvents, upsertProject]);

  const latestJob = [...timelineEvents]
    .reverse()
    .find((event) => event.type.startsWith("job."));
  const latestJobData = latestJob?.data as {
    progress?: number;
    jobType?: string;
    detail?: { completed?: number; total?: number; message?: string };
  } | undefined;
  const latestRunEvent = [...timelineEvents]
    .reverse()
    .find((event) => event.type === "thinking" || event.type === "tool_call");
  const latestLlmEvent = [...timelineEvents]
    .reverse()
    .find((event) => event.type.startsWith("llm."));
  const hasFallback = timelineEvents.some((event) => {
    if (event.type !== "agent.fallback") return false;
    const data = event.data as { reason?: string; text?: string };
    return (
      data.reason === "llm_unavailable" ||
      /LLM 请求不可用|LLM unavailable|local rule engine|规则流程/i.test(
        data.text ?? ""
      )
    );
  });
  const runStartedAt = [...timelineEvents]
    .reverse()
    .find((event) => event.type === "run.started")?.at;
  // 欢迎页：仅看本会话是否已有消息。勿用 timelineEvents/liveEvents 门闩——
  // 项目级 recovered job / 残留 live 会让 hasConversation=true，而
  // ChatTimelineBody 在无可见 turn 时 return null，侧栏就变成空白。
  const hasRecoveredWork = recoveredJobs.some((job) => job.status === "pending" || job.status === "running");
  const failedRun = runHistory.find((run) => (run.status === "failed" || run.status === "interrupted") && run.phaseRetryInstruction);
  const showWelcome =
    showEmptyHints &&
    messages.length === 0 &&
    !hasRecoveredWork &&
    !isStreaming &&
    !isCancelling &&
    !isWaitingForUser;
  const hasConversation = messages.length > 0 || isStreaming || isWaitingForUser || hasRecoveredWork;
  const runProgress = latestJobData?.progress ?? 0;
  const generatingOnCanvas = (project.assets ?? []).filter(
    (a) => a.status === "generating"
  ).length;
  const activeJob =
    latestJob &&
    !["job.completed", "job.failed", "job.cancelled"].includes(latestJob.type)
      ? latestJob
      : null;
  const imageJobBusy = Boolean(
    generatingOnCanvas > 0 ||
      (activeJob &&
        (latestJobData?.jobType === "image_generation" ||
          latestJobData?.jobType === "direct_image_generation" ||
          /图片生成|Generating image/i.test(latestJobData?.detail?.message ?? "")))
  );

  useEffect(() => {
    useCanvasUiStore.getState().setImageJobBusy(imageJobBusy);
    return () => {
      useCanvasUiStore.getState().setImageJobBusy(false);
    };
  }, [imageJobBusy]);
  // 顶部进度条只服务「可量化的后台任务」（生图 job / 画布 generating）
  // 思考/工具/等待确认等状态只走 header 一行，避免与时间线重复
  const showRunStrip =
    hasConversation &&
    (Boolean(activeJob) || generatingOnCanvas > 0) &&
    !isWaitingForUser;
  const stripTitle =
    activeJob && latestJobData?.detail?.total
      ? `素材生成 ${latestJobData.detail.completed ?? 0}/${latestJobData.detail.total}`
      : activeJob
        ? latestJobData?.detail?.message ?? "后台任务执行中"
        : `画布生成中 ${generatingOnCanvas}`;
  const activityLabel = isCancelling
    ? "取消中"
    : isWaitingForUser
      ? "等待确认"
      : hasFallback
        ? "本地规则引擎"
        : activeJob
          ? latestJobData?.detail?.total
            ? `素材 ${latestJobData.detail.completed ?? 0}/${latestJobData.detail.total}`
            : latestJobData?.detail?.message ?? "后台任务"
          : generatingOnCanvas > 0
            ? `画布生成 ${generatingOnCanvas}`
            : isStreaming
              ? latestRunEvent?.type === "tool_call"
                ? "执行工具"
                : latestRunEvent?.type === "thinking"
                  ? "取消中"
                  : latestLlmEvent?.type === "llm.failed"
                    ? "模型失败"
                    : latestLlmEvent?.type === "llm.started" ||
                        latestLlmEvent?.type === "llm.requested"
                      ? "请求模型"
                      : "连接中"
              : status === "error"
                ? "取消中"
                : "就绪";
  const canQueueOrSend =
    !composerDisabled &&
    !isCancelling &&
    !lockComposerForConfirm &&
    (Boolean(input.trim()) || composerRefs.length > 0);
  const contextChips = buildContextChips({
    project,
    activePageName: activePage?.name,
    selection: omitSelection ? null : selection,
  });

  function submitComposer() {
    if (!canQueueOrSend) return;
    const refs = composerRefs;
    const text = input;
    // 乐观清空：send(text) 会让 ide-shell 的 submittedText != null，不会自行 setInput("")
    setInput("");
    setComposerRefs([]);
    void send(text, {
      references: refs.length > 0 ? refs : undefined,
      omitSelection,
    });
  }

  async function ingestFiles(
    fileList: FileList | File[],
    source: "clipboard" | "upload" = "clipboard"
  ) {
    const files = Array.from(fileList);
    const added = await filesToReferenceAssets(files, composerRefs.length, source);
    if (added.length === 0) return;
    setComposerRefs((current) =>
      added.reduce(
        (acc, ref) => upsertComposerReference(acc, ref),
        current
      )
    );
  }

  const slashItems = useMemo(() => {
    const assets = (project.assets ?? [])
      .filter(isCanvasVisibleAsset)
      .filter((asset) => Boolean(asset.src));
    return filterSlashItems(
      slashQuery?.query ?? "",
      buildSlashItems({ assets, skills })
    );
  }, [project.assets, skills, slashQuery?.query]);

  function syncSlash(text: string, cursor: number) {
    const next = parseSlashQuery(text, cursor);
    setSlashQuery(next);
    if (!next) setSlashIndex(0);
  }

  function applySlashItem(item: SlashItem) {
    const el = composerInputRef.current;
    const cursor = el?.selectionStart ?? input.length;
    const parsed = slashQuery ?? parseSlashQuery(input, cursor);
    if (!parsed) return;
    let nextText = applySlashSelection(input, parsed.start, cursor);
    if (item.kind === "command" && item.insert) {
      nextText = `${nextText}${item.insert}`;
    }
    if (item.kind === "asset" && item.assetId) {
      const asset = project.assets?.find((entry) => entry.id === item.assetId);
      if (asset?.src) {
        setComposerRefs((current) =>
          upsertComposerReference(current, referenceFromAsset(asset))
        );
      }
    }
    if (item.kind === "skill" && item.skillName) {
      const skill = skills.find((entry) => entry.name === item.skillName);
      if (skill && skill.name !== project.skillId) {
        upsertProject({
          ...project,
          skillId: skill.name,
          skillVersion: skill.version,
          designSystemId: skill.recommendedDesignSystem ?? project.designSystemId,
          updatedAt: new Date().toISOString(),
        });
      }
    }
    setInput(nextText);
    setSlashQuery(null);
    setSlashIndex(0);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = nextText.length;
      el?.setSelectionRange(pos, pos);
    });
  }

  const suggestionChips =
    selection?.kind === "asset"
      ? ["生成 2 个变体", "生成 4 个变体", "换个配色", "局部重绘这张"]
      : ["生成 1 张视觉素材", "生成深色版本", "补充一张视觉图", "导出交付包"];
  const hasFailedRun = runHistory.some(
    (run) =>
      run.status === "failed" ||
      run.status === "interrupted" ||
      Boolean(run.error)
  );

  return (
    <aside className="vad-agent-panel flex h-full min-w-0 flex-col overflow-hidden border-l border-[var(--border)]">
      <header className="vad-agent-header">
        <ConversationSwitcher
          projectId={project.id}
          runningConversationId={runningConversationId}
        />
        <div className="flex shrink-0 items-center gap-0.5">
          <span
            className={
              "vad-agent-status" +
              (activityLabel === "就绪" ? " vad-agent-status--idle" : "")
            }
            data-tip={activityLabel}
            data-tip-bottom=""
          >
            <span
              className={
                "vad-agent-status__dot " +
                (isStreaming ||
                isCancelling ||
                Boolean(activeJob) ||
                generatingOnCanvas > 0
                  ? "vad-agent-status__dot--busy"
                  : status === "error" || hasFailedRun
                    ? "vad-agent-status__dot--err"
                    : isWaitingForUser
                      ? "vad-agent-status__dot--wait"
                      : "vad-agent-status__dot--ready")
              }
              aria-hidden
            />
            {activityLabel === "就绪" ? (
              <span className="sr-only">{activityLabel}</span>
            ) : (
              <span className="vad-agent-status__label">{activityLabel}</span>
            )}
          </span>
          <ConnectionStatus status={connectionStatus ?? "idle"} recovered={hasRecoveredWork} />
          <span className="sr-only">{panelTitle}</span>
          {runHistory.length > 0 ? (
            <button
              type="button"
              data-tip="运行记录"
              data-tip-bottom=""
              aria-label="运行记录"
              aria-pressed={showRunHistory}
              onClick={() => setShowRunHistory((value) => !value)}
              className={
                "vad-agent-icon-btn " +
                (showRunHistory || hasFailedRun
                  ? "text-[var(--foreground)]"
                  : "")
              }
            >
              <History className="size-3.5" />
            </button>
          ) : null}
        </div>
      </header>

      {showRunStrip ? (
        <div className="vad-agent-run-strip shrink-0">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <div className="min-w-0 flex items-center gap-1.5">
              <Loader2 className="size-3 shrink-0 animate-spin text-[var(--primary)]" />
              <p className="truncate text-[10px] font-medium text-[var(--foreground)]">
                {stripTitle}
              </p>
              {runStartedAt ? (
                <span className="shrink-0 text-[9px] text-[var(--muted)]">
                  {formatElapsed(Date.now() - runStartedAt)}
                </span>
              ) : null}
            </div>
            {latestJobData?.detail?.total ? (
              <span className="shrink-0 text-[9px] font-semibold tabular-nums text-[var(--muted-strong)]">
                {Math.round(runProgress)}%
              </span>
            ) : null}
          </div>
          {latestJobData?.detail?.total ? (
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--border)]/70">
              <div
                className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-300"
                style={{ width: `${Math.max(2, Math.min(100, runProgress))}%` }}
              />
            </div>
          ) : (
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--border)]/70">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-[var(--primary)]/70" />
            </div>
          )}
        </div>
      ) : null}

      {turnSnapshot ? <TurnStatusStrip snapshot={turnSnapshot} /> : null}

      {showRunHistory && runHistory.length > 0 ? (
        <RunHistoryPanel
          projectId={project.id}
          runs={runHistory}
          open
          autoExpandRunId={autoExpandFailedRunId}
          onRestorePrompt={(prompt) => {
            setInput(prompt);
            setShowRunHistory(false);
          }}
          onRunPrompt={onRunPrompt}
          onToggle={() => setShowRunHistory(false)}
        />
      ) : null}

      <div className="relative flex min-h-0 flex-1 flex-col">
        {showWelcome ? (
          <EmptyAgentState
            projectTitle={project.title}
            conversationTitle={activeConversationTitle}
            setInput={setInput}
            onOpenImages={onOpenImages}
          />
        ) : (
          <div className="vad-agent-scroll flex min-h-0 flex-1 flex-col overflow-hidden">
            <ChatTimelineBody
              theme="ide"
              project={project}
              messages={messages}
              liveEvents={timelineEvents}
              isStreaming={isStreaming}
              error={error}
              fillHeight
              diffDecisions={diffDecisions}
              diffPreviewMode={diffPreviewMode}
              onAcceptDiff={onAcceptDiff}
              onRejectDiff={onRejectDiff}
              onUndoAcceptDiff={onUndoAcceptDiff}
              onDiscoverySubmit={onDiscoverySubmit}
              onCancelRun={onCancelRun}
              onImageConfirm={onImageConfirm}
              onToolConfirm={onToolConfirm}
              onToolCancel={onToolCancel}
              onRetryUserMessage={onRetryUserMessage}
              onEditUserMessage={onEditUserMessage}
              onRetryRun={failedRun && onRunPrompt ? () => onRunPrompt(failedRun.phaseRetryInstruction!) : undefined}
              className="flex min-h-0 flex-1 flex-col rounded-none border-0 bg-transparent"
            />
          </div>
        )}
      </div>

      <div className="vad-agent-composer-wrap shrink-0">
        {queuedCount > 0 ? (
          <div className="vad-agent-queue">
            <button type="button" onClick={() => setShowQueue((value) => !value)} className="vad-agent-queue__text text-left">队列详情 {showQueue ? "⌃" : "⌄"}</button>
            <p className="vad-agent-queue__text">
              已排队 {queuedCount} 条，当前轮结束后发送
              </p>
            {onClearQueue ? (
              <button
                type="button"
                onClick={onClearQueue}
                className="vad-agent-queue__clear"
              >
                <X className="size-3" />
                清空
              </button>
            ) : null}
            {showQueue ? <div className="mt-2 w-full space-y-1 border-t border-[var(--border)] pt-2">{(queuedItems ?? []).map((item, index) => <div key={`${index}:${item}`} className="flex items-start gap-2 rounded-md bg-[var(--surface-muted)] px-2 py-1.5"><span className="min-w-0 flex-1 text-[10px] leading-relaxed text-[var(--muted-strong)]">{index + 1}. {item}</span>{onRemoveQueued ? <button type="button" onClick={() => onRemoveQueued(index)} aria-label={`删除排队消息 ${index + 1}`} className="shrink-0 p-0.5 text-[var(--muted)] hover:text-[var(--danger)]"><X className="size-3" /></button> : null}</div>)}</div> : null}
          </div>
        ) : null}

        {!showWelcome &&
        hasConversation &&
        !isStreaming &&
        !isCancelling &&
        !isWaitingForUser &&
        !composerDisabled ? (
          <div className="vad-agent-suggest-row">
            {suggestionChips.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => setInput(chip)}
                className="vad-agent-suggest"
              >
                {chip}
              </button>
            ))}
          </div>
        ) : null}

        <div
          className={
            "vad-agent-composer " +
            (dragOver ? "ring-2 ring-[var(--primary)]/35" : "")
          }
          onDragEnter={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
            setDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void ingestFiles(e.dataTransfer.files);
          }}
        >
          {slashQuery ? (
            <ComposerSlashMenu
              items={slashItems}
              activeIndex={
                slashItems.length === 0
                  ? 0
                  : slashIndex % slashItems.length
              }
              onHover={setSlashIndex}
              onSelect={applySlashItem}
            />
          ) : null}
          {contextChips.length > 0 || composerRefs.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
              {contextChips.map((chip) => (
                <span key={chip.key} className="vad-agent-context-chip">
                  <AtSign className="size-3 opacity-70" aria-hidden />
                  <span className="truncate">{chip.label}</span>
                  {chip.dismissible ? (
                    <button
                      type="button"
                      aria-label={`移除 ${chip.label}`}
                      onClick={() => {
                        if (chip.key === "selection") {
                          setOmitSelection(true);
                          clearSelection();
                        }
                      }}
                      className="ml-0.5 grid size-3.5 place-items-center rounded-sm opacity-60 hover:opacity-100"
                    >
                      <X className="size-2.5" />
                    </button>
                  ) : null}
                </span>
              ))}
              {composerRefs.map((ref) => (
                <span key={ref.id} className="vad-agent-context-chip">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={ref.src}
                    alt=""
                    className="size-3.5 rounded-sm object-cover"
                  />
                  <span className="max-w-[7rem] truncate">{ref.label}</span>
                  <button
                    type="button"
                    aria-label={`移除 ${ref.label}`}
                    onClick={() =>
                      setComposerRefs((current) =>
                        current.filter((item) => item.id !== ref.id)
                      )
                    }
                    className="ml-0.5 grid size-3.5 place-items-center rounded-sm opacity-60 hover:opacity-100"
                  >
                    <X className="size-2.5" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <textarea
            ref={composerInputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              syncSlash(e.target.value, e.target.selectionStart ?? 0);
            }}
            onClick={(e) => {
              syncSlash(input, e.currentTarget.selectionStart ?? 0);
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files ?? []).filter((f) =>
                f.type.startsWith("image/")
              );
              if (files.length === 0) return;
              e.preventDefault();
              void ingestFiles(files);
            }}
            onKeyDown={(e) => {
              if (slashQuery) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSlashIndex((index) =>
                    slashItems.length === 0
                      ? 0
                      : (index + 1) % slashItems.length
                  );
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSlashIndex((index) =>
                    slashItems.length === 0
                      ? 0
                      : (index - 1 + slashItems.length) % slashItems.length
                  );
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setSlashQuery(null);
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  const item = slashItems[slashIndex];
                  if (item) {
                    e.preventDefault();
                    applySlashItem(item);
                    return;
                  }
                }
                if (e.key === "Tab" && slashItems[slashIndex]) {
                  e.preventDefault();
                  applySlashItem(slashItems[slashIndex]);
                  return;
                }
              }
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                submitComposer();
              }
            }}
            placeholder={
              composerPlaceholder ??
              (isStreaming
                ? "继续输入将排队，Esc 停止…"
                : selection?.kind === "asset" && !omitSelection
                  ? `针对「${(selection.pageName || "这张图").slice(0, 24)}」继续改…`
                  : "描述内容，输入 / 选择素材或 Skill…")
            }
            rows={2}
            disabled={composerDisabled || isCancelling || lockComposerForConfirm}
            className="vad-agent-composer-input"
          />

          <div className="flex items-center justify-between gap-2 px-2.5 pb-2 pt-0.5">
            <ComposerModelChip
              config={providerConfig}
              className="vad-agent-model-btn"
              onOpenSettings={onOpenSettings ?? (() => {})}
            />

            <div className="flex items-center gap-0.5">
              <input
                ref={attachInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                hidden
                onChange={(event) => {
                  const files = event.currentTarget.files;
                  if (files?.length) void ingestFiles(files, "upload");
                  event.currentTarget.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => attachInputRef.current?.click()}
                data-tip="添加图片"
                data-tip-bottom=""
                aria-label="添加图片"
                className="vad-agent-icon-btn"
              >
                <ImageIcon className="size-3.5" />
              </button>
              {isStreaming ? (
                <>
                  <button
                    type="button"
                    onClick={submitComposer}
                    disabled={!canQueueOrSend}
                    data-tip="排队发送"
                    data-tip-bottom=""
                    aria-label="排队发送"
                    className="vad-agent-icon-btn"
                  >
                    <ArrowUp className="size-3.5" strokeWidth={2.5} />
                  </button>
                  <button
                    type="button"
                    onClick={cancel}
                    disabled={isCancelling}
                    aria-label="停止生成"
                    className="vad-agent-send vad-agent-send--stop"
                  >
                    <Square className="size-2.5 fill-current" />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={submitComposer}
                  disabled={!canQueueOrSend}
                  data-tip="发送"
                  data-tip-bottom=""
                  aria-label="发送"
                  className={
                    "vad-agent-send" +
                    (canQueueOrSend ? " vad-agent-send--ready" : "")
                  }
                >
                  <ArrowUp className="size-3.5" strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function ConnectionStatus({ status, recovered }: { status: string; recovered: boolean }) {
  const meta = status === "connecting"
    ? { label: "连接本地", tone: "text-[var(--muted)]", dot: "bg-[var(--muted)]" }
    : status === "error"
      ? { label: "连接异常", tone: "text-[var(--danger)]", dot: "bg-[var(--danger)]" }
      : recovered
        ? { label: "已恢复", tone: "text-[var(--success)]", dot: "bg-[var(--success)]" }
        : { label: "已连接", tone: "text-[var(--success)]", dot: "bg-[var(--success)]" };
  return <span className={`ml-1 hidden items-center gap-1 text-[9px] ${meta.tone} sm:inline-flex`} title="WebSocket Agent 连接状态"><span className={`size-1.5 rounded-full ${meta.dot}`} />{meta.label}</span>;
}

function TurnStatusStrip({ snapshot }: { snapshot: TurnSnapshot }) {
  const activeJobs = snapshot.jobs.filter((job) => job.status === "pending" || job.status === "running");
  const progress = snapshot.jobs.length
    ? Math.round(snapshot.jobs.reduce((sum, job) => sum + (job.progress ?? (job.status === "completed" ? 100 : 0)), 0) / snapshot.jobs.length)
    : 0;
  const statusLabel: Record<TurnSnapshot["status"], string> = {
    accepted: "已接受",
    running: "执行记录",
    waiting_user: "等待确认",
    completed: "本轮完成",
    failed: "需要处理",
    cancelled: "已取消",
    interrupted: "已中断",
  };
  return (
    <div className="shrink-0 border-b border-[var(--border)] bg-[var(--surface-muted)]/45 px-3 py-2">
      <div className="flex items-center justify-between gap-2 text-[10px]">
        <span className="font-medium text-[var(--foreground)]">{statusLabel[snapshot.status]}</span>
        <span className="text-[var(--muted)]">{snapshot.phase ?? "—"}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-[9px] text-[var(--muted)]">
        <span>{snapshot.counts.completedJobs}/{snapshot.counts.jobs} 后台任务</span>
        {snapshot.counts.failedJobs > 0 ? <span className="text-[var(--danger)]">{snapshot.counts.failedJobs} 失败</span> : null}
        {activeJobs.length > 0 ? <span className="text-[var(--primary)]">{progress}%</span> : null}
        {snapshot.canHandoff ? <span className="ml-auto text-[var(--success)]">可交付</span> : null}
      </div>
      {activeJobs.length > 0 ? <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--border)]"><div className="h-full rounded-full bg-[var(--primary)] transition-[width]" style={{ width: `${Math.max(2, progress)}%` }} /></div> : null}
    </div>
  );
}

function RunHistoryPanel({
  projectId,
  runs,
  open,
  autoExpandRunId,
  onRestorePrompt,
  onRunPrompt,
  onToggle,
}: {
  projectId: string;
  runs: AgentRunSummary[];
  open: boolean;
  autoExpandRunId?: string | null;
  onRestorePrompt: (prompt: string) => void;
  onRunPrompt?: (prompt: string) => void;
  onToggle: () => void;
}) {
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, AgentRunDetail>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [localCancelledRunIds, setLocalCancelledRunIds] = useState<Set<string>>(
    () => new Set()
  );
  const [historyFilter, setHistoryFilter] = useState<"all" | "active" | "failed">("all");
  const activeRun = runs.find((run) =>
    ["accepted", "running", "waiting_user", "cancelling"].includes(run.status)
  );
  const latestRun = runs[0];
  const summaryRun = activeRun ?? latestRun;
  const summary = summaryRun ? runStatusMeta(summaryRun.status) : null;

  async function loadDetails(runId: string) {
    if (detailCache[runId] || detailLoadingId === runId) return;
    setDetailLoadingId(runId);
    setDetailError(null);
    try {
      const res = await fetch(
        `/api/runs/${encodeURIComponent(runId)}?projectId=${encodeURIComponent(projectId)}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      setDetailCache((current) => ({
        ...current,
        [runId]: data as AgentRunDetail,
      }));
    } catch (err) {
      setDetailError((err as Error).message);
    } finally {
      setDetailLoadingId((current) => (current === runId ? null : current));
    }
  }

  useEffect(() => {
    if (!open || !autoExpandRunId) return;
    setExpandedRunId(autoExpandRunId);
    void loadDetails(autoExpandRunId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to autoExpand target
  }, [open, autoExpandRunId]);

  async function toggleDetails(runId: string) {
    setDetailError(null);
    if (expandedRunId === runId) {
      setExpandedRunId(null);
      return;
    }
    setExpandedRunId(runId);
    await loadDetails(runId);
  }

  async function cancelRun(runId: string) {
    setDetailError(null);
    setLocalCancelledRunIds((current) => {
      const next = new Set(current);
      next.add(runId);
      return next;
    });
    try {
      const res = await fetch(
        `/api/runs/${encodeURIComponent(runId)}?projectId=${encodeURIComponent(projectId)}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      setDetailCache((current) => {
        const detail = current[runId];
        if (!detail) return current;
        return {
          ...current,
          [runId]: {
            ...detail,
            run: { ...detail.run, status: "cancelled" },
          },
        };
      });
    } catch (err) {
      setLocalCancelledRunIds((current) => {
        const next = new Set(current);
        next.delete(runId);
        return next;
      });
      setDetailError((err as Error).message);
    }
  }

  function displayRun(run: AgentRunSummary): AgentRunSummary {
    if (!localCancelledRunIds.has(run.runId)) return run;
    return { ...run, status: "cancelled" };
  }

  const visibleRuns = runs.filter((run) => {
    if (historyFilter === "active") return ["accepted", "running", "waiting_user", "cancelling"].includes(run.status);
    if (historyFilter === "failed") return run.status === "failed" || run.status === "interrupted" || Boolean(run.error);
    return true;
  });

  return (
    <section className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)]/70 px-3 py-2">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 rounded-md px-1 py-1 text-left transition hover:bg-[var(--surface-muted)]"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Clock3 className="size-3.5 shrink-0 text-[var(--muted)]" />
          <span className="truncate text-[11px] font-semibold text-[var(--foreground)]">
            最近运行
          </span>
          {summary ? (
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold ${summary.className}`}>
              {summary.label}
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[10px] text-[var(--muted)]">
          {runs.length}
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </span>
      </button>

      {open ? (
        <>
        <div className="mt-1.5 flex gap-1" role="tablist" aria-label="运行记录筛选">
          {([['all', '全部'], ['active', '进行中'], ['failed', '失败']] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={historyFilter === value} onClick={() => setHistoryFilter(value)} className={`rounded-md px-2 py-1 text-[11px] ${historyFilter === value ? "bg-[var(--primary-soft)] font-semibold text-[var(--primary)]" : "text-[var(--muted)] hover:bg-[var(--surface-muted)]"}`}>{label}</button>)}
        </div>
        <ol className="mt-1.5 space-y-1">
          {visibleRuns.slice(0, 6).map((sourceRun) => {
            const run = displayRun(sourceRun);
            const meta = runStatusMeta(run.status);
            const canCancel = isCancellableRunStatus(sourceRun.status);
            return (
              <li
                key={run.runId}
                className="rounded-md border border-[var(--border)]/70 bg-[var(--background)]/55 px-2.5 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-[10px] font-medium text-[var(--foreground)]">
                    {meta.icon}
                    <span className="truncate">{run.phaseLabel || run.phase}</span>
                  </span>
                  <span className="shrink-0 text-[9px] text-[var(--muted)]">
                    {formatClock(run.startedAt)}
                  </span>
                </div>
                {run.promptSummary ? (
                  <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-[var(--muted)]">
                    {run.promptSummary}
                  </p>
                ) : null}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-[var(--muted)]">
                  <span>{meta.label}</span>
                  <span>{formatElapsed(run.durationMs)}</span>
                  <span>LLM {run.events.llmEvents}</span>
                  <span>工具 {run.events.toolEvents}</span>
                  <span>任务 {Math.max(run.jobCount, run.events.jobEvents)}</span>
                  {run.events.approvalEvents > 0 ? <span>确认 {run.events.approvalEvents}</span> : null}
                  {run.currentStep ? <span className="truncate">step: {run.currentStep}</span> : null}
                </div>
                {run.error ? (
                  <p className="mt-1 whitespace-pre-wrap break-words text-[9px] leading-relaxed text-red-600 dark:text-red-400">
                    {run.error}
                  </p>
                ) : null}
                {run.retryPrompt ? (
                  <div className="mt-2 flex flex-wrap justify-end gap-1.5">
                    {canCancel ? (
                      <button
                        type="button"
                        onClick={() => void cancelRun(run.runId)}
                        className="rounded-md border border-red-200/80 px-2 py-1 text-[9px] font-medium text-red-600 transition hover:bg-red-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/30"
                      >
                        取消
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void toggleDetails(run.runId)}
                      className="rounded-md border border-[var(--border)] px-2 py-1 text-[9px] font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-muted)]"
                    >
                      {expandedRunId === run.runId ? "收起详情" : "详情"}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRestorePrompt(run.retryPrompt!)}
                      className="rounded-md border border-[var(--border)] px-2 py-1 text-[9px] font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-muted)]"
                    >
                      恢复输入
                    </button>
                    {onRunPrompt && run.phaseRetryInstruction ? (
                      <button
                        type="button"
                        onClick={() => onRunPrompt(run.phaseRetryInstruction!)}
                        className="rounded-md border border-[var(--border)] px-2 py-1 text-[9px] font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-muted)]"
                      >
                        重跑阶段
                      </button>
                    ) : null}
                    {onRunPrompt && run.retryInstruction ? (
                      <button
                        type="button"
                        onClick={() => onRunPrompt(run.retryInstruction!)}
                        className="rounded-md bg-[var(--primary)] px-2 py-1 text-[11px] font-semibold text-[var(--vad-accent-fg-on)] transition hover:opacity-90"
                      >
                        重试此 Run
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap justify-end gap-1.5">
                    {canCancel ? (
                      <button
                        type="button"
                        onClick={() => void cancelRun(run.runId)}
                        className="rounded-md border border-red-200/80 px-2 py-1 text-[9px] font-medium text-red-600 transition hover:bg-red-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/30"
                      >
                        取消
                      </button>
                    ) : null}
                    {onRunPrompt && run.phaseRetryInstruction ? (
                      <button
                        type="button"
                        onClick={() => onRunPrompt(run.phaseRetryInstruction!)}
                        className="rounded-md border border-[var(--border)] px-2 py-1 text-[9px] font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-muted)]"
                      >
                        重跑阶段
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void toggleDetails(run.runId)}
                      className="rounded-md border border-[var(--border)] px-2 py-1 text-[9px] font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-muted)]"
                    >
                      {expandedRunId === run.runId ? "收起详情" : "详情"}
                    </button>
                  </div>
                )}
                {expandedRunId === run.runId ? (
                  <RunDetailBlock
                    detail={detailCache[run.runId]}
                    loading={detailLoadingId === run.runId}
                    error={detailError}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
        {visibleRuns.length === 0 ? <p className="mt-2 px-1 text-[10px] text-[var(--muted)]">没有符合条件的运行记录</p> : null}
        </>
      ) : null}
    </section>
  );
}

function RunDetailBlock({
  detail,
  loading,
  error,
}: {
  detail?: AgentRunDetail;
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return (
      <div className="mt-2 flex items-center gap-1.5 rounded-md bg-[var(--surface-muted)]/60 px-2 py-2 text-[10px] text-[var(--muted)]">
        <Loader2 className="size-3 animate-spin" />
        加载运行详情
      </div>
    );
  }
  if (error) {
    return (
      <p className="mt-2 rounded-md bg-red-500/10 px-2 py-2 text-[10px] text-red-600 dark:text-red-300">
        {error}
      </p>
    );
  }
  if (!detail) return null;
  const visibleEvents = detail.events.slice(-10);
  const startedAt = detail.run.startedAt ?? visibleEvents.find((event) => event.at)?.at;
  return (
    <div className="mt-2 rounded-md border border-[var(--border)]/70 bg-[var(--surface)]/70 p-2">
      {detail.jobs.length > 0 ? (
        <div className="mb-2 space-y-1">
          {detail.jobs.slice(0, 3).map((job, index) => (
            <div
              key={job.id ?? `job-${index}`}
              className="rounded bg-[var(--surface-muted)]/55 px-2 py-1.5"
            >
              <div className="flex items-center justify-between gap-2 text-[9px]">
                <span className="truncate font-medium text-[var(--foreground)]">
                  {job.type ?? "job"}
                </span>
                <span className="shrink-0 text-[var(--muted)]">
                  {job.status ?? "unknown"}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[9px] text-[var(--muted)]">
                {job.total
                  ? `${job.completed ?? 0}/${job.total} done`
                  : job.message ?? job.stage ?? job.error ?? "No detail"}
              </p>
            </div>
          ))}
        </div>
      ) : null}
      {visibleEvents.length > 0 ? (
        <ol className="space-y-1">
          {visibleEvents.map((event, index) => (
            <li key={`${event.seq ?? index}:${event.type}`} className="flex gap-2 text-[9px] leading-relaxed">
              <span className="mt-1 size-1.5 shrink-0 rounded-full bg-[var(--border)]" />
              <span className="min-w-0">
                <span className="font-medium text-[var(--foreground)]">
                  {event.type}
                </span>
                {event.type.startsWith("tool.") && event.riskLevel ? (
                  <span className={`ml-1 rounded px-1 py-0.5 ${toolRiskClass(event.riskLevel)}`}>
                    {event.requiresConfirmation ? "需确认" : event.riskLevel}
                  </span>
                ) : null}
                {event.at && startedAt ? (
                  <span className="text-[var(--muted)]">
                    {" "}
                    +{formatElapsed(event.at - startedAt)}
                  </span>
                ) : null}
                {event.message ? (
                  <span className="text-[var(--muted)]">：{event.message}</span>
                ) : null}
                {event.error ? (
                  <span className="text-red-600 dark:text-red-400">：{event.error}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[10px] text-[var(--muted)]">
          没有持久化事件。该运行可能发生在事件日志启用之前。
          </p>
      )}
    </div>
  );
}

function toolRiskClass(risk: "safe" | "moderate" | "destructive" | "external"): string {
  if (risk === "destructive") return "bg-red-500/10 text-red-600 dark:text-red-300";
  if (risk === "moderate") return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (risk === "external") return "bg-purple-500/10 text-purple-700 dark:text-purple-300";
  return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
}

function runStatusMeta(status: AgentRunSummary["status"]): {
  label: string;
  className: string;
  icon: ReactNode;
} {
  if (status === "running" || status === "accepted") {
    return {
      label: "运行中",
      className: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
      icon: <Loader2 className="size-3 animate-spin text-blue-600" />,
    };
  }
  if (status === "waiting_user") {
    return {
      label: "等待确认",
      className: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
      icon: <Clock3 className="size-3 text-amber-600" />,
    };
  }
  if (status === "cancelling") {
    return {
      label: "运行中",
      className: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
      icon: <Square className="size-2.5 fill-current text-amber-600" />,
    };
  }
  if (status === "completed") {
    return {
      label: "运行中",
      className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      icon: <Check className="size-3 text-emerald-600" />,
    };
  }
  if (status === "cancelled") {
    return {
      label: "运行中",
      className: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
      icon: <Square className="size-2.5 fill-current text-zinc-500" />,
    };
  }
  return {
    label: status === "interrupted" ? "已中断" : "失败",
    className: "bg-red-500/10 text-red-700 dark:text-red-300",
    icon: <XCircle className="size-3 text-red-600" />,
  };
}

function isCancellableRunStatus(status: AgentRunSummary["status"]): boolean {
  return (
    status === "accepted" ||
    status === "running" ||
    status === "waiting_user" ||
    status === "cancelling" ||
    status === "interrupted"
  );
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function formatClock(ms: number): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}


function buildContextChips({
  project,
  activePageName,
  selection,
}: {
  project: ProjectFile;
  activePageName?: string;
  selection: CanvasSelection | null;
}): { key: string; label: string; dismissible?: boolean }[] {
  const chips: { key: string; label: string; dismissible?: boolean }[] = [
    { key: "project", label: project.title },
  ];
  if (selection?.kind === "asset") {
    chips.push({
      key: "selection",
      label:
        selection.assetIds && selection.assetIds.length > 1
          ? `选中 ${selection.assetIds.length} 张`
          : `针对 · ${(selection.pageName || "素材").slice(0, 28)}`,
      dismissible: true,
    });
  } else if (selection?.kind === "page") {
    chips.push({
      key: "selection",
      label: selection.nodeLabel
        ? `${selection.pageName} / ${selection.nodeLabel}`
        : selection.pageName,
      dismissible: true,
    });
  } else if (activePageName) {
    chips.push({ key: "page", label: activePageName });
  }
  return chips;
}

function WelcomeMark() {
  return (
    <div className="vad-agent-empty__hero" aria-hidden>
      <svg
        className="vad-agent-empty__mark"
        viewBox="0 0 96 76"
        fill="none"
      >
        <rect
          x="14"
          y="10"
          width="50"
          height="38"
          rx="6"
          transform="rotate(-9 39 29)"
          className="vad-agent-empty__board vad-agent-empty__board--back"
        />
        <rect
          x="34"
          y="12"
          width="50"
          height="38"
          rx="6"
          transform="rotate(8 59 31)"
          className="vad-agent-empty__board vad-agent-empty__board--mid"
        />
        <rect
          x="22"
          y="20"
          width="52"
          height="40"
          rx="7"
          className="vad-agent-empty__board vad-agent-empty__board--front"
        />
        <rect
          x="28"
          y="26"
          width="40"
          height="22"
          rx="3"
          className="vad-agent-empty__pic"
        />
        <circle cx="70" cy="22" r="5.5" className="vad-agent-empty__spark" />
      </svg>
    </div>
  );
}

function EmptyAgentState({
  projectTitle,
  conversationTitle,
  setInput,
  onOpenImages,
}: {
  projectTitle: string;
  conversationTitle?: string;
  setInput: (v: string) => void;
  onOpenImages: () => void;
}) {
  const isFreshChat =
    !conversationTitle ||
    conversationTitle === "新对话" ||
    conversationTitle === "默认对话";
  const prompts = [
    { label: "生成 1 张高保真视觉素材", Icon: ImageIcon },
    { label: "换个配色方案重新出图", Icon: Palette },
    { label: "导出交付包", Icon: Package },
  ];

  return (
    <div className="vad-agent-empty">
      <WelcomeMark />
      <div className="vad-agent-empty__copy">
        <h2>{isFreshChat ? "有什么想生成的" : conversationTitle}</h2>
        <p>在 {projectTitle} 里描述画面，或选中画布素材继续改</p>
      </div>
      <div className="vad-agent-empty__prompts">
        {prompts.map(({ label, Icon }) => (
          <button
            key={label}
            type="button"
            onClick={() => setInput(label)}
            className="vad-agent-empty-prompt group"
          >
            <Icon className="vad-agent-empty-prompt__icon" />
            <span>{label}</span>
            <ChevronRight className="size-3.5 ml-auto shrink-0 opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover:translate-x-0.5 group-hover:opacity-70" />
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onOpenImages}
        className="vad-agent-empty__link"
      >
        打开素材面板
      </button>
    </div>
  );
}

export { toolDisplayLabel };
