"use client";

/**
 * IDE 智能助理侧栏 — Cursor Agent 质感
 * --------------------------------------------------------------
 * 毛玻璃顶栏 · 渐隐消息流 · 浮起 Composer · 克制空态
 * 配色沿用 Canvas Studio tokens。
 *
 * @author：wangjunhua
 */

import {
  ArrowUp,
  AtSign,
  ChevronDown,
  ChevronRight,
  Image as ImageIcon,
  Square,
  Sparkles,
  Settings,
} from "lucide-react";
import type { ChatMessage } from "@/lib/agents/chat-schema";
import type { ProjectFile } from "@/lib/project/schema";
import type { ProviderConfig } from "@/lib/providers/registry";
import type { CanvasSelection } from "@/store/canvas-selection-store";
import type { ChatLiveEvent } from "@/lib/chat/use-chat-stream";
import type { DiffDecision } from "@/lib/chat/diff-preview";
import { ChatTimelineBody } from "@/components/chat-timeline-body";
import { toolDisplayLabel } from "@/lib/chat/live-timeline";

function getLlmModelLabel(providerConfig: ProviderConfig): string {
  const llm = providerConfig.llm;
  if (!llm || llm.kind === "mock") return "模拟模型";
  const modelName =
    "model" in llm ? (llm as { model?: string }).model : undefined;
  if (modelName) return modelName;
  return llm.kind;
}

function getModelHint(providerConfig: ProviderConfig): string {
  const llm = providerConfig.llm;
  if (!llm || llm.kind === "mock") return "本地演示";
  if ("baseURL" in llm && (llm as { baseURL?: string }).baseURL) {
    return String((llm as { baseURL?: string }).baseURL);
  }
  return llm.kind;
}

export function ChatStreamView({
  project,
  messages,
  liveEvents,
  status,
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
  onOpenMcp,
  diffDecisions,
  diffPreviewMode,
  onAcceptDiff,
  onRejectDiff,
  onUndoAcceptDiff,
  showEmptyHints = true,
  panelTitle = "Agent",
  composerDisabled = false,
  composerPlaceholder,
}: {
  project: ProjectFile;
  messages: ChatMessage[];
  liveEvents: ChatLiveEvent[];
  status: string;
  error: string | null;
  input: string;
  setInput: (value: string) => void;
  send: () => void;
  cancel: () => void;
  activePage: ProjectFile["pages"][number] | null;
  selection: CanvasSelection | null;
  providerConfig: ProviderConfig;
  onOpenImages: () => void;
  onOpenSettings?: () => void;
  onOpenMcp?: () => void;
  diffDecisions?: Map<string, DiffDecision>;
  diffPreviewMode?: boolean;
  onAcceptDiff?: (toolCallId: string) => void;
  onRejectDiff?: (toolCallId: string) => void;
  onUndoAcceptDiff?: (toolCallId: string) => void;
  showEmptyHints?: boolean;
  panelTitle?: string;
  composerDisabled?: boolean;
  composerPlaceholder?: string;
}) {
  const isStreaming = status === "streaming";
  const modelLabel = getLlmModelLabel(providerConfig);
  const modelHint = getModelHint(providerConfig);
  const canSend = !composerDisabled && !isStreaming && Boolean(input.trim());
  const hasConversation =
    messages.length > 0 || liveEvents.length > 0 || isStreaming;

  const contextChips = buildContextChips({
    project,
    activePageName: activePage?.name,
    selection,
  });

  const suggestionChips =
    selection?.kind === "asset"
      ? ["为选中素材生成变体", "换个配色方案", "导出 Handoff 交付包"]
      : ["生成 4 张视觉素材", "生成深色版本", "补充一张视觉图", "导出交付包"];

  return (
    <aside className="vad-agent-panel flex h-full min-w-0 flex-col overflow-hidden border-l border-[var(--border)]">
      <header className="vad-agent-header">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-semibold tracking-[-0.02em] text-[var(--foreground)]">
            {panelTitle}
          </span>
          <span
            className={
              "size-1.5 shrink-0 rounded-full ring-2 ring-[var(--surface)] " +
              (isStreaming
                ? "bg-[var(--primary)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_18%,transparent)]"
                : "bg-[var(--success)]")
            }
            aria-hidden
          />
          <span className="truncate text-[11px] tracking-[-0.01em] text-[var(--muted)]">
            {isStreaming ? "生成中" : "就绪"}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {onOpenMcp ? (
            <button
              type="button"
              onClick={onOpenMcp}
              className="rounded-lg px-2 py-1 text-[11px] font-medium tracking-[-0.01em] text-[var(--muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
            >
              MCP
            </button>
          ) : null}
          <button
            type="button"
            data-tip="模型设置"
            data-tip-bottom=""
            aria-label="模型设置"
            onClick={onOpenSettings}
            className="vad-agent-icon-btn"
          >
            <Settings className="size-3.5" />
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
        {!hasConversation && showEmptyHints ? (
          <EmptyAgentState
            projectTitle={project.title}
            setInput={setInput}
            onOpenImages={onOpenImages}
          />
        ) : (
          <div className="vad-agent-scroll flex min-h-0 flex-1 flex-col">
            <ChatTimelineBody
              theme="ide"
              project={project}
              messages={messages}
              liveEvents={liveEvents}
              isStreaming={isStreaming}
              error={error}
              fillHeight
              diffDecisions={diffDecisions}
              diffPreviewMode={diffPreviewMode}
              onAcceptDiff={onAcceptDiff}
              onRejectDiff={onRejectDiff}
              onUndoAcceptDiff={onUndoAcceptDiff}
              className="flex min-h-0 flex-1 flex-col rounded-none border-0 bg-transparent"
            />
          </div>
        )}
      </div>

      <div className="vad-agent-composer-wrap shrink-0">
        {hasConversation && !isStreaming && !composerDisabled ? (
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            {suggestionChips.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => setInput(chip)}
                className="vad-agent-suggest max-w-full truncate"
              >
                {chip}
              </button>
            ))}
          </div>
        ) : null}

        <div className="vad-agent-composer">
          {contextChips.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
              {contextChips.map((chip) => (
                <span key={chip.key} className="vad-agent-context-chip">
                  <AtSign className="size-3 opacity-70" aria-hidden />
                  <span className="truncate">{chip.label}</span>
                </span>
              ))}
            </div>
          ) : null}

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                if (isStreaming) return;
                if (canSend) send();
              }
            }}
            placeholder={
              composerPlaceholder ?? "描述要生成或修改的视觉内容…"
            }
            rows={3}
            disabled={composerDisabled && !isStreaming}
            className="vad-agent-composer-input"
          />

          <div className="flex items-center justify-between gap-2 px-2.5 pb-2 pt-0.5">
            <button
              type="button"
              onClick={onOpenSettings}
              className="vad-agent-model-btn"
              title={modelHint}
            >
              <Sparkles className="size-3.5 text-[var(--primary)]" />
              <span className="max-w-[9rem] truncate">{modelLabel}</span>
              <ChevronDown className="size-3 opacity-45" />
            </button>

            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={onOpenImages}
                data-tip="素材面板"
                data-tip-bottom=""
                aria-label="打开素材面板"
                className="vad-agent-icon-btn"
              >
                <ImageIcon className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={isStreaming ? cancel : send}
                disabled={isStreaming ? false : !canSend}
                aria-label={isStreaming ? "停止生成" : "发送"}
                className={
                  "vad-agent-send " +
                  (isStreaming ? "vad-agent-send--stop" : "vad-agent-send--ready")
                }
              >
                {isStreaming ? (
                  <Square className="size-2.5 fill-current" />
                ) : (
                  <ArrowUp className="size-3.5" strokeWidth={2.5} />
                )}
              </button>
            </div>
          </div>
        </div>

        <p className="mt-2 px-1 text-center text-[10px] tracking-[-0.01em] text-[var(--muted)]/80">
          Enter 发送 · Shift+Enter 换行
        </p>
      </div>
    </aside>
  );
}

function buildContextChips({
  project,
  activePageName,
  selection,
}: {
  project: ProjectFile;
  activePageName?: string;
  selection: CanvasSelection | null;
}): { key: string; label: string }[] {
  const chips: { key: string; label: string }[] = [
    { key: "project", label: project.title },
  ];
  if (selection?.kind === "asset") {
    chips.push({
      key: "asset",
      label: `生图 · ${selection.pageName || "素材"}`,
    });
  } else if (selection?.kind === "page") {
    chips.push({
      key: "page",
      label: selection.nodeLabel
        ? `${selection.pageName} / ${selection.nodeLabel}`
        : selection.pageName,
    });
  } else if (activePageName) {
    chips.push({ key: "page", label: activePageName });
  }
  return chips;
}

function EmptyAgentState({
  projectTitle,
  setInput,
  onOpenImages,
}: {
  projectTitle: string;
  setInput: (v: string) => void;
  onOpenImages: () => void;
}) {
  const prompts = [
    { label: "生成 4 张高保真视觉素材", hint: "Brief → 方向 → 出图" },
    { label: "换个配色方案重新出图", hint: "保持产品定位" },
    { label: "导出 Cursor 交付包", hint: "素材 + prompt + 上下文" },
  ];

  return (
    <div className="flex flex-1 flex-col justify-center px-5 py-10">
      <div className="mb-7">
        <div className="mb-4 grid size-10 place-items-center rounded-2xl bg-[var(--primary-soft)] text-[var(--primary)] shadow-[0_1px_0_rgba(255,255,255,0.5)_inset,var(--shadow-soft)]">
          <Sparkles className="size-4" />
        </div>
        <h2 className="text-[17px] font-semibold tracking-[-0.03em] text-[var(--foreground)]">
          开始对话
        </h2>
        <p className="mt-2 max-w-[18rem] text-[12.5px] leading-relaxed tracking-[-0.01em] text-[var(--muted)]">
          已载入「{projectTitle}」。描述你想生成或修改的视觉内容。
        </p>
      </div>
      <div className="space-y-1">
        {prompts.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => setInput(item.label)}
            className="vad-agent-empty-prompt group"
          >
            <ChevronRight className="size-3.5 shrink-0 text-[var(--muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--primary)]" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{item.label}</span>
              <span className="mt-0.5 block text-[10.5px] text-[var(--muted)]">
                {item.hint}
              </span>
            </span>
          </button>
        ))}
        <button
          type="button"
          onClick={onOpenImages}
          className="vad-agent-empty-prompt"
        >
          <ImageIcon className="size-3.5 shrink-0 text-[var(--muted)]" />
          <span className="font-medium">打开素材生成面板</span>
        </button>
      </div>
    </div>
  );
}

export { toolDisplayLabel };
