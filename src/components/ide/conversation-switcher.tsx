"use client";

/**
 * 侧栏多会话切换：新建 / 搜索 / 列表 / 重命名 / 删除
 * @author：wangjunhua
 */

import { useEffect, useMemo, useRef, useState, Fragment } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  MessageSquare,
  MessageSquarePlus,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import {
  useChatStore,
  type Conversation,
} from "@/store/chat-store";
import { sortConversationsByUpdatedAt } from "@/lib/chat/conversation-model";

const EMPTY_CONVERSATIONS: Conversation[] = [];

function formatRelativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day} 天前`;
  return new Date(t).toLocaleDateString();
}

function conversationGroup(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "更早";
  const now = new Date();
  const startToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();
  if (t >= startToday) return "今天";
  if (t >= startToday - 86_400_000) return "昨天";
  if (t >= startToday - 7 * 86_400_000) return "近 7 天";
  return "更早";
}

function conversationMeta(
  conv: Conversation,
  running: boolean
): string {
  if (running) return "正在生成";
  if (!conv.messages.length) return "还没有消息";
  const time = formatRelativeTime(conv.updatedAt);
  const count = conv.messages.length;
  return time ? `${time} · ${count} 条` : `${count} 条`;
}

async function clearThreadCheckpoint(threadId: string) {
  try {
    await fetch("/api/agent/threads/clear", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId }),
    });
  } catch (err) {
    console.warn("[conversation] clear thread failed", err);
  }
}

export function ConversationSwitcher({
  projectId,
  runningConversationId,
}: {
  projectId: string;
  runningConversationId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [panelPos, setPanelPos] = useState({ top: 0, right: 0 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const highlightIdRef = useRef<string | null>(null);
  highlightIdRef.current = highlightId;

  const conversationsRaw = useChatStore(
    (s) => s.conversationsByProject?.[projectId] ?? EMPTY_CONVERSATIONS
  );
  const activeId = useChatStore((s) => s.activeIdByProject?.[projectId]);
  const createConversation = useChatStore((s) => s.createConversation);
  const switchConversation = useChatStore((s) => s.switchConversation);
  const renameConversation = useChatStore((s) => s.renameConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);

  const conversations = sortConversationsByUpdatedAt(conversationsRaw);
  const active =
    conversations.find((c) => c.id === activeId) ?? conversations[0] ?? null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, query]);
  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;

  useEffect(() => {
    if (!open) return;
    function place() {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPanelPos({
        top: r.bottom + 6,
        right: Math.max(8, window.innerWidth - r.right),
      });
    }
    place();
    setQuery("");
    setHighlightId(active?.id ?? null);
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 20);
    function onDoc(ev: MouseEvent) {
      const t = ev.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) {
        return;
      }
      closePanel();
    }
    window.addEventListener("resize", place);
    document.addEventListener("mousedown", onDoc);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("resize", place);
      document.removeEventListener("mousedown", onDoc);
    };
    // active?.id is snapshotted on open; don't re-run when switching inside panel
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !highlightId) return;
    const node = panelRef.current?.querySelector(
      `[data-conv-id="${highlightId}"]`
    );
    node?.scrollIntoView({ block: "nearest" });
  }, [highlightId, open]);

  function closePanel() {
    setOpen(false);
    setRenamingId(null);
    setPendingDeleteId(null);
    setQuery("");
  }

  function moveHighlight(dir: 1 | -1) {
    const list = filteredRef.current;
    if (list.length === 0) return;
    const idx = list.findIndex((c) => c.id === highlightIdRef.current);
    const next = idx < 0 ? 0 : (idx + dir + list.length) % list.length;
    setHighlightId(list[next].id);
  }

  function handleCreate() {
    createConversation(projectId);
    closePanel();
  }

  function handleSwitch(id: string) {
    if (pendingDeleteId) {
      setPendingDeleteId(null);
      return;
    }
    switchConversation(projectId, id);
    closePanel();
  }

  function startRename(conv: Conversation) {
    setPendingDeleteId(null);
    setRenamingId(conv.id);
    setDraftTitle(conv.title);
  }

  function commitRename(conversationId: string) {
    renameConversation(projectId, conversationId, draftTitle);
    setRenamingId(null);
  }

  function requestDelete(conv: Conversation) {
    if (runningConversationId === conv.id) return;
    setRenamingId(null);
    setPendingDeleteId(conv.id);
  }

  function confirmDelete(conv: Conversation) {
    if (runningConversationId === conv.id) return;
    const { removedThreadId } = deleteConversation(projectId, conv.id);
    if (removedThreadId) void clearThreadCheckpoint(removedThreadId);
    setPendingDeleteId(null);
  }

  const title = active?.title ?? "新对话";
  const isRunning = Boolean(
    runningConversationId && runningConversationId === active?.id
  );

  const panel =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={panelRef}
            className="vad-conv-panel"
            role="listbox"
            aria-label="对话列表"
            style={{ top: panelPos.top, right: panelPos.right }}
            onKeyDown={(ev) => {
              if (renamingId) {
                if (ev.key === "Escape") {
                  ev.stopPropagation();
                  setRenamingId(null);
                }
                return;
              }
              if (ev.key === "Escape") {
                ev.preventDefault();
                closePanel();
                triggerRef.current?.focus();
                return;
              }
              if (ev.key === "ArrowDown") {
                ev.preventDefault();
                moveHighlight(1);
                return;
              }
              if (ev.key === "ArrowUp") {
                ev.preventDefault();
                moveHighlight(-1);
                return;
              }
              if (ev.key === "Enter" && highlightId && !pendingDeleteId) {
                ev.preventDefault();
                handleSwitch(highlightId);
              }
            }}
          >
            <div className="vad-conv-toolbar">
              <label className="vad-conv-search">
                <Search className="vad-conv-search__icon" aria-hidden />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => {
                    const next = e.target.value;
                    setQuery(next);
                    const q = next.trim().toLowerCase();
                    const nextList = q
                      ? conversations.filter((c) =>
                          c.title.toLowerCase().includes(q)
                        )
                      : conversations;
                    setHighlightId(nextList[0]?.id ?? null);
                  }}
                  placeholder="搜索对话"
                  aria-label="搜索对话"
                />
              </label>
              <button
                type="button"
                onClick={handleCreate}
                className="vad-conv-new"
                aria-label="新建对话"
              >
                <Plus className="size-3" strokeWidth={2.25} />
              </button>
            </div>
            <ul className="vad-conv-panel__list">
              {filtered.length === 0 ? (
                <li className="vad-conv-empty">没有匹配的对话</li>
              ) : (
                filtered.map((conv, index) => {
                  const isActive = conv.id === active?.id;
                  const renaming = renamingId === conv.id;
                  const deleting = pendingDeleteId === conv.id;
                  const running = runningConversationId === conv.id;
                  const highlighted = conv.id === highlightId;
                  const group = conversationGroup(conv.updatedAt);
                  const prevGroup =
                    index > 0
                      ? conversationGroup(filtered[index - 1].updatedAt)
                      : null;
                  const showGroup = group !== prevGroup;
                  const meta = conversationMeta(conv, running);
                  return (
                    <Fragment key={conv.id}>
                      {showGroup ? (
                        <li className="vad-conv-group" aria-hidden>
                          {group}
                        </li>
                      ) : null}
                      <li>
                      {deleting ? (
                        <div className="vad-conv-delete">
                          <p className="vad-conv-delete__text">
                            删除「{conv.title}」？此操作不可撤销。
                          </p>
                          <div className="vad-conv-delete__actions">
                            <button
                              type="button"
                              className="vad-conv-delete__cancel"
                              onClick={() => setPendingDeleteId(null)}
                            >
                              取消
                            </button>
                            <button
                              type="button"
                              className="vad-conv-delete__confirm"
                              onClick={() => confirmDelete(conv)}
                            >
                              删除对话
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div
                          data-conv-id={conv.id}
                          className={
                            "vad-conv-row" +
                            (isActive ? " vad-conv-row--active" : "") +
                            (highlighted && !isActive
                              ? " vad-conv-row--kbd"
                              : "")
                          }
                        >
                          {renaming ? (
                            <form
                              className="vad-conv-row__main"
                              onSubmit={(e) => {
                                e.preventDefault();
                                commitRename(conv.id);
                              }}
                            >
                              <input
                                autoFocus
                                value={draftTitle}
                                onChange={(e) => setDraftTitle(e.target.value)}
                                onBlur={() => commitRename(conv.id)}
                                onKeyDown={(e) => {
                                  if (e.key === "Escape") {
                                    e.preventDefault();
                                    setRenamingId(null);
                                  }
                                }}
                                className="vad-conv-rename"
                                aria-label="重命名对话"
                              />
                            </form>
                          ) : (
                            <button
                              type="button"
                              role="option"
                              aria-selected={isActive}
                              className="vad-conv-row__main"
                              onMouseEnter={() => setHighlightId(conv.id)}
                              onClick={() => handleSwitch(conv.id)}
                            >
                              <span className="vad-conv-row__title">
                                {running ? (
                                  <span
                                    className="vad-conv-pulse"
                                    aria-hidden
                                  />
                                ) : null}
                                <span className="truncate">{conv.title}</span>
                              </span>
                              <span className="vad-conv-row__meta">{meta}</span>
                            </button>
                          )}
                          <div className="vad-conv-row__aside">
                            {isActive ? (
                              <Check
                                className="vad-conv-row__check"
                                aria-hidden
                              />
                            ) : null}
                            <div className="vad-conv-row__actions">
                              <button
                                type="button"
                                aria-label="重命名"
                                className="vad-conv-icon"
                                onClick={() => startRename(conv)}
                              >
                                <Pencil className="size-3" />
                              </button>
                              {running ? null : (
                                <button
                                  type="button"
                                  aria-label="删除"
                                  className="vad-conv-icon vad-conv-icon--danger"
                                  onClick={() => requestDelete(conv)}
                                >
                                  <Trash2 className="size-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                      </li>
                    </Fragment>
                  );
                })
              )}
            </ul>
          </div>,
          document.body
        )
      : null;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-0.5">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => {
          setOpen((v) => !v);
          setPendingDeleteId(null);
          setRenamingId(null);
        }}
        className={"vad-conv-trigger" + (open ? " vad-conv-trigger--open" : "")}
      >
        {isRunning ? (
          <span className="vad-conv-pulse" aria-hidden />
        ) : (
          <MessageSquare className="size-3.5 shrink-0 opacity-50" />
        )}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <ChevronDown className="vad-conv-trigger__chevron" />
      </button>
      <button
        type="button"
        data-tip="新建对话"
        data-tip-bottom=""
        aria-label="新建对话"
        onClick={handleCreate}
        className="vad-agent-icon-btn"
      >
        <MessageSquarePlus className="size-3.5" />
      </button>
      {panel}
    </div>
  );
}
