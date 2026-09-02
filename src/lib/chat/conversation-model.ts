/**
 * 多会话迁移与工厂（纯函数，便于单测）
 * @author：wangjunhua
 */

import { nanoid } from "nanoid";
import type { ChatMessage } from "@/lib/agents/chat-schema";

export interface Conversation {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  threadId: string;
  messages: ChatMessage[];
  titleLocked?: boolean;
}

export interface ChatStorePersistV2 {
  conversationsByProject: Record<string, Conversation[]>;
  activeIdByProject: Record<string, string>;
}

export interface ChatStorePersistV1 {
  sessions?: Record<string, ChatMessage[]>;
  threadIds?: Record<string, string>;
}

export function newThreadId(): string {
  return `thread-${nanoid(12)}`;
}

export function newConversationId(): string {
  return `conv_${nanoid(10)}`;
}

export function createEmptyConversation(
  projectId: string,
  options?: { title?: string; titleLocked?: boolean; now?: string; threadId?: string }
): Conversation {
  const now = options?.now ?? new Date().toISOString();
  return {
    id: newConversationId(),
    projectId,
    title: options?.title ?? "新对话",
    createdAt: now,
    updatedAt: now,
    threadId: options?.threadId ?? newThreadId(),
    messages: [],
    titleLocked: options?.titleLocked,
  };
}

/** 将旧 sessions/threadIds 迁成多会话结构 */
export function migrateLegacyChatState(
  legacy: ChatStorePersistV1
): ChatStorePersistV2 {
  const sessions = legacy.sessions ?? {};
  const threadIds = legacy.threadIds ?? {};
  const projectIds = new Set([
    ...Object.keys(sessions),
    ...Object.keys(threadIds),
  ]);

  const conversationsByProject: Record<string, Conversation[]> = {};
  const activeIdByProject: Record<string, string> = {};
  const now = new Date().toISOString();

  for (const projectId of projectIds) {
    const messages = sessions[projectId] ?? [];
    const threadId = threadIds[projectId] ?? newThreadId();
    if (messages.length === 0 && !threadIds[projectId]) continue;

    const conv: Conversation = {
      id: newConversationId(),
      projectId,
      title: "默认对话",
      createdAt: messages[0]?.createdAt ?? now,
      updatedAt: messages[messages.length - 1]?.createdAt ?? now,
      threadId,
      messages,
      titleLocked: true,
    };
    conversationsByProject[projectId] = [conv];
    activeIdByProject[projectId] = conv.id;
  }

  return { conversationsByProject, activeIdByProject };
}

export function sortConversationsByUpdatedAt(
  list: Conversation[]
): Conversation[] {
  return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
