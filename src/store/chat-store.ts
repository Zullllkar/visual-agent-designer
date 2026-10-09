"use client";

/**
 * Chat Session Store — 项目多对话
 * --------------------------------------------------------------
 * project → conversations[] + activeId；每会话独立 threadId。
 * 兼容旧 vad.chat.v1 的 sessions/threadIds 迁移。
 *
 * @author：wangjunhua
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { nanoid } from "nanoid";
import { createBrowserJsonStorage } from "@/lib/storage/idb-storage";
import type { ChatMessage, ToolCall } from "@/lib/agents/chat-schema";
import {
  createEmptyConversation,
  migrateLegacyChatState,
  sortConversationsByUpdatedAt,
  type Conversation,
  type ChatStorePersistV1,
  type ChatStorePersistV2,
} from "@/lib/chat/conversation-model";
import { deriveConversationTitle } from "@/lib/chat/conversation-title";
import { formatChatValue } from "@/lib/chat/format-chat-value";
import { formatThoughtMessageContent } from "@/lib/chat/thought-message";
import {
  applyVadChatToState,
  resolveWriteConversationId,
  type VadChatPayload,
} from "@/lib/chat/conversation-persist";
import { scheduleChatSyncToVad } from "@/lib/vad/chat-sync";

export type { Conversation } from "@/lib/chat/conversation-model";

interface ChatStoreState extends ChatStorePersistV2 {
  /** @deprecated 仅迁移期可读；不再写入 */
  sessions?: Record<string, ChatMessage[]>;
  /** @deprecated 仅迁移期可读；不再写入 */
  threadIds?: Record<string, string>;

  listConversations: (projectId: string) => Conversation[];
  getActiveConversation: (projectId: string) => Conversation | null;
  ensureConversation: (projectId: string) => Conversation;
  createConversation: (projectId: string) => Conversation;
  switchConversation: (projectId: string, conversationId: string) => void;
  renameConversation: (
    projectId: string,
    conversationId: string,
    title: string
  ) => void;
  deleteConversation: (
    projectId: string,
    conversationId: string
  ) => { removedThreadId?: string };

  append: (
    projectId: string,
    message: ChatMessage,
    conversationId?: string
  ) => void;
  appendMany: (
    projectId: string,
    messages: ChatMessage[],
    conversationId?: string
  ) => void;
  get: (projectId: string) => ChatMessage[];
  getThreadId: (projectId: string) => string;
  setThreadId: (projectId: string, threadId: string) => void;
  clear: (projectId: string) => void;
  truncateFrom: (
    projectId: string,
    messageId: string,
    conversationId?: string
  ) => void;
  truncateAfter: (
    projectId: string,
    messageId: string,
    conversationId?: string
  ) => void;
  mergeFromVad: (projectId: string, payload: VadChatPayload) => void;
}

function projectConversations(
  state: Pick<ChatStorePersistV2, "conversationsByProject">,
  projectId: string
): Conversation[] {
  return state.conversationsByProject?.[projectId] ?? [];
}

function projectActiveId(
  state: Pick<ChatStorePersistV2, "activeIdByProject">,
  projectId: string
): string | undefined {
  return state.activeIdByProject?.[projectId];
}

function touchConversation(
  conv: Conversation,
  patch: Partial<Conversation>
): Conversation {
  return {
    ...conv,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
}

function replaceConversation(
  list: Conversation[],
  next: Conversation
): Conversation[] {
  return list.map((c) => (c.id === next.id ? next : c));
}

function pickConversation(
  list: Conversation[],
  activeId: string | undefined,
  conversationId?: string
): Conversation | null {
  const id = resolveWriteConversationId({
    boundId: conversationId,
    activeId,
    ids: list.map((c) => c.id),
  });
  return list.find((c) => c.id === id) ?? null;
}

function syncProjectChat(
  projectId: string,
  conversations: Conversation[],
  activeId?: string
) {
  scheduleChatSyncToVad(projectId, {
    conversations,
    activeId,
    messages:
      conversations.find((c) => c.id === activeId)?.messages ??
      conversations[0]?.messages ??
      [],
  });
}

export const useChatStore = create<ChatStoreState>()(
  persist(
    (set, getState) => ({
      conversationsByProject: {},
      activeIdByProject: {},

      listConversations: (projectId) =>
        sortConversationsByUpdatedAt(
          projectConversations(getState(), projectId)
        ),

      getActiveConversation: (projectId) => {
        const state = getState();
        const list = projectConversations(state, projectId);
        const activeId = projectActiveId(state, projectId);
        return list.find((c) => c.id === activeId) ?? list[0] ?? null;
      },

      ensureConversation: (projectId) => {
        const existing = getState().getActiveConversation(projectId);
        if (existing) return existing;
        return getState().createConversation(projectId);
      },

      createConversation: (projectId) => {
        const conv = createEmptyConversation(projectId);
        const nextList = [
          ...projectConversations(getState(), projectId),
          conv,
        ];
        set((s) => ({
          conversationsByProject: {
            ...(s.conversationsByProject ?? {}),
            [projectId]: nextList,
          },
          activeIdByProject: {
            ...(s.activeIdByProject ?? {}),
            [projectId]: conv.id,
          },
        }));
        syncProjectChat(projectId, nextList, conv.id);
        return conv;
      },

      switchConversation: (projectId, conversationId) => {
        const list = projectConversations(getState(), projectId);
        if (!list.some((c) => c.id === conversationId)) return;
        set((s) => ({
          activeIdByProject: {
            ...(s.activeIdByProject ?? {}),
            [projectId]: conversationId,
          },
        }));
        syncProjectChat(projectId, list, conversationId);
      },

      renameConversation: (projectId, conversationId, title) => {
        const trimmed = title.trim();
        if (!trimmed) return;
        set((s) => {
          const list = projectConversations(s, projectId);
          const current = list.find((c) => c.id === conversationId);
          if (!current) return s;
          const next = touchConversation(current, {
            title: trimmed,
            titleLocked: true,
          });
          const nextList = replaceConversation(list, next);
          syncProjectChat(projectId, nextList, projectActiveId(s, projectId));
          return {
            conversationsByProject: {
              ...(s.conversationsByProject ?? {}),
              [projectId]: nextList,
            },
          };
        });
      },

      deleteConversation: (projectId, conversationId) => {
        const state = getState();
        const list = projectConversations(state, projectId);
        const target = list.find((c) => c.id === conversationId);
        if (!target) return {};

        let nextList = list.filter((c) => c.id !== conversationId);
        let nextActive = projectActiveId(state, projectId);

        if (nextList.length === 0) {
          const created = createEmptyConversation(projectId);
          nextList = [created];
          nextActive = created.id;
        } else if (nextActive === conversationId) {
          nextActive = sortConversationsByUpdatedAt(nextList)[0]!.id;
        }

        set({
          conversationsByProject: {
            ...(state.conversationsByProject ?? {}),
            [projectId]: nextList,
          },
          activeIdByProject: {
            ...(state.activeIdByProject ?? {}),
            [projectId]: nextActive!,
          },
        });

        syncProjectChat(projectId, nextList, nextActive);
        return { removedThreadId: target.threadId };
      },

      append: (projectId, message, conversationId) => {
        if (!conversationId) getState().ensureConversation(projectId);
        set((s) => {
          const list = projectConversations(s, projectId);
          const activeId = projectActiveId(s, projectId);
          const current = pickConversation(list, activeId, conversationId);
          if (!current) return s;
          const messages = mergeUniqueMessages(current.messages, [message]);
          let next = touchConversation(current, { messages });
          if (
            !current.titleLocked &&
            message.role === "user" &&
            current.messages.filter((m) => m.role === "user").length === 0 &&
            (current.title === "新对话" || !current.title)
          ) {
            next = {
              ...next,
              title: deriveConversationTitle(message.content ?? ""),
            };
          }
          const nextList = replaceConversation(list, next);
          const nextActive =
            conversationId && conversationId !== activeId
              ? activeId
              : next.id;
          syncProjectChat(projectId, nextList, nextActive);
          return {
            conversationsByProject: {
              ...(s.conversationsByProject ?? {}),
              [projectId]: nextList,
            },
            activeIdByProject: {
              ...(s.activeIdByProject ?? {}),
              [projectId]: nextActive ?? next.id,
            },
          };
        });
      },

      appendMany: (projectId, messages, conversationId) => {
        if (!conversationId) getState().ensureConversation(projectId);
        set((s) => {
          const list = projectConversations(s, projectId);
          const activeId = projectActiveId(s, projectId);
          const current = pickConversation(list, activeId, conversationId);
          if (!current) return s;
          const merged = mergeUniqueMessages(current.messages, messages);
          const next = touchConversation(current, { messages: merged });
          const nextList = replaceConversation(list, next);
          syncProjectChat(projectId, nextList, activeId);
          return {
            conversationsByProject: {
              ...(s.conversationsByProject ?? {}),
              [projectId]: nextList,
            },
          };
        });
      },

      get: (projectId) =>
        getState().getActiveConversation(projectId)?.messages ?? [],

      getThreadId: (projectId) => {
        const active = getState().ensureConversation(projectId);
        return active.threadId;
      },

      setThreadId: (projectId, threadId) => {
        getState().ensureConversation(projectId);
        set((s) => {
          const list = projectConversations(s, projectId);
          const activeId = projectActiveId(s, projectId);
          const current = list.find((c) => c.id === activeId);
          if (!current) return s;
          const next = touchConversation(current, { threadId });
          return {
            conversationsByProject: {
              ...(s.conversationsByProject ?? {}),
              [projectId]: replaceConversation(list, next),
            },
          };
        });
      },

      clear: (projectId) =>
        set((s) => {
          const nextConvs = { ...(s.conversationsByProject ?? {}) };
          delete nextConvs[projectId];
          const nextActive = { ...(s.activeIdByProject ?? {}) };
          delete nextActive[projectId];
          return {
            conversationsByProject: nextConvs,
            activeIdByProject: nextActive,
          };
        }),

      truncateFrom: (projectId, messageId, conversationId) => {
        set((s) => {
          const list = projectConversations(s, projectId);
          const activeId = projectActiveId(s, projectId);
          const current = pickConversation(list, activeId, conversationId);
          if (!current) return s;
          const index = current.messages.findIndex((m) => m.id === messageId);
          if (index < 0) return s;
          const messages = current.messages.slice(0, index);
          const next = touchConversation(current, { messages });
          const nextList = replaceConversation(list, next);
          syncProjectChat(projectId, nextList, activeId);
          return {
            conversationsByProject: {
              ...(s.conversationsByProject ?? {}),
              [projectId]: nextList,
            },
          };
        });
      },

      truncateAfter: (projectId, messageId, conversationId) => {
        set((s) => {
          const list = projectConversations(s, projectId);
          const activeId = projectActiveId(s, projectId);
          const current = pickConversation(list, activeId, conversationId);
          if (!current) return s;
          const index = current.messages.findIndex((m) => m.id === messageId);
          if (index < 0) return s;
          const messages = current.messages.slice(0, index + 1);
          if (messages.length === current.messages.length) return s;
          const next = touchConversation(current, { messages });
          const nextList = replaceConversation(list, next);
          syncProjectChat(projectId, nextList, activeId);
          return {
            conversationsByProject: {
              ...(s.conversationsByProject ?? {}),
              [projectId]: nextList,
            },
          };
        });
      },

      mergeFromVad: (projectId, payload) => {
        set((s) => {
          const applied = applyVadChatToState(
            {
              conversations: projectConversations(s, projectId),
              activeId: projectActiveId(s, projectId),
            },
            payload,
            projectId
          );
          return {
            conversationsByProject: {
              ...(s.conversationsByProject ?? {}),
              [projectId]: applied.conversations,
            },
            activeIdByProject: {
              ...(s.activeIdByProject ?? {}),
              [projectId]: applied.activeId,
            },
          };
        });
      },
    }),
    {
      name: "vad.chat.v1",
      version: 2,
      skipHydration: true,
      storage: createJSONStorage(() => createBrowserJsonStorage()),
      partialize: (s) => ({
        conversationsByProject: s.conversationsByProject ?? {},
        activeIdByProject: s.activeIdByProject ?? {},
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ChatStorePersistV2> &
          ChatStorePersistV1;
        if (!p.conversationsByProject && (p.sessions || p.threadIds)) {
          const migrated = migrateLegacyChatState(p);
          return {
            ...current,
            ...migrated,
          };
        }
        return {
          ...current,
          conversationsByProject: p.conversationsByProject ?? {},
          activeIdByProject: p.activeIdByProject ?? {},
        };
      },
      migrate: (persisted, version) => {
        const raw = (persisted ?? {}) as ChatStorePersistV1 &
          Partial<ChatStorePersistV2>;
        if (
          version < 2 ||
          (!raw.conversationsByProject && (raw.sessions || raw.threadIds))
        ) {
          return migrateLegacyChatState(raw);
        }
        return {
          conversationsByProject: raw.conversationsByProject ?? {},
          activeIdByProject: raw.activeIdByProject ?? {},
        };
      },
    }
  )
);

function mergeUniqueMessages(
  existing: ChatMessage[],
  incoming: ChatMessage[]
): ChatMessage[] {
  const seen = new Set(existing.map((message) => message.id));
  const next = existing.map(normalizeChatMessage);
  for (const message of incoming) {
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    next.push(normalizeChatMessage(message));
  }
  return next.sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
  );
}

function normalizeChatMessage(message: ChatMessage): ChatMessage {
  const rawContent = (message as { content?: unknown }).content;
  if (rawContent == null) return message;
  const content = formatChatValue(rawContent);
  return { ...message, content };
}

export function makeUserMessage(content: unknown): ChatMessage {
  return {
    id: nanoid(8),
    role: "user",
    content: formatChatValue(content),
    createdAt: new Date().toISOString(),
  };
}

export function makeAssistantTextMessage(text: unknown): ChatMessage {
  return {
    id: nanoid(8),
    role: "assistant",
    content: formatChatValue(text),
    createdAt: new Date().toISOString(),
  };
}

export function makeThoughtMessage(thinking: string): ChatMessage {
  return {
    id: nanoid(8),
    role: "assistant",
    content: formatThoughtMessageContent(thinking),
    createdAt: new Date().toISOString(),
  };
}

export function makeToolMessage(
  call: ToolCall,
  result: { ok: boolean; summary?: string; data?: unknown }
): ChatMessage {
  return {
    id: nanoid(8),
    role: "tool",
    toolCall: call,
    toolResult: result,
    createdAt: new Date().toISOString(),
  };
}
