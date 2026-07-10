"use client";

/**
 * Chat Session Store
 * --------------------------------------------------------------
 * 每个 project 一条对话历史；localStorage 持久化。
 *
 * 设计选择：
 *   - 我们存的是 ChatMessage[] (定义在 chat-schema.ts，UI/服务端共用)
 *   - file_write / thinking 这种"过程事件"不入 ChatMessage 持久层，
 *     仅在本轮 live 期间展示；轮次结束后只有
 *       user / assistant_text / tool_call+tool_result（合并为 tool 消息）
 *     被持久化
 *   - 这样回到项目时看到的对话是干净的，可读性强
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { nanoid } from "nanoid";
import type { ChatMessage, ToolCall } from "@/lib/agents/chat-schema";
import { scheduleChatSyncToVad } from "@/lib/vad/chat-sync";

interface ChatStoreState {
  /** projectId → 消息历史 */
  sessions: Record<string, ChatMessage[]>;
  /** 追加一条消息 */
  append: (projectId: string, message: ChatMessage) => void;
  /** 把多条一次性追加（少触发一次 setState） */
  appendMany: (projectId: string, messages: ChatMessage[]) => void;
  /** 读取（深拷贝防外部 mutate） */
  get: (projectId: string) => ChatMessage[];
  /** 清空（开发态用） */
  clear: (projectId: string) => void;
  /** 从 .vad 合并对话（仅当磁盘记录更长时覆盖） */
  mergeFromVad: (projectId: string, messages: ChatMessage[]) => void;
}

export const useChatStore = create<ChatStoreState>()(
  persist(
    (set, getState) => ({
      sessions: {},
      append: (projectId, message) =>
        set((s) => {
          const next = [...(s.sessions[projectId] ?? []), message];
          scheduleChatSyncToVad(projectId, next);
          return {
            sessions: { ...s.sessions, [projectId]: next },
          };
        }),
      appendMany: (projectId, messages) =>
        set((s) => {
          const next = [...(s.sessions[projectId] ?? []), ...messages];
          scheduleChatSyncToVad(projectId, next);
          return {
            sessions: { ...s.sessions, [projectId]: next },
          };
        }),
      get: (projectId) => getState().sessions[projectId] ?? [],
      clear: (projectId) =>
        set((s) => {
          const next = { ...s.sessions };
          delete next[projectId];
          return { sessions: next };
        }),
      mergeFromVad: (projectId, messages) =>
        set((s) => {
          const existing = s.sessions[projectId] ?? [];
          if (messages.length <= existing.length) return s;
          return {
            sessions: { ...s.sessions, [projectId]: messages },
          };
        }),
    }),
    {
      name: "vad.chat.v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ sessions: s.sessions }),
    }
  )
);

// ──────────────────────────────────────────────────────────────────
// ChatMessage 构造辅助
// ──────────────────────────────────────────────────────────────────

export function makeUserMessage(content: string): ChatMessage {
  return {
    id: nanoid(8),
    role: "user",
    content,
    createdAt: new Date().toISOString(),
  };
}

export function makeAssistantTextMessage(text: string): ChatMessage {
  return {
    id: nanoid(8),
    role: "assistant",
    content: text,
    createdAt: new Date().toISOString(),
  };
}

/** 持久化本轮思考摘要（前缀 💭 供时间线识别） */
export function makeThoughtMessage(thinking: string): ChatMessage {
  const trimmed = thinking.trim();
  return {
    id: nanoid(8),
    role: "assistant",
    content: trimmed ? `💭 ${trimmed}` : "",
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
