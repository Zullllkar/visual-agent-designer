"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Code2,
  Download,
  FolderTree,
  Frame,
  ScrollText,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  Loader2,
  Share2,
} from "lucide-react";
import { ProviderSettingsDialog } from "@/components/provider-settings-dialog";
import { HandoffDialog } from "@/components/handoff-dialog";
import { PreferenceControls } from "@/components/theme-toggle";
import { useProjectStore } from "@/store/project-store";
import { useProviderStore } from "@/store/provider-store";
import {
  useCanvasSelectionStore,
} from "@/store/canvas-selection-store";
import { useCanvasBoardStore } from "@/store/canvas-board-store";
import { useCanvasUiStore } from "@/store/canvas-ui-store";
import { useProjectStoreHydrated } from "@/lib/use-hydrated";
import { usePreferences } from "@/lib/preferences";
import { useChatStream } from "@/lib/chat/use-chat-stream";
import { useGenerateStream } from "@/lib/chat/use-generate-stream";
import { useHomeGenerateStore } from "@/store/home-generate-store";
import {
  countPendingPreviewTools,
  createDiffPreviewTurnState,
  hasPreviewTools,
  registerProjectPreview,
  recomputeAppliedProject,
  type DiffDecision,
  type DiffPreviewTurnState,
} from "@/lib/chat/diff-preview";
import { downloadHandoffZip } from "@/lib/handoff/client-download";
import type { HandoffTarget } from "@/lib/handoff/types";
import {
  makeAssistantTextMessage,
  makeThoughtMessage,
  makeToolMessage,
  makeUserMessage,
  useChatStore,
} from "@/store/chat-store";
import { ChatStreamView } from "./chat-stream-view";
import type { ChatMessage, ToolCall } from "@/lib/agents/chat-schema";
import type { ProjectFile } from "@/lib/project/schema";
import { CanvasPane } from "./canvas-pane";
import { ImagePane } from "./image-pane";
import { ArtifactTreePanel } from "./artifact-tree-panel";
import { PipelineLogSidePanel } from "./pipeline-log-side-panel";
import { loadChatFromVad } from "@/lib/vad/chat-sync";
import { useVadWatch } from "@/lib/vad/use-vad-watch";

interface IdeShellProps {
  projectId: string;
}

type SidePanel = "layers" | "images" | "export" | "files" | "logs";

const EMPTY_CHAT_MESSAGES: ChatMessage[] = [];

export function IdeShell({ projectId }: IdeShellProps) {
  const hydrated = useProjectStoreHydrated();
  const { t } = usePreferences();
  const project = useProjectStore((s) => s.projects[projectId] ?? null);
  const upsert = useProjectStore((s) => s.upsert);
  const reloadFromDisk = useProjectStore((s) => s.reloadFromDisk);
  const providerConfig = useProviderStore((s) => s.config);
  const messages = useChatStore(
    (s) => s.sessions[projectId] ?? EMPTY_CHAT_MESSAGES
  );
  const append = useChatStore((s) => s.append);
  const appendMany = useChatStore((s) => s.appendMany);
  const mergeChatFromVad = useChatStore((s) => s.mergeFromVad);
  const consumeHomeGenerateJob = useHomeGenerateStore((s) => s.consumeJob);

  const homeGenerateStartedRef = useRef(false);
  const homeGenActiveRef = useRef(false);
  const [homeGenActive, setHomeGenActive] = useState(false);
  const {
    generate: runHomeGenerate,
    cancel: cancelHomeGenerate,
    isStreaming: isHomeGenerating,
    liveEvents: homeGenLiveEvents,
    messages: homeGenMessages,
    error: homeGenError,
    status: homeGenStatus,
  } = useGenerateStream({
    clearLiveEventsOnDone: false,
    onProjectSnapshot: (snap) => upsert(snap, { syncToDisk: false }),
  });

  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"providers" | "mcp">("providers");
  const [showHandoff, setShowHandoff] = useState(false);
  const [input, setInput] = useState("");

  // 画布交付卡按钮 → 打开 Handoff 弹窗
  const handoffRequestToken = useCanvasUiStore((s) => s.handoffRequestToken);
  useEffect(() => {
    if (handoffRequestToken > 0) setShowHandoff(true);
  }, [handoffRequestToken]);
  const [sidePanel, setSidePanel] = useState<SidePanel>("images");
  const [artifactRefreshKey, setArtifactRefreshKey] = useState(0);
  const [pipelineLogRefreshKey, setPipelineLogRefreshKey] = useState(0);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const canvasSelection = useCanvasSelectionStore((s) => s.selection);
  const scopedSelection =
    canvasSelection?.projectId === projectId ? canvasSelection : null;

  const turnBufRef = useRef<{
    pendingToolCalls: Map<string, ToolCall>;
    persistedMessages: ChatMessage[];
    thinkingText: string;
    preview: DiffPreviewTurnState;
    streamFinalProject: ProjectFile | null;
  }>({
    pendingToolCalls: new Map(),
    persistedMessages: [],
    thinkingText: "",
    preview: createDiffPreviewTurnState(null),
    streamFinalProject: null,
  });

  const [diffDecisions, setDiffDecisions] = useState<Map<string, DiffDecision>>(
    () => new Map()
  );

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
    [applyPreviewToStore, syncDiffDecisions]
  );

  const handleRejectDiff = useCallback(
    (toolCallId: string) => {
      turnBufRef.current.preview.decisions.set(toolCallId, "rejected");
      syncDiffDecisions();
      applyPreviewToStore();
    },
    [applyPreviewToStore, syncDiffDecisions]
  );

  const handleUndoAcceptDiff = useCallback(
    (toolCallId: string) => {
      turnBufRef.current.preview.decisions.set(toolCallId, "rejected");
      syncDiffDecisions();
      applyPreviewToStore();
    },
    [applyPreviewToStore, syncDiffDecisions]
  );

  const pendingHomeJob = useHomeGenerateStore((s) =>
    s.job?.projectId === projectId ? s.job : null
  );

  useEffect(() => {
    if (!hydrated) return;
    void loadChatFromVad(projectId).then((disk) => {
      if (disk.length > 0) mergeChatFromVad(projectId, disk);
    });
    if (!pendingHomeJob) {
      void reloadFromDisk(projectId);
    }
  }, [hydrated, projectId, mergeChatFromVad, reloadFromDisk, pendingHomeJob]);

  useEffect(() => {
    if (!hydrated || !project || homeGenerateStartedRef.current) return;
    const job = consumeHomeGenerateJob(projectId);
    if (!job) return;
    homeGenerateStartedRef.current = true;
    queueMicrotask(() => setHomeGenActive(true));
    homeGenActiveRef.current = true;

    void (async () => {
      const result = await runHomeGenerate(
        job.idea,
        job.providerConfig,
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

  useVadWatch(hydrated ? projectId : null, {
    onProjectChange: () => {
      if (homeGenActiveRef.current) return;
      void reloadFromDisk(projectId);
    },
    onChatChange: () => {
      void loadChatFromVad(projectId).then((disk) => {
        if (disk.length > 0) mergeChatFromVad(projectId, disk);
      });
    },
    onArtifactChange: () => {
      setArtifactRefreshKey((k) => k + 1);
    },
  });

  const { status, liveEvents, send, cancel, error } = useChatStream({
    onEvent: (ev) => {
      if (ev.type === "thinking") {
        const t = String((ev.data as { text?: string })?.text ?? "");
        if (t) turnBufRef.current.thinkingText += t;
      } else if (ev.type === "project_preview") {
        const d = ev.data as { toolCallId?: string; project?: ProjectFile };
        if (d.toolCallId && d.project) {
          registerProjectPreview(
            turnBufRef.current.preview,
            d.toolCallId,
            d.project
          );
          syncDiffDecisions();
        }
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
            makeToolMessage(call, { ok: d.ok, summary: d.summary, data: d.data })
          );
          turnBufRef.current.pendingToolCalls.delete(d.id);
        }
      } else if (ev.type === "handoff_download") {
        const d = ev.data as {
          target: HandoffTarget["name"];
        };
        const latest =
          useProjectStore.getState().projects[projectId] ?? project;
        if (latest) {
          void downloadHandoffZip(latest, d.target).catch((err) => {
            console.error("[handoff_download]", err);
          });
        }
      } else if (ev.type === "assistant_text") {
        const d = ev.data as { text: string };
        if (d.text) {
          turnBufRef.current.persistedMessages.push(
            makeAssistantTextMessage(d.text)
          );
        }
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
      const { persistedMessages, thinkingText } = turnBufRef.current;
      const toSave: ChatMessage[] = [];
      if (thinkingText.trim()) {
        toSave.push(makeThoughtMessage(thinkingText));
      }
      toSave.push(...persistedMessages);
      if (toSave.length > 0) appendMany(projectId, toSave);
      turnBufRef.current.pendingToolCalls = new Map();
      turnBufRef.current.persistedMessages = [];
      turnBufRef.current.thinkingText = "";
    },
  });

  const effectiveActivePageId =
    scopedSelection?.pageId && project?.pages.some((page) => page.id === scopedSelection.pageId)
      ? scopedSelection.pageId
      : activePageId && project?.pages.some((page) => page.id === activePageId)
        ? activePageId
        : project?.pages[0]?.id;
  const activePage =
    project?.pages.find((page) => page.id === effectiveActivePageId) ??
    project?.pages[0] ??
    null;
  const flowName =
    project?.prototype?.pages?.[0] ?? activePage?.name ?? "项目流程";

  const showHomeGenTimeline = homeGenActive;
  const chatViewMessages = showHomeGenTimeline ? homeGenMessages : messages;
  const chatViewLiveEvents = showHomeGenTimeline ? homeGenLiveEvents : liveEvents;
  const chatViewStatus = showHomeGenTimeline ? homeGenStatus : status;
  const chatViewError = showHomeGenTimeline ? homeGenError : error;
  const showCanvasGenerating =
    isHomeGenerating ||
    (homeGenActive &&
      (project?.pages.length ?? 0) === 0 &&
      !(project?.assets ?? []).some((a) => a.status === "generating"));

  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || status === "streaming") return;
    const latest =
      useProjectStore.getState().projects[projectId] ?? project;
    turnBufRef.current = {
      pendingToolCalls: new Map(),
      persistedMessages: [],
      thinkingText: "",
      preview: createDiffPreviewTurnState(latest ?? null),
      streamFinalProject: null,
    };
    setDiffDecisions(new Map());
    const referencePrefix =
      scopedSelection?.kind === "asset" && scopedSelection.assetId
        ? `【引用素材: ${scopedSelection.pageName || "素材"}#${scopedSelection.assetId}】 `
        : scopedSelection?.nodeId
          ? `【引用元素: ${scopedSelection.pageName}#${scopedSelection.pageId}/${scopedSelection.nodeLabel ?? "元素"}#${scopedSelection.nodeId}】 `
          : scopedSelection
            ? `【引用页面: ${scopedSelection.pageName}#${scopedSelection.pageId}】 `
            : "";
    const userMsg = makeUserMessage(`${referencePrefix}${trimmed}`);
    append(projectId, userMsg);
    setInput("");
    await send({
      project,
      messages: [...messages, userMsg],
      providerConfig,
    });
  }

  function exportProjectJson() {
    if (!project) return;
    const blob = new Blob([JSON.stringify(project, null, 2)], {
      type: "application/json",
    });
    triggerDownload(blob, `${project.slug || project.id}.project.json`);
  }

  function exportPageJson() {
    if (!project || !activePage) return;
    const blob = new Blob([JSON.stringify(activePage, null, 2)], {
      type: "application/json",
    });
    triggerDownload(blob, `${project.slug || project.id}-${activePage.id}.canvas.json`);
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
          <Link
            href="/projects"
            className="app-btn app-primary mt-6 inline-flex rounded-xl px-5"
          >
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

      <div className="vad-ide-layout grid min-h-0 flex-1 grid-cols-[52px_250px_minmax(0,1fr)_minmax(300px,336px)] border-t border-[var(--border)] bg-[var(--background)]">
        <ToolRail activePanel={sidePanel} onPanelChange={setSidePanel} />
        <SidePanelContent
          panel={sidePanel}
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
        />

        <main className="vad-ide-canvas relative min-w-0 overflow-hidden">
          <div className="vad-ide-canvas-grid pointer-events-none absolute inset-0" />
          <CanvasTopChip
            label={flowName}
            onResetLayout={() =>
              useCanvasBoardStore.getState().requestResetLayout(project.id)
            }
          />
          <div className="absolute inset-0 pt-16">
            <CanvasPane
              project={project}
              activePageId={activePage?.id}
              onPrompt={setInput}
              onExportPage={exportPageJson}
            />
          </div>
          {showCanvasGenerating ? (
            <div className="vad-canvas-loading absolute inset-0 z-30 grid place-items-center px-6 pt-16">
              <div className="max-w-sm rounded-2xl border border-[color-mix(in_srgb,var(--primary)_12%,var(--border))] bg-[color-mix(in_srgb,var(--surface-elevated)_92%,transparent)] px-8 py-10 text-center shadow-[var(--shadow-elevated)] backdrop-blur-md">
                <Loader2 className="mx-auto size-8 animate-spin text-[var(--primary)]" />
                <p className="mt-4 text-sm font-semibold text-[var(--foreground)]">
                  正在生成视觉素材…
                </p>
                <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
                  右侧 Agent 展示 Brief → 视觉方向 → 生图流水线，首次约 3–15 分钟。
                </p>
              </div>
            </div>
          ) : null}
        </main>

        <ChatStreamView
          project={project}
          messages={chatViewMessages}
          liveEvents={chatViewLiveEvents}
          status={chatViewStatus}
          error={chatViewError}
          input={input}
          setInput={setInput}
          send={handleSend}
          cancel={showHomeGenTimeline ? cancelHomeGenerate : cancel}
          activePage={activePage}
          selection={scopedSelection}
          providerConfig={providerConfig}
          panelTitle={showHomeGenTimeline ? "生成流水线" : "Agent"}
          composerDisabled={showHomeGenTimeline}
          composerPlaceholder={
            showHomeGenTimeline
              ? "首页流水线生成中，完成后可在此继续对话…"
              : undefined
          }
          showEmptyHints={!showHomeGenTimeline}
          onOpenImages={() => setSidePanel("images")}
          onOpenSettings={() => {
            setSettingsTab("providers");
            setShowSettings(true);
          }}
          onOpenMcp={() => {
            setSettingsTab("mcp");
            setShowSettings(true);
          }}
          diffDecisions={showHomeGenTimeline ? undefined : diffDecisions}
          diffPreviewMode={!showHomeGenTimeline}
          onAcceptDiff={showHomeGenTimeline ? undefined : handleAcceptDiff}
          onRejectDiff={showHomeGenTimeline ? undefined : handleRejectDiff}
          onUndoAcceptDiff={
            showHomeGenTimeline ? undefined : handleUndoAcceptDiff
          }
        />
      </div>

      {showSettings ? (
        <ProviderSettingsDialog
          initialTab={settingsTab}
          onClose={() => setShowSettings(false)}
        />
      ) : null}
      {showHandoff && project ? (
        <HandoffDialog
          project={project}
          onClose={() => setShowHandoff(false)}
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
          <span className="font-serif text-[13px] italic leading-none">◇</span>
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
        <span className="hidden truncate text-[11px] text-[var(--muted)] lg:inline">
          {project.brief?.platform ?? "本地项目"}
          {project.brief?.visualStyle ? ` · ${project.brief.visualStyle}` : ""}
        </span>
        <span className="vad-ide-stage-pill hidden sm:inline-flex">
          <span aria-hidden />03 Direction
        </span>
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
        <a
          href="https://github.com/Zullllkar/visual-agent-designer"
          target="_blank"
          rel="noreferrer"
          className="app-header-action"
        >
          <span>GitHub</span>
        </a>
        <Link href="/projects" className="app-header-action app-header-action-primary">
          <span>Canvas</span>
        </Link>
      </nav>
    </header>
  );
}

function ToolRail({
  activePanel,
  onPanelChange,
}: {
  activePanel: SidePanel;
  onPanelChange: (panel: SidePanel) => void;
}) {
  const items = [
    { icon: <ImageIcon className="size-4" />, label: "素材", panel: "images" as const },
    { icon: <Layers className="size-4" />, label: "Brief", panel: "layers" as const },
    { icon: <FolderTree className="size-4" />, label: "文件", panel: "files" as const },
    { icon: <ScrollText className="size-4" />, label: "日志", panel: "logs" as const },
    { icon: <Code2 className="size-4" />, label: "交付", panel: "export" as const },
  ];

  return (
    <aside className="vad-tool-rail flex h-full w-[52px] shrink-0 flex-col items-center gap-1 border-r border-[var(--border)] bg-[var(--surface)] py-3">
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          onClick={() => onPanelChange(item.panel)}
          aria-pressed={activePanel === item.panel ? "true" : "false"}
          className={
            "flex w-9 flex-col items-center gap-1 rounded-[var(--radius-md)] py-2 text-[9px] font-medium transition-colors duration-150 " +
            (activePanel === item.panel
              ? "bg-[var(--primary-soft)] text-[var(--primary)]"
              : "text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]")
          }
          title={item.label}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
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
}) {
  if (panel === "images") {
    return (
      <aside className="min-w-0 h-full flex flex-col overflow-hidden border-r border-[var(--border)] bg-[var(--surface)]">
        <ImagePane project={project} />
      </aside>
    );
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
    return (
      <ArtifactTreePanel
        projectId={project.id}
        refreshKey={artifactRefreshKey}
      />
    );
  }

  if (panel === "logs") {
    return (
      <PipelineLogSidePanel
        projectId={project.id}
        refreshKey={pipelineLogRefreshKey}
      />
    );
  }

  return (
    <LayersPanel
      project={project}
      activePageId={activePageId}
      onPageSelect={onPageSelect}
    />
  );
}

function LayersPanel({
  project,
}: {
  project: ProjectFile;
  activePageId?: string;
  onPageSelect?: (pageId: string) => void;
}) {
  const upsert = useProjectStore((s) => s.upsert);
  const requestResetLayout = useCanvasBoardStore((s) => s.requestResetLayout);
  const legacyPageCount = project.pages?.length ?? 0;
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(false);

  function clearLegacyPages() {
    if (clearing || legacyPageCount === 0) return;
    setClearing(true);
    try {
      upsert({
        ...project,
        pages: [],
        prototype: project.prototype
          ? { ...project.prototype, pages: [], flows: [] }
          : undefined,
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

  return (
    <aside className="min-w-0 h-full flex flex-col overflow-hidden border-r border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]">
      <div className="shrink-0 border-b border-[var(--border)] p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold">项目 Brief</p>
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">
              产品定位与视觉方向；画布只展示可交付的图片素材。
            </p>
          </div>
          <span className="shrink-0 rounded border border-[var(--primary)]/35 bg-[var(--primary-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--primary)]">
            {(project.assets ?? []).filter((a) => a.status !== "discarded").length}
          </span>
        </div>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-5">
        {legacyPageCount > 0 ? (
          <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5">
            <p className="text-xs font-bold text-amber-800 dark:text-amber-200">
              检测到旧网页结构数据
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--muted)]">
              本项目仍存有 {legacyPageCount}{" "}
              个旧版页面结构（Canvas JSON）。产品已改为视觉素材交付，可安全清除；不会删除已生成的图片素材。
            </p>
            <button
              type="button"
              disabled={clearing}
              onClick={clearLegacyPages}
              className="mt-3 inline-flex h-8 items-center rounded-lg border border-amber-600/40 bg-[var(--surface)] px-3 text-[11px] font-semibold text-amber-800 transition hover:bg-amber-500/10 disabled:opacity-50 dark:text-amber-100"
            >
              {clearing ? "清除中…" : cleared ? "已清除" : "清除旧网页结构"}
            </button>
          </section>
        ) : null}

        <section>
          <PanelTitle title="原始想法" />
          <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">
            {project.rawIdea || "尚未填写"}
          </p>
        </section>

        {project.brief ? (
          <section>
            <PanelTitle title="Brief" />
            <div className="mt-3 space-y-2 text-xs leading-relaxed text-[var(--muted)]">
              <p>
                <span className="font-semibold text-[var(--foreground)]">产品：</span>
                {project.brief.productName}
              </p>
              <p>
                <span className="font-semibold text-[var(--foreground)]">定位：</span>
                {project.brief.positioning}
              </p>
              <p>
                <span className="font-semibold text-[var(--foreground)]">用户：</span>
                {project.brief.targetUser}
              </p>
              <p>
                <span className="font-semibold text-[var(--foreground)]">风格：</span>
                {project.brief.visualStyle}
              </p>
            </div>
          </section>
        ) : null}

        {project.designDirection ? (
          <section>
            <PanelTitle title="视觉方向" />
            <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">
              {project.designDirection.summary}
            </p>
            {project.designDirection.moodKeywords.length > 0 ? (
              <p className="mt-2 text-[11px] text-[var(--muted)]">
                {project.designDirection.moodKeywords.join(" · ")}
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
    </aside>
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
  const actions = [
    {
      label: "导出交付包",
      desc: "打包视觉素材、prompt 与设计上下文，交给 Cursor / Claude Code / Codex。",
      icon: Share2,
      onClick: onHandoff,
    },
    {
      label: "导出项目 JSON",
      desc: "下载完整 ProjectFile（含 brief、assets）。",
      icon: Download,
      onClick: onExportProject,
    },
  ];

  return (
    <aside className="min-w-0 h-full flex flex-col overflow-hidden border-r border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]">
      <div className="flex-1 overflow-y-auto p-5">
        <PanelTitle title="交付导出" />
        <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">
          {project.title} 的设计数据已经连接到导出流程，下载内容会使用当前本地项目数据。
        </p>
        <div className="mt-5 space-y-3">
          {actions.map(({ label, desc, icon: Icon, onClick }) => (
            <button
              key={label}
              type="button"
              onClick={onClick}
              className="group w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-left transition hover:border-[var(--primary)] hover:bg-[var(--surface)]"
            >
              <span className="flex items-center gap-2.5 text-sm font-bold text-[var(--foreground)] transition-colors group-hover:text-[var(--primary)]">
                <Icon className="size-4 text-[var(--primary)]" />
                {label}
              </span>
              <span className="mt-2 block pl-6 text-xs leading-relaxed text-[var(--muted)]">
                {desc}
              </span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

function PanelTitle({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-between text-xs font-bold text-[var(--muted)]">
      <span>{title}</span>
      <span className="text-[var(--border)]">⌃</span>
    </div>
  );
}

function CanvasTopChip({
  label,
  onResetLayout,
}: {
  label: string;
  onResetLayout: () => void;
}) {
  return (
    <div className="pointer-events-auto absolute left-6 top-4 z-10 flex items-center gap-2.5">
      <div className="vad-canvas-chip flex h-10 items-center gap-2 rounded-2xl px-4 text-xs font-semibold">
        <Frame className="size-3.5 text-[var(--primary)]" />
        <span className="font-bold tracking-tight">{label}</span>
      </div>
      <button
        type="button"
        onClick={onResetLayout}
        title="重置画布排版：按网格重新排列视觉素材与参考图"
        className="vad-canvas-chip-btn flex h-10 items-center gap-1.5 rounded-2xl px-3.5 text-[10px] font-semibold tracking-wide transition-colors"
      >
        <LayoutGrid className="size-3.5" />
        重置排版
      </button>
    </div>
  );
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
