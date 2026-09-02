"use client";

import {
  ArrowLeft,
  Check,
  FileJson,
  LayoutGrid,
  Loader2,
  Package,
  PanelLeft,
  RefreshCw,
  Square,
  X,
} from "lucide-react";
import Link from "next/link";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { VadMark } from "@/components/brand/vad-mark";
import { HandoffDialog } from "@/components/handoff-dialog";
import { SkillPicker } from "@/components/skills/skill-picker";
import { PreferenceControls } from "@/components/theme-toggle";
import type { ChatMessage, ToolCall } from "@/lib/agents/chat-schema";
import { buildTargetChangeMessage, DIRECTION_ADJUST_MESSAGE } from "@/lib/agents/discovery-gate";
import { liveViewForConversation } from "@/lib/chat/conversation-live-view";
import {
  countPendingPreviewTools,
  createDiffPreviewTurnState,
  type DiffDecision,
  type DiffPreviewTurnState,
  hasPreviewTools,
  recomputeAppliedProject,
  registerProjectPreview,
} from "@/lib/chat/diff-preview";
import { formatChatValue, shouldPersistChatText } from "@/lib/chat/format-chat-value";
import { resolveSendConversation } from "@/lib/chat/resolve-send-conversation";
import { useChatStream } from "@/lib/chat/use-chat-stream";
import { downloadHandoffZip } from "@/lib/handoff/client-download";
import {
  isCodingHandoffPack,
  listHandoffDestinations,
  resolveHandoffPackKind,
} from "@/lib/handoff/pack-kind";
import { resolveHandoffSelection } from "@/lib/handoff/select-assets";
import type { HandoffTarget } from "@/lib/handoff/types";
import { usePreferences } from "@/lib/preferences";
import type { ReferenceAsset } from "@/lib/project/assets-schema";
import { deriveDesignContext } from "@/lib/project/design-context";
import type { ProjectFile } from "@/lib/project/schema";
import { openSettings } from "@/lib/settings/events";
import { skillCardTitle } from "@/lib/skills/skill-preview";
import { useSkillCatalog } from "@/lib/skills/use-skill-catalog";
import { exportProjectJsonFile, saveTextFile } from "@/lib/studio/native-file";
import { rememberLastProject } from "@/lib/studio/startup";
import { briefDisplayFields, briefEmptyCopy } from "@/lib/targets/brief";
import { getTargetRecipe, HOME_TARGET_IDS } from "@/lib/targets/catalog";
import { resolveTargetId } from "@/lib/targets/resolve";
import { useProjectStoreHydrated } from "@/lib/use-hydrated";
import { loadChatFromVad } from "@/lib/vad/chat-sync";
import { useVadWatch } from "@/lib/vad/use-vad-watch";
import { useCanvasBoardStore } from "@/store/canvas-board-store";
import { useCanvasSelectionStore } from "@/store/canvas-selection-store";
import { useCanvasUiStore } from "@/store/canvas-ui-store";
import {
  makeAssistantTextMessage,
  makeThoughtMessage,
  makeToolMessage,
  makeUserMessage,
  useChatStore,
} from "@/store/chat-store";
import { planHomeJobOnCanvas, useHomeGenerateStore } from "@/store/home-generate-store";
import { useProjectStore } from "@/store/project-store";
import { useProviderStore } from "@/store/provider-store";
import { ArtifactTreePanel } from "./artifact-tree-panel";
import { CanvasPane } from "./canvas-pane";
import { ChatStreamView } from "./chat-stream-view";
import { ImagePane } from "./image-pane";
import { InspectorProjectSummary } from "./inspector-project-summary";
import { PipelineLogSidePanel } from "./pipeline-log-side-panel";

interface IdeShellProps {
  projectId: string;
}

type SidePanel = "layers" | "images" | "export" | "files" | "logs" | "tasks";

const EMPTY_CHAT_MESSAGES: ChatMessage[] = [];
const AGENT_PANEL_MIN = 280;
const AGENT_PANEL_MAX = 720;

function clampAgentPanelWidth(w: number) {
  if (typeof window === "undefined") {
    return Math.max(AGENT_PANEL_MIN, Math.min(AGENT_PANEL_MAX, w));
  }
  const maxByViewport = Math.floor(window.innerWidth * 0.55);
  return Math.max(
    AGENT_PANEL_MIN,
    Math.min(Math.min(AGENT_PANEL_MAX, maxByViewport), Math.round(w)),
  );
}

export function IdeShell({ projectId }: IdeShellProps) {
  const hydrated = useProjectStoreHydrated();
  const { t } = usePreferences();
  const project = useProjectStore((s) => s.projects[projectId] ?? null);
  useEffect(() => {
    if (project) rememberLastProject(project.id);
  }, [project?.id]);
  const upsert = useProjectStore((s) => s.upsert);
  const reloadFromDisk = useProjectStore((s) => s.reloadFromDisk);
  const providerConfig = useProviderStore((s) => s.config);
  const messages = useChatStore(
    (s) => s.getActiveConversation(projectId)?.messages ?? EMPTY_CHAT_MESSAGES,
  );
  const activeConversationId = useChatStore((s) => s.activeIdByProject?.[projectId] ?? "");
  const ensureConversation = useChatStore((s) => s.ensureConversation);
  const append = useChatStore((s) => s.append);
  const appendMany = useChatStore((s) => s.appendMany);
  const truncateFrom = useChatStore((s) => s.truncateFrom);
  const truncateAfter = useChatStore((s) => s.truncateAfter);
  const mergeChatFromVad = useChatStore((s) => s.mergeFromVad);
  const pendingQueueRef = useRef<Array<{ text: string; references?: ReferenceAsset[] }>>([]);
  const [queuedCount, setQueuedCount] = useState(0);
  const consumeHomeGenerateJob = useHomeGenerateStore((s) => s.consumeJob);
  const runConversationIdRef = useRef<string | null>(null);
  const [runConversationId, setRunConversationId] = useState<string | null>(null);

  const homeGenerateStartedRef = useRef(false);

  const [showHandoff, setShowHandoff] = useState(false);
  const [handoffPreferredTarget, setHandoffPreferredTarget] = useState<
    HandoffTarget["name"] | undefined
  >(undefined);
  const [input, setInput] = useState("");

  // 画布交付卡按钮 → 打开 Handoff 弹窗
  const handoffRequestToken = useCanvasUiStore((s) => s.handoffRequestToken);
  const showCanvasGrid = useCanvasUiStore((s) => s.showCanvasGrid);
  useEffect(() => {
    if (handoffRequestToken > 0) setShowHandoff(true);
  }, [handoffRequestToken]);
  const [sidePanel, setSidePanel] = useState<SidePanel>("images");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [agentPanelWidth, setAgentPanelWidth] = useState(() => {
    if (typeof window === "undefined") return 360;
    const raw = window.localStorage.getItem("vad-agent-panel-width");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? clampAgentPanelWidth(n) : 360;
  });
  const agentResizeRef = useRef<{ startX: number; startW: number } | null>(null);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const drag = agentResizeRef.current;
      if (!drag) return;
      const next = clampAgentPanelWidth(drag.startW + (drag.startX - e.clientX));
      setAgentPanelWidth(next);
    }
    function onUp() {
      if (!agentResizeRef.current) return;
      agentResizeRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setAgentPanelWidth((w) => {
        window.localStorage.setItem("vad-agent-panel-width", String(w));
        return w;
      });
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const [artifactRefreshKey, setArtifactRefreshKey] = useState(0);
  const [pipelineLogRefreshKey, setPipelineLogRefreshKey] = useState(0);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const canvasSelection = useCanvasSelectionStore((s) => s.selection);
  const scopedSelection = canvasSelection?.projectId === projectId ? canvasSelection : null;

  const turnBufRef = useRef<{
    pendingToolCalls: Map<string, ToolCall>;
    persistedMessages: ChatMessage[];
    thinkingText: string;
    assistantText: string;
    preview: DiffPreviewTurnState;
    streamFinalProject: ProjectFile | null;
  }>({
    pendingToolCalls: new Map(),
    persistedMessages: [],
    thinkingText: "",
    assistantText: "",
    preview: createDiffPreviewTurnState(null),
    streamFinalProject: null,
  });

  const [diffDecisions, setDiffDecisions] = useState<Map<string, DiffDecision>>(() => new Map());

  const applyPreviewToStore = useCallback(() => {
    const applied = recomputeAppliedProject(turnBufRef.current.preview);
    if (applied) upsert(applied);
  }, [upsert]);

  const syncDiffDecisions = useCallback(() => {
    setDiffDecisions(new Map(turnBufRef.current.preview.decisions));
  }, []);

  const handleAcceptDiff = useCallback(
    (toolCallId: string) => {
      if (!turnBufRef.current.preview.projectAfterTool.has(toolCallId)) return;
      turnBufRef.current.preview.decisions.set(toolCallId, "accepted");
      syncDiffDecisions();
      applyPreviewToStore();
    },
    [applyPreviewToStore, syncDiffDecisions],
  );

  const handleRejectDiff = useCallback(
    (toolCallId: string) => {
      turnBufRef.current.preview.decisions.set(toolCallId, "rejected");
      syncDiffDecisions();
      applyPreviewToStore();
    },
    [applyPreviewToStore, syncDiffDecisions],
  );

  const handleUndoAcceptDiff = useCallback(
    (toolCallId: string) => {
      turnBufRef.current.preview.decisions.set(toolCallId, "rejected");
      syncDiffDecisions();
      applyPreviewToStore();
    },
    [applyPreviewToStore, syncDiffDecisions],
  );

  const pendingHomeJob = useHomeGenerateStore((s) =>
    s.job?.projectId === projectId ? s.job : null,
  );

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    void loadChatFromVad(projectId).then((disk) => {
      if (cancelled) return;
      if (disk.conversations?.length || disk.legacyMessages?.length) {
        mergeChatFromVad(projectId, disk);
      }
      ensureConversation(projectId);
      if (!pendingHomeJob) {
        void reloadFromDisk(projectId);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [hydrated, projectId, ensureConversation, mergeChatFromVad, reloadFromDisk, pendingHomeJob]);

  useEffect(() => {
    if (!hydrated || !project || homeGenerateStartedRef.current) return;
    const job = consumeHomeGenerateJob(projectId);
    if (!job) return;
    homeGenerateStartedRef.current = true;
    const start = planHomeJobOnCanvas(job);
    setInput(start.composerValue);
    queueMicrotask(() => void handleSend(start.sendText));
  }, [hydrated, project, projectId, consumeHomeGenerateJob]);

  /*
    queueMicrotask(() => setHomeGenActive(true));
    homeGenActiveRef.current = true;

    void (async () => {
      const result = await runHomeGenerate(
        job!.idea,
        job!.providerConfig,
        projectId
      );
      if (result) {
        upsert(result);
        const summary =
          `已生成项目「${result.title}」。` +
          (result.pages.length ? ` 包含 ${result.pages.length} 个页面。` : "") +
          (result.brief?.positioning
            ? ` 定位：${result.brief.positioning}。`
            : "") +
          ` 你可以继续提要求让我评审、修复或重做某页。`;
        appendMany(projectId, [makeAssistantTextMessage(summary)]);
      }
      setHomeGenActive(false);
      homeGenActiveRef.current = false;
    })();
  }, [
    hydrated,
    project,
    projectId,
    consumeHomeGenerateJob,
    runHomeGenerate,
    upsert,
    appendMany,
  ]);

  */

  useVadWatch(hydrated ? projectId : null, {
    onProjectChange: () => {
      void reloadFromDisk(projectId);
    },
    onChatChange: () => {
      void loadChatFromVad(projectId).then((disk) => {
        mergeChatFromVad(projectId, disk);
      });
    },
    onArtifactChange: () => {
      setArtifactRefreshKey((k) => k + 1);
    },
  });

  const { status, liveEvents, send, approve, approveTool, cancel, error } = useChatStream({
    onEvent: (ev) => {
      if (ev.type === "thinking") {
        const t = String((ev.data as { text?: string })?.text ?? "");
        if (t) turnBufRef.current.thinkingText += t;
      } else if (ev.type === "project_preview") {
        const d = ev.data as { toolCallId?: string; project?: ProjectFile };
        if (d.toolCallId && d.project) {
          registerProjectPreview(turnBufRef.current.preview, d.toolCallId, d.project);
          syncDiffDecisions();
        }
      } else if (ev.type === "project.update") {
        const d = ev.data as { project?: ProjectFile };
        if (d.project?.id === projectId) {
          turnBufRef.current.streamFinalProject = d.project;
          upsert(d.project);
        }
      } else if (ev.type === "canvas.sync") {
        void reloadFromDisk(projectId);
      } else if (ev.type === "tool_call") {
        const d = ev.data as {
          id: string;
          name: ToolCall["name"];
          args?: Record<string, unknown>;
        };
        turnBufRef.current.pendingToolCalls.set(d.id, {
          id: d.id,
          name: d.name,
          args: d.args,
        });
      } else if (ev.type === "tool_result") {
        const d = ev.data as {
          id: string;
          ok: boolean;
          summary?: string;
          data?: unknown;
        };
        const call = turnBufRef.current.pendingToolCalls.get(d.id);
        if (call) {
          turnBufRef.current.persistedMessages.push(
            makeToolMessage(call, { ok: d.ok, summary: d.summary, data: d.data }),
          );
          turnBufRef.current.pendingToolCalls.delete(d.id);
        }
        const payload = d.data as
          | {
              openHandoffDialog?: boolean;
              target?: HandoffTarget["name"];
              autoDownload?: boolean;
            }
          | undefined;
        const shouldOpenHandoff =
          call?.name === "export_handoff" || payload?.openHandoffDialog === true;
        if (shouldOpenHandoff && d.ok !== false) {
          if (payload?.target) setHandoffPreferredTarget(payload.target);
          setShowHandoff(true);
        }
      } else if (ev.type === "handoff_download") {
        const d = ev.data as {
          target: HandoffTarget["name"];
          selectedAssetIds?: string[];
          selectedReferenceIds?: string[];
          openHandoffDialog?: boolean;
        };
        if (d.openHandoffDialog) {
          setHandoffPreferredTarget(d.target);
          setShowHandoff(true);
          return;
        }
        const latest = useProjectStore.getState().projects[projectId] ?? project;
        if (latest) {
          const selection = resolveHandoffSelection(latest, {
            assetIds: d.selectedAssetIds,
            referenceIds: d.selectedReferenceIds,
          });
          void downloadHandoffZip(latest, d.target, {
            selectedAssetIds: selection.assetIds,
            selectedReferenceIds: selection.referenceIds,
          }).catch((err) => {
            console.error("[handoff_download]", err);
          });
        }
      } else if (ev.type === "assistant_text") {
        const d = ev.data as { text?: string };
        if (d.text) turnBufRef.current.assistantText += d.text;
      } else if (ev.type === "pipeline_log") {
        setPipelineLogRefreshKey((k) => k + 1);
      }
    },
    clearLiveEventsOnDone: false,
    onFinalProject: (nextProject) => {
      turnBufRef.current.streamFinalProject = nextProject;
      const preview = turnBufRef.current.preview;
      const pending = countPendingPreviewTools(preview);
      if (!hasPreviewTools(preview)) {
        upsert(nextProject);
        return;
      }
      if (pending === 0) {
        const applied = recomputeAppliedProject(preview);
        upsert(applied ?? nextProject);
      } else {
        applyPreviewToStore();
      }
    },
    onDone: () => {
      const { persistedMessages, thinkingText, assistantText } = turnBufRef.current;
      const toSave: ChatMessage[] = [];
      if (shouldPersistChatText(thinkingText)) {
        toSave.push(makeThoughtMessage(thinkingText));
      }
      if (shouldPersistChatText(assistantText)) {
        toSave.push(makeAssistantTextMessage(assistantText));
      }
      toSave.push(...persistedMessages);
      const convId = runConversationIdRef.current ?? undefined;
      if (toSave.length > 0) appendMany(projectId, toSave, convId);
      turnBufRef.current.pendingToolCalls = new Map();
      turnBufRef.current.persistedMessages = [];
      turnBufRef.current.thinkingText = "";
      turnBufRef.current.assistantText = "";
      runConversationIdRef.current = null;
      setRunConversationId(null);
    },
  });

  useEffect(() => {
    useCanvasUiStore.getState().setAgentRunBusy(status === "streaming" || status === "cancelling");
  }, [status]);

  const effectiveActivePageId =
    scopedSelection?.pageId && project?.pages.some((page) => page.id === scopedSelection.pageId)
      ? scopedSelection.pageId
      : activePageId && project?.pages.some((page) => page.id === activePageId)
        ? activePageId
        : project?.pages[0]?.id;
  const activePage =
    project?.pages.find((page) => page.id === effectiveActivePageId) ?? project?.pages[0] ?? null;
  const showHomeGenTimeline = false;
  const liveView = liveViewForConversation({
    activeConversationId,
    runConversationId,
    liveEvents,
    status,
  });
  const chatViewMessages = messages;
  const chatViewLiveEvents = liveView.liveEvents;
  const chatViewStatus = liveView.status;
  const chatViewError = liveView.isRunOwner ? error : null;
  async function handleSend(
    submittedText?: string,
    options?: {
      skipQueue?: boolean;
      references?: ReferenceAsset[];
      /** 为 true 时跳过画布选中注入（chip 已手动关掉） */
      omitSelection?: boolean;
    },
  ) {
    const raw = submittedText ?? input;
    const trimmed = formatChatValue(raw).trim();
    if (!trimmed && !options?.references?.length) return;
    const text = trimmed || "请参考附图继续";

    // 流式中：排队下一条（Cursor 风），当前轮结束后自动发送
    if (!options?.skipQueue && (status === "streaming" || status === "cancelling")) {
      pendingQueueRef.current.push({
        text,
        references: options?.references,
      });
      setQueuedCount(pendingQueueRef.current.length);
      if (submittedText == null) setInput("");
      return;
    }

    if (status === "streaming" || status === "cancelling") return;

    let latest = useProjectStore.getState().projects[projectId] ?? project;
    const incomingRefs = options?.references ?? [];
    if (incomingRefs.length > 0 && latest) {
      const prev = latest.references ?? [];
      const mergedRefs = [...prev];
      for (const ref of incomingRefs) {
        if (mergedRefs.some((r) => r.id === ref.id || (ref.src && r.src === ref.src))) {
          continue;
        }
        mergedRefs.push(ref);
      }
      const merged = {
        ...latest,
        references: mergedRefs,
        updatedAt: new Date().toISOString(),
      };
      upsert(merged);
      latest = merged;
    }

    turnBufRef.current = {
      pendingToolCalls: new Map(),
      persistedMessages: [],
      thinkingText: "",
      assistantText: "",
      preview: createDiffPreviewTurnState(latest ?? null),
      streamFinalProject: null,
    };
    setDiffDecisions(new Map());
    const selectionPrefix = options?.omitSelection
      ? ""
      : scopedSelection?.kind === "asset" && scopedSelection.assetId
        ? `【引用素材: ${scopedSelection.pageName || "素材"}#${scopedSelection.assetId}】 `
        : scopedSelection?.nodeId
          ? `【引用元素: ${scopedSelection.pageName}#${scopedSelection.pageId}/${scopedSelection.nodeLabel ?? "元素"}#${scopedSelection.nodeId}】 `
          : scopedSelection
            ? `【引用页面: ${scopedSelection.pageName}#${scopedSelection.pageId}】 `
            : "";
    const attachPrefix = incomingRefs.map((ref) => `【参考图: ${ref.label}#${ref.id}】`).join(" ");
    const prefix = `${selectionPrefix}${attachPrefix}${attachPrefix ? " " : ""}`;
    const userMsg = makeUserMessage(`${prefix}${text}`);
    const conv = resolveSendConversation(
      useChatStore.getState().getActiveConversation(projectId),
      () => useChatStore.getState().ensureConversation(projectId),
    );
    const conversationId = conv.id;
    const threadId = conv.threadId;
    if (!threadId) {
      console.error("[chat] missing threadId, refuse to send");
      return;
    }
    runConversationIdRef.current = conversationId;
    setRunConversationId(conversationId);
    const prior = conv.messages;
    append(projectId, userMsg, conversationId);
    setInput("");
    await send({
      project: latest,
      messages: [...prior, userMsg],
      providerConfig,
      threadId,
    });
  }

  /** 重试：截断该用户消息之后的回复，原消息再跑一轮 */
  async function handleRetryUserMessage(messageId: string, content: string) {
    if (status === "streaming" || status === "cancelling") return;
    const conv = resolveSendConversation(
      useChatStore.getState().getActiveConversation(projectId),
      () => useChatStore.getState().ensureConversation(projectId),
    );
    truncateAfter(projectId, messageId, conv.id);
    const latest = useProjectStore.getState().projects[projectId] ?? project;
    turnBufRef.current = {
      pendingToolCalls: new Map(),
      persistedMessages: [],
      thinkingText: "",
      assistantText: "",
      preview: createDiffPreviewTurnState(latest ?? null),
      streamFinalProject: null,
    };
    setDiffDecisions(new Map());
    const threadId = conv.threadId;
    if (!threadId) return;
    runConversationIdRef.current = conv.id;
    setRunConversationId(conv.id);
    const history = useChatStore.getState().get(projectId);
    await send({
      project: latest,
      messages: history,
      providerConfig,
      threadId,
    });
    void content;
  }

  /** 编辑：删掉该消息及之后，填回输入框 */
  function handleEditUserMessage(messageId: string, content: string) {
    if (status === "streaming" || status === "cancelling") return;
    truncateFrom(
      projectId,
      messageId,
      useChatStore.getState().getActiveConversation(projectId)?.id,
    );
    setInput(content);
  }

  function handleClearQueue() {
    pendingQueueRef.current = [];
    setQueuedCount(0);
  }

  // 当前轮结束后冲刷队列
  useEffect(() => {
    if (status === "streaming" || status === "cancelling" || status === "waiting_user") {
      return;
    }
    const next = pendingQueueRef.current.shift();
    setQueuedCount(pendingQueueRef.current.length);
    if (!next) return;
    void handleSend(next.text, {
      skipQueue: true,
      references: next.references,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在 status 终态时冲刷
  }, [status]);

  async function handleImageConfirm(prompt: string, count: number, prompts?: string[]) {
    if (status === "streaming" || status === "cancelling") return;
    const latest = useProjectStore.getState().projects[projectId] ?? project;
    turnBufRef.current = {
      pendingToolCalls: new Map(),
      persistedMessages: [],
      thinkingText: "",
      assistantText: "",
      preview: createDiffPreviewTurnState(latest ?? null),
      streamFinalProject: null,
    };
    setDiffDecisions(new Map());
    const list = (prompts ?? []).map((p) => p.trim()).filter(Boolean);
    const conv = resolveSendConversation(
      useChatStore.getState().getActiveConversation(projectId),
      () => useChatStore.getState().ensureConversation(projectId),
    );
    const threadId = conv.threadId;
    if (!threadId) return;
    runConversationIdRef.current = conv.id;
    setRunConversationId(conv.id);
    await approve({
      projectId,
      prompt: list[0] ?? prompt,
      count: list.length > 1 ? list.length : count,
      prompts: list.length > 0 ? list : undefined,
      providerConfig,
      threadId,
    });
  }

  function exportProjectJson() {
    if (!project) return;
    void exportProjectJsonFile(project);
  }

  function exportPageJson() {
    if (!project || !activePage) return;
    void saveTextFile({
      defaultPath: `${project.slug || project.id}-${activePage.id}.canvas.json`,
      data: JSON.stringify(activePage, null, 2),
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
  }

  if (!hydrated) {
    return (
      <div className="app-page grid h-screen place-items-center text-sm app-subtle">
        <div className="app-empty border-none bg-transparent shadow-none">
          <Loader2 className="mb-3 size-5 animate-spin text-[var(--primary)]" />
          {t("ide.loading")}
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="app-page grid h-screen place-items-center px-6 text-center">
        <div className="app-card max-w-md rounded-2xl p-10">
          <p className="text-base font-semibold">{t("ide.notFound")}</p>
          <p className="mt-2 text-sm app-subtle">
            {t("ide.notFoundDesc")}{" "}
            <code className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-xs">
              {projectId}
            </code>
          </p>
          <Link href="/" className="app-btn app-primary mt-6 inline-flex rounded-xl px-5">
            <ArrowLeft className="size-4" />
            {t("nav.backProjects")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--background)] text-[var(--foreground)] font-sans antialiased">
      <TopBar project={project} />

      <div
        className={
          "vad-ide-layout grid min-h-0 flex-1 border-t border-[var(--border)] bg-[var(--background)]" +
          (inspectorOpen ? " vad-ide-layout--inspector" : "")
        }
        style={
          {
            ["--vad-agent-w"]: `${agentPanelWidth}px`,
            gridTemplateColumns: inspectorOpen
              ? `300px minmax(0,1fr) var(--vad-agent-w)`
              : `minmax(0,1fr) var(--vad-agent-w)`,
          } as CSSProperties
        }
      >
        {inspectorOpen ? (
          <InspectorColumn
            panel={sidePanel}
            onPanelChange={setSidePanel}
            onClose={() => setInspectorOpen(false)}
            project={project}
            artifactRefreshKey={artifactRefreshKey}
            pipelineLogRefreshKey={pipelineLogRefreshKey}
            activePageId={activePage?.id}
            onPageSelect={(pageId) => {
              setSidePanel("layers");
              setActivePageId(pageId);
            }}
            onExportProject={exportProjectJson}
            onExportPage={exportPageJson}
            onHandoff={() => setShowHandoff(true)}
            onChangeVisualDirection={() => void handleSend(DIRECTION_ADJUST_MESSAGE)}
            onChangeTarget={(label) => void handleSend(buildTargetChangeMessage(label))}
          />
        ) : null}

        <main className="vad-ide-canvas relative min-w-0 overflow-hidden">
          {showCanvasGrid ? (
            <div className="vad-ide-canvas-grid pointer-events-none absolute inset-0" />
          ) : null}
          <CanvasTopChip
            inspectorOpen={inspectorOpen}
            onOpenInspector={() => {
              setSidePanel("images");
              setInspectorOpen(true);
            }}
            onResetLayout={() => useCanvasBoardStore.getState().requestResetLayout(project.id)}
          />
          <div
            id="vad-canvas-view-slot"
            className="pointer-events-none absolute right-6 top-4 z-10 flex flex-col items-end gap-2"
          />
          <div className="absolute inset-0">
            <CanvasPane
              project={project}
              activePageId={activePage?.id}
              onPrompt={setInput}
              onRunPrompt={(text) => void handleSend(text)}
              onExportPage={exportPageJson}
              onOpenHandoff={() => setShowHandoff(true)}
            />
          </div>
        </main>

        <div className="vad-agent-column relative min-h-0 min-w-0">
          <button
            type="button"
            aria-label="拖拽调整 Agent 面板宽度"
            title="拖拽调整宽度"
            className="vad-agent-resize-handle"
            onPointerDown={(e) => {
              e.preventDefault();
              agentResizeRef.current = {
                startX: e.clientX,
                startW: agentPanelWidth,
              };
              document.body.style.cursor = "col-resize";
              document.body.style.userSelect = "none";
              (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
            }}
          />
          <ChatStreamView
            key={activeConversationId || projectId}
            project={project}
            messages={chatViewMessages}
            liveEvents={chatViewLiveEvents}
            status={chatViewStatus}
            error={chatViewError}
            runningConversationId={runConversationId}
            input={input}
            setInput={setInput}
            send={handleSend}
            cancel={cancel}
            activePage={activePage}
            selection={scopedSelection}
            providerConfig={providerConfig}
            panelTitle={showHomeGenTimeline ? "生成流水线" : "Agent"}
            composerDisabled={showHomeGenTimeline}
            composerPlaceholder={
              showHomeGenTimeline ? "首页流水线生成中，完成后可在此继续对话…" : undefined
            }
            showEmptyHints={!showHomeGenTimeline}
            onOpenImages={() => {
              setSidePanel("images");
              setInspectorOpen(true);
            }}
            onOpenSettings={() => openSettings("models")}
            diffDecisions={showHomeGenTimeline ? undefined : diffDecisions}
            diffPreviewMode={!showHomeGenTimeline}
            onAcceptDiff={showHomeGenTimeline ? undefined : handleAcceptDiff}
            onRejectDiff={showHomeGenTimeline ? undefined : handleRejectDiff}
            onUndoAcceptDiff={showHomeGenTimeline ? undefined : handleUndoAcceptDiff}
            onDiscoverySubmit={showHomeGenTimeline ? undefined : (text) => void handleSend(text)}
            onCancelRun={cancel}
            onImageConfirm={handleImageConfirm}
            onToolConfirm={(runId, approvalId, args) => {
              const conv = resolveSendConversation(
                useChatStore.getState().getActiveConversation(projectId),
                () => useChatStore.getState().ensureConversation(projectId),
              );
              approveTool({
                projectId: project.id,
                runId,
                approvalId,
                providerConfig,
                toolArgs: args,
                threadId: conv.threadId,
              });
            }}
            onToolCancel={(runId, approvalId) => {
              const conv = resolveSendConversation(
                useChatStore.getState().getActiveConversation(projectId),
                () => useChatStore.getState().ensureConversation(projectId),
              );
              approveTool({
                projectId: project.id,
                runId,
                approvalId,
                providerConfig,
                action: "cancel",
                threadId: conv.threadId,
              });
            }}
            onRunPrompt={(text) => void handleSend(text)}
            queuedCount={queuedCount}
            onClearQueue={handleClearQueue}
            onRetryUserMessage={handleRetryUserMessage}
            onEditUserMessage={handleEditUserMessage}
          />
        </div>
      </div>

      {showHandoff && project ? (
        <HandoffDialog
          project={project}
          preferredTarget={handoffPreferredTarget}
          onProjectUpdate={upsert}
          onClose={() => {
            setShowHandoff(false);
            setHandoffPreferredTarget(undefined);
          }}
        />
      ) : null}
    </div>
  );
}

function TopBar({ project }: { project: ProjectFile }) {
  return (
    <header className="vad-ide-topbar sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Link
          href="/"
          className="app-logo grid size-7 shrink-0 place-items-center transition-opacity hover:opacity-85"
          title="返回首页"
        >
          <VadMark size={18} />
        </Link>
        <div className="hidden items-center gap-2 font-mono text-[10px] text-[var(--muted)] sm:flex">
          <span>项目</span>
          <span className="text-[var(--border)]">/</span>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-semibold tracking-[-0.02em] text-[var(--foreground)]">
            {project.title}
          </span>
          <span className="app-badge shrink-0">CANVAS</span>
        </div>
      </div>

      <div className="hidden shrink-0 items-center gap-2 text-[10px] text-[var(--muted)] xl:flex">
        <span className="vad-ide-status-pill">
          <span className="size-1.5 rounded-full bg-[var(--success)]" aria-hidden />
          已保存
        </span>
        <span className="vad-ide-status-pill font-mono">
          {(project.assets ?? []).filter((a) => a.status !== "discarded").length} 素材
        </span>
      </div>

      <nav className="app-header-actions" aria-label="全局操作">
        <PreferenceControls />
        <Link href="/skills" className="app-header-action">
          <span>Skills</span>
        </Link>
        <a
          href="https://github.com/Zullllkar/vibeboard"
          target="_blank"
          rel="noreferrer"
          className="app-header-action"
        >
          <span>GitHub</span>
        </a>
        <Link href="/" className="app-header-action app-header-action-primary">
          <span>Canvas</span>
        </Link>
      </nav>
    </header>
  );
}

const PRIMARY_INSPECTOR_TABS: Array<{ id: SidePanel; label: string }> = [
  { id: "images", label: "素材" },
  { id: "layers", label: "项目" },
  { id: "export", label: "导出" },
];

const MORE_INSPECTOR_TABS: Array<{ id: SidePanel; label: string }> = [
  { id: "tasks", label: "任务" },
  { id: "files", label: "文件" },
  { id: "logs", label: "日志" },
];

function InspectorColumn({
  panel,
  onPanelChange,
  onClose,
  project,
  artifactRefreshKey,
  pipelineLogRefreshKey,
  activePageId,
  onPageSelect,
  onExportProject,
  onExportPage,
  onHandoff,
  onChangeVisualDirection,
  onChangeTarget,
}: {
  panel: SidePanel;
  onPanelChange: (next: SidePanel) => void;
  onClose: () => void;
  project: ProjectFile;
  artifactRefreshKey: number;
  pipelineLogRefreshKey: number;
  activePageId?: string;
  onPageSelect: (pageId: string) => void;
  onExportProject: () => void;
  onExportPage: () => void;
  onHandoff: () => void;
  onChangeVisualDirection: () => void;
  onChangeTarget: (label: string) => void;
}) {
  const moreActive = MORE_INSPECTOR_TABS.some((tab) => tab.id === panel);
  return (
    <aside className="vad-inspector vad-ide-inspector">
      <div className="vad-inspector-head">
        <div className="vad-inspector-tabs" role="tablist">
          {PRIMARY_INSPECTOR_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              onClick={() => onPanelChange(tab.id)}
              aria-pressed={panel === tab.id}
              className="vad-inspector-tab"
            >
              {tab.label}
            </button>
          ))}
          <button
            type="button"
            role="tab"
            onClick={() => onPanelChange(moreActive ? panel : "tasks")}
            aria-pressed={moreActive}
            className="vad-inspector-tab"
          >
            更多
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="收起侧栏"
          className="vad-agent-icon-btn"
        >
          <X className="size-3.5" />
        </button>
      </div>
      {moreActive ? (
        <div className="vad-inspector-more">
          {MORE_INSPECTOR_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              data-active={panel === tab.id}
              onClick={() => onPanelChange(tab.id)}
              className="vad-inspector-more-btn"
            >
              {tab.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="vad-inspector-body">
        <SidePanelContent
          panel={panel}
          project={project}
          artifactRefreshKey={artifactRefreshKey}
          pipelineLogRefreshKey={pipelineLogRefreshKey}
          activePageId={activePageId}
          onPageSelect={onPageSelect}
          onExportProject={onExportProject}
          onExportPage={onExportPage}
          onHandoff={onHandoff}
          onChangeVisualDirection={onChangeVisualDirection}
          onChangeTarget={onChangeTarget}
        />
      </div>
    </aside>
  );
}

function SidePanelContent({
  panel,
  project,
  artifactRefreshKey,
  pipelineLogRefreshKey,
  activePageId,
  onPageSelect,
  onExportProject,
  onExportPage,
  onHandoff,
  onChangeVisualDirection,
  onChangeTarget,
}: {
  panel: SidePanel;
  project: ProjectFile;
  artifactRefreshKey: number;
  pipelineLogRefreshKey: number;
  activePageId?: string;
  onPageSelect: (pageId: string) => void;
  onExportProject: () => void;
  onExportPage: () => void;
  onHandoff: () => void;
  onChangeVisualDirection: () => void;
  onChangeTarget: (label: string) => void;
}) {
  if (panel === "images") {
    return (
      <div className="flex h-full min-w-0 flex-col overflow-hidden">
        <ImagePane project={project} variant="library" />
      </div>
    );
  }

  if (panel === "tasks") {
    return <TaskCenterPanel project={project} />;
  }

  if (panel === "export") {
    return (
      <ExportPanel
        project={project}
        onExportProject={onExportProject}
        onExportPage={onExportPage}
        onHandoff={onHandoff}
      />
    );
  }

  if (panel === "files") {
    return <ArtifactTreePanel projectId={project.id} refreshKey={artifactRefreshKey} />;
  }

  if (panel === "logs") {
    return <PipelineLogSidePanel projectId={project.id} refreshKey={pipelineLogRefreshKey} />;
  }

  return (
    <LayersPanel
      project={project}
      activePageId={activePageId}
      onPageSelect={onPageSelect}
      onChangeVisualDirection={onChangeVisualDirection}
      onChangeTarget={onChangeTarget}
    />
  );
}

type TaskCenterJob = {
  id: string;
  type: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress?: number;
  error?: string;
  toolCallId?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  progressDetail?: {
    stage?: string;
    completed?: number;
    failed?: number;
    cancelled?: number;
    total?: number;
    message?: string;
  };
};

function TaskCenterPanel({ project }: { project: ProjectFile }) {
  const upsert = useProjectStore((s) => s.upsert);
  const [jobs, setJobs] = useState<TaskCenterJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadJobsInFlight = useRef(false);

  const loadJobs = useCallback(async () => {
    if (loadJobsInFlight.current) return;
    loadJobsInFlight.current = true;
    try {
      const res = await fetch(`/api/jobs?projectId=${encodeURIComponent(project.id)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      const nextJobs = Array.isArray(data.jobs) ? (data.jobs as TaskCenterJob[]) : [];
      setJobs(nextJobs.sort((a, b) => b.createdAt - a.createdAt));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      loadJobsInFlight.current = false;
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    void loadJobs();
    const timer = window.setInterval(() => void loadJobs(), 3000);
    return () => window.clearInterval(timer);
  }, [loadJobs]);

  async function cancelJob(jobId: string) {
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}?projectId=${encodeURIComponent(project.id)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      await loadJobs();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function retryJob(jobId: string) {
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}?projectId=${encodeURIComponent(project.id)}`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      if (data.project?.id === project.id) upsert(data.project as ProjectFile);
      await loadJobs();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <div className="vad-inspector-toolbar">
        <span>{jobs.length} 个任务</span>
        <button
          type="button"
          onClick={() => void loadJobs()}
          className="vad-agent-icon-btn"
          aria-label="刷新任务"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
      <div className="vad-inspector-scroll">
        {error ? <div className="mb-3 text-[12px] text-[var(--danger)]">{error}</div> : null}
        {loading && jobs.length === 0 ? (
          <div className="grid h-28 place-items-center text-[var(--muted)]">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : jobs.length === 0 ? (
          <div className="vad-inspector-empty">
            <div>
              <p className="text-[13px] font-medium tracking-[-0.02em]">还没有后台任务</p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--muted)]">
                生图、变体和导出会出现在这里，可取消或重试。
              </p>
            </div>
          </div>
        ) : (
          jobs.map((job) => (
            <TaskCenterJobCard
              key={job.id}
              job={job}
              onCancel={() => void cancelJob(job.id)}
              onRetry={() => void retryJob(job.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TaskCenterJobCard({
  job,
  onCancel,
  onRetry,
}: {
  job: TaskCenterJob;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const active = job.status === "pending" || job.status === "running";
  const failed = job.status === "failed";
  const progress = Math.max(
    job.status === "completed" ? 100 : active ? 8 : 0,
    Math.min(100, job.progress ?? (job.status === "completed" ? 100 : 0)),
  );
  const detail = job.progressDetail;
  const total = detail?.total ?? 0;
  const completed = detail?.completed ?? 0;
  return (
    <div className="vad-inspector-job">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium tracking-[-0.02em]">
            {formatJobType(job.type)}
          </p>
          <p className="mt-1 truncate text-[12px] text-[var(--muted)]">
            {job.error ??
              detail?.message ??
              (total > 0 ? `${completed}/${total}` : formatJobStatus(job.status))}
          </p>
        </div>
        <span className="vad-ide-status-pill shrink-0">
          <span
            className={
              "size-1.5 rounded-full " +
              (failed
                ? "bg-[var(--danger)]"
                : active
                  ? "bg-[var(--primary)]"
                  : job.status === "cancelled"
                    ? "bg-[var(--muted)]"
                    : "bg-[var(--success)]")
            }
            aria-hidden
          />
          {formatJobStatus(job.status)}
        </span>
      </div>
      <div
        className="vad-inspector-job-bar"
        data-failed={failed ? "true" : undefined}
        data-cancelled={job.status === "cancelled" ? "true" : undefined}
      >
        <i style={{ width: `${progress}%` }} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[11px] tabular-nums text-[var(--muted)]">
          {formatJobTime(job.createdAt)}
        </span>
        {active || failed ? (
          <div className="flex gap-1.5">
            {active ? (
              <button type="button" onClick={onCancel} className="vad-inspector-quiet-btn">
                <Square className="size-3" />
                取消
              </button>
            ) : null}
            {failed ? (
              <button type="button" onClick={onRetry} className="vad-inspector-quiet-btn">
                <RefreshCw className="size-3" />
                重试
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function formatJobType(type: string): string {
  if (type === "materialize_slots") return "拆解素材";
  if (type === "direct_image_generation" || type === "image_generation") return "生成图片";
  if (type === "video_generation") return "生成视频";
  if (type === "export") return "导出";
  return type;
}

function formatJobStatus(status: TaskCenterJob["status"]): string {
  if (status === "pending") return "排队中";
  if (status === "running") return "进行中";
  if (status === "completed") return "已完成";
  if (status === "cancelled") return "已取消";
  return "失败";
}

function formatJobTime(value: number): string {
  try {
    return new Date(value).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function LayersPanel({
  project,
  onChangeVisualDirection,
  onChangeTarget,
}: {
  project: ProjectFile;
  activePageId?: string;
  onPageSelect?: (pageId: string) => void;
  onChangeVisualDirection?: () => void;
  onChangeTarget?: (label: string) => void;
}) {
  const upsert = useProjectStore((s) => s.upsert);
  const requestResetLayout = useCanvasBoardStore((s) => s.requestResetLayout);
  const legacyPageCount = project.pages?.length ?? 0;
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [pickingTarget, setPickingTarget] = useState(false);
  const currentTargetId = resolveTargetId(project);
  const currentTarget = getTargetRecipe(currentTargetId);
  const { skills, loading: skillsLoading } = useSkillCatalog();
  const activeSkill = skills.find((skill) => skill.name === project.skillId);

  function clearLegacyPages() {
    if (clearing || legacyPageCount === 0) return;
    setClearing(true);
    try {
      upsert({
        ...project,
        pages: [],
        prototype: project.prototype ? { ...project.prototype, pages: [], flows: [] } : undefined,
        critique: undefined,
        critiqueHistory: undefined,
        canvasSnapshot: undefined,
        updatedAt: new Date().toISOString(),
      });
      requestResetLayout(project.id);
      setCleared(true);
    } finally {
      setClearing(false);
    }
  }

  const assetCount = (project.assets ?? []).filter((asset) => asset.status !== "discarded").length;
  const ctx = deriveDesignContext(project);
  const moods = (
    ctx?.moodKeywords?.length ? ctx.moodKeywords : (project.designDirection?.moodKeywords ?? [])
  ).slice(0, 6);
  const colors = ctx?.colorTokens?.slice(0, 5) ?? [];
  const briefFields = project.brief ? briefDisplayFields(project.brief, currentTargetId) : [];
  const emptyBrief = briefEmptyCopy(currentTargetId);

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <div className="vad-inspector-toolbar">
        <span>项目说明</span>
        <span className="vad-ide-status-pill font-mono">{assetCount} 素材</span>
      </div>
      <div className="vad-inspector-scroll">
        <InspectorProjectSummary
          title={project.brief?.productName || project.title}
          description={project.rawIdea || "还没有原始想法，可在右侧对话里补上。"}
          targetLabel={project.brief ? currentTarget.label : "待补 Brief"}
          visualStyle={project.brief?.visualStyle}
        />

        <section className="vad-inspector-card">
          <div className="flex items-start justify-between gap-2">
            <p className="vad-inspector-section">项目 Skill</p>
            {activeSkill?.version ? (
              <span className="vad-inspector-version">v{activeSkill.version}</span>
            ) : null}
          </div>
          <SkillPicker
            inline
            skills={skills}
            value={project.skillId}
            targetId={currentTargetId}
            disabled={skillsLoading}
            onChange={(skill) => {
              if (skill?.name === project.skillId) return;
              const message = skill
                ? `切换为「${skillCardTitle(skill)}」？只影响后续生成，已有素材不会改变。`
                : "不再使用项目 Skill？只影响后续生成，已有素材不会改变。";
              if (!window.confirm(message)) return;
              upsert({
                ...project,
                skillId: skill?.name,
                skillVersion: skill?.version,
                designSystemId: skill?.recommendedDesignSystem ?? project.designSystemId,
                updatedAt: new Date().toISOString(),
              });
            }}
          />
          {project.skillId && !skillsLoading && !activeSkill ? (
            <p className="vad-inspector-skill-error">
              已绑定的 Skill「{project.skillId}」当前不可用，后续运行不会注入它。
            </p>
          ) : (
            <p className="vad-inspector-copy mt-2">
              Skill 约束 Agent 的任务流程；切换不会改动已有素材。
            </p>
          )}
        </section>

        {legacyPageCount > 0 ? (
          <section className="vad-inspector-card">
            <p className="vad-inspector-section">旧数据</p>
            <p className="text-[13px] font-medium">还有 {legacyPageCount} 个旧页面结构</p>
            <p className="vad-inspector-copy mt-1.5">可以清掉，已生成的图片素材会留下。</p>
            <button
              type="button"
              disabled={clearing}
              onClick={clearLegacyPages}
              className="vad-inspector-quiet-btn mt-3 disabled:opacity-50"
            >
              {clearing ? "清除中…" : cleared ? "已清除" : "清除旧结构"}
            </button>
          </section>
        ) : null}

        {project.brief ? (
          <section className="vad-inspector-card">
            <p className="vad-inspector-section">Brief</p>
            <dl>
              {briefFields.map((field) => (
                <div key={field.id} className="vad-inspector-field">
                  <dt>{field.label}</dt>
                  <dd>{field.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : (
          <section className="vad-inspector-card">
            <p className="vad-inspector-section">Brief</p>
            <p className="text-[13px] font-medium">{emptyBrief.title}</p>
            <p className="vad-inspector-copy mt-1.5">{emptyBrief.hint}</p>
          </section>
        )}

        <section className="vad-inspector-card">
          <div className="flex items-start justify-between gap-2">
            <p className="vad-inspector-section">视觉目标</p>
            <button
              type="button"
              onClick={() => setPickingTarget((open) => !open)}
              className="vad-inspector-quiet-btn shrink-0"
            >
              更换目标
            </button>
          </div>
          <p className="text-[13px] leading-relaxed">
            {currentTarget.label}
            {project.targetId ? "" : " · 未点选，已按界面处理"}
          </p>
          {pickingTarget ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {HOME_TARGET_IDS.map((id) => {
                const item = getTargetRecipe(id);
                const active = id === currentTargetId && Boolean(project.targetId);
                return (
                  <button
                    key={id}
                    type="button"
                    className={"vad-home-target" + (active ? " is-active" : "")}
                    onClick={() => {
                      if (id === project.targetId) {
                        setPickingTarget(false);
                        return;
                      }
                      if (
                        !window.confirm(
                          `换成「${item.label}」？已有图会保留，提问和生图宪法会按新目标走。`,
                        )
                      ) {
                        return;
                      }
                      upsert({
                        ...project,
                        targetId: id,
                        targetLocked: true,
                        updatedAt: new Date().toISOString(),
                      });
                      setPickingTarget(false);
                      onChangeTarget?.(item.label);
                    }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          ) : null}
        </section>

        <section className="vad-inspector-card">
          <div className="flex items-start justify-between gap-2">
            <p className="vad-inspector-section">视觉方向</p>
            {onChangeVisualDirection ? (
              <button
                type="button"
                onClick={onChangeVisualDirection}
                className="vad-inspector-quiet-btn shrink-0"
              >
                更换视觉方向
              </button>
            ) : null}
          </div>
          <p className="text-[13px] leading-relaxed">
            {project.designDirection?.summary || ctx?.imageStyle || "风格尚未写明"}
          </p>
          {moods.length > 0 ? (
            <div className="vad-inspector-moods mt-3">
              {moods.map((mood) => (
                <span key={mood} className="vad-inspector-mood">
                  {mood}
                </span>
              ))}
            </div>
          ) : null}
        </section>

        {colors.length > 0 || ctx?.typography ? (
          <section className="vad-inspector-card">
            <p className="vad-inspector-section">设计规范</p>
            {colors.length > 0 ? (
              <div className="vad-inspector-swatches">
                {colors.map((token) => (
                  <div key={token.name} className="vad-inspector-swatch">
                    <i style={{ background: token.value }} />
                    <b>{token.name}</b>
                    <span>{token.value}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {ctx?.typography ? (
              <dl className={colors.length > 0 ? "mt-3" : undefined}>
                <div className="vad-inspector-field">
                  <dt>字体</dt>
                  <dd>
                    {ctx.typography.heading}
                    {ctx.typography.body && ctx.typography.body !== ctx.typography.heading
                      ? ` / ${ctx.typography.body}`
                      : ""}
                  </dd>
                </div>
              </dl>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}

function ExportPanel({
  project,
  onExportProject,
  onExportPage,
  onHandoff,
}: {
  project: ProjectFile;
  onExportProject: () => void;
  onExportPage: () => void;
  onHandoff: () => void;
}) {
  void onExportPage;
  const assetCount = (project.assets ?? []).filter((asset) => asset.status !== "discarded").length;
  const starredCount = (project.assets ?? []).filter((asset) => asset.status === "starred").length;
  const hasBrief = Boolean(project.brief);
  const hasDirection = Boolean(project.designDirection || project.designContext);
  const packKind = resolveHandoffPackKind(project);
  const codingPack = isCodingHandoffPack(packKind);
  const packLabel = listHandoffDestinations(packKind)[0];

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <div className="vad-inspector-toolbar">
        <span>导出交付</span>
      </div>
      <div className="vad-inspector-scroll">
        <div className="vad-inspector-stats">
          <div className="vad-inspector-stat">
            <strong className="tabular-nums">{assetCount}</strong>
            <span>张素材</span>
          </div>
          <div className="vad-inspector-stat">
            <strong className="tabular-nums">{starredCount}</strong>
            <span>已收藏</span>
          </div>
        </div>

        <section className="vad-inspector-card mt-2">
          <p className="vad-inspector-section">交付包会带上</p>
          <ul className="vad-inspector-checks">
            <li>
              <i>
                <Check className="size-2.5" />
              </i>
              {assetCount} 张 PNG / 视觉素材
            </li>
            <li>
              <i>
                <Check className="size-2.5" />
              </i>
              {hasBrief ? "项目 Brief" : "Brief（生成后自动写入）"}
            </li>
            <li>
              <i>
                <Check className="size-2.5" />
              </i>
              {hasDirection ? "视觉方向、色板与字体" : "设计规范（有方向后写入）"}
            </li>
            <li>
              <i>
                <Check className="size-2.5" />
              </i>
              每张图对应的 prompt
            </li>
            <li>
              <i>
                <Check className="size-2.5" />
              </i>
              {codingPack
                ? "SPEC / kickoff，给 Cursor / Claude Code"
                : packKind === "art-bible"
                  ? "ART_BIBLE + 每张用途，不写 React kickoff"
                  : packKind === "media-pack"
                    ? "COPY 文案表，不导出给 coding agent"
                    : "STYLE_NOTES 草稿，不是施工包"}
            </li>
          </ul>
        </section>

        <button type="button" onClick={onHandoff} className="vad-inspector-export-primary mt-3">
          <Package className="size-4" />
          <span className="vad-inspector-export-copy">
            <strong>导出交付包</strong>
            <span>
              {codingPack
                ? "给 Cursor / Claude Code / Codex"
                : (packLabel?.desc ?? "按当前目标导出")}
            </span>
          </span>
        </button>
        <button type="button" onClick={onExportProject} className="vad-inspector-export-ghost">
          <FileJson className="size-4" />
          <span className="vad-inspector-export-copy">
            <strong>导出项目 JSON</strong>
            <span>完整本地工程备份</span>
          </span>
        </button>
      </div>
    </div>
  );
}

function CanvasTopChip({
  inspectorOpen,
  onOpenInspector,
  onResetLayout,
}: {
  inspectorOpen: boolean;
  onOpenInspector: () => void;
  onResetLayout: () => void;
}) {
  return (
    <div className="pointer-events-auto absolute left-6 top-4 z-10 flex items-center gap-2">
      {inspectorOpen ? null : (
        <button
          type="button"
          onClick={onOpenInspector}
          className="vad-canvas-chip flex h-9 items-center gap-1.5 rounded-xl px-3 text-[12px] font-medium"
        >
          <PanelLeft className="size-3.5 text-[var(--primary)]" />
          素材
        </button>
      )}
      <button
        type="button"
        onClick={onResetLayout}
        data-tip="按父子关系重新排列画布上的图"
        data-tip-bottom=""
        className="vad-canvas-chip-btn flex h-9 items-center gap-1.5 rounded-xl px-3 text-[12px] font-medium"
      >
        <LayoutGrid className="size-3.5" />
        整理
      </button>
    </div>
  );
}
