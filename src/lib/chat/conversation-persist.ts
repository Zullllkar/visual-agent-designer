/**
 * .vad 多会话读写合并（纯函数）
 * @author：wangjunhua
 */

import type { ChatMessage } from "@/lib/agents/chat-schema";
import type { Conversation } from "./conversation-model";

export interface VadChatPayload {
  conversations?: Conversation[];
  activeId?: string;
  /** 旧 chat-history.jsonl / { messages } */
  legacyMessages?: ChatMessage[];
}

export interface ConversationStateSlice {
  conversations: Conversation[];
  activeId?: string;
}

function mergeUniqueMessages(
  existing: ChatMessage[],
  incoming: ChatMessage[]
): ChatMessage[] {
  const seen = new Set(existing.map((m) => m.id));
  const next = [...existing];
  for (const message of incoming) {
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    next.push(message);
  }
  return next.sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
  );
}

function isConversationLike(value: unknown): value is Conversation {
  if (!value || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.id === "string" &&
    typeof rec.projectId === "string" &&
    typeof rec.threadId === "string" &&
    Array.isArray(rec.messages)
  );
}

export function parseVadChatPayload(raw: unknown): VadChatPayload {
  if (!raw || typeof raw !== "object") return {};
  const rec = raw as Record<string, unknown>;
  const conversations = Array.isArray(rec.conversations)
    ? rec.conversations.filter(isConversationLike)
    : undefined;
  const activeId =
    typeof rec.activeId === "string" ? rec.activeId : undefined;
  const legacyMessages = Array.isArray(rec.messages)
    ? (rec.messages as ChatMessage[])
    : undefined;

  if (conversations && conversations.length > 0) {
    return { conversations, activeId };
  }
  if (legacyMessages && legacyMessages.length > 0) {
    return { legacyMessages };
  }
  return {};
}

function pickLegacyTarget(
  conversations: Conversation[]
): Conversation | undefined {
  const locked =
    conversations.find((c) => c.titleLocked || c.title === "默认对话") ??
    conversations.find((c) => c.messages.length > 0);
  if (locked) return locked;
  if (conversations.length === 1) return conversations[0];
  return undefined;
}

export function resolveWriteConversationId(input: {
  boundId?: string | null;
  activeId?: string;
  ids: string[];
}): string | undefined {
  if (input.boundId && input.ids.includes(input.boundId)) return input.boundId;
  if (input.activeId && input.ids.includes(input.activeId)) return input.activeId;
  return input.ids[0];
}

export function applyVadChatToState(
  current: ConversationStateSlice,
  payload: VadChatPayload,
  projectId: string
): { conversations: Conversation[]; activeId: string } {
  let conversations = [...current.conversations];
  const activeId = current.activeId ?? conversations[0]?.id ?? "";

  if (payload.conversations && payload.conversations.length > 0) {
    const byId = new Map(conversations.map((c) => [c.id, c]));
    for (const disk of payload.conversations) {
      if (disk.projectId !== projectId) continue;
      const local = byId.get(disk.id);
      if (!local) {
        byId.set(disk.id, disk);
        continue;
      }
      byId.set(disk.id, {
        ...disk,
        ...local,
        messages: mergeUniqueMessages(local.messages, disk.messages),
        title: local.titleLocked ? local.title : disk.title || local.title,
        titleLocked: local.titleLocked || disk.titleLocked,
        threadId: local.threadId || disk.threadId,
        updatedAt:
          local.updatedAt > disk.updatedAt ? local.updatedAt : disk.updatedAt,
      });
    }
    conversations = [...byId.values()];
    const nextActive =
      conversations.some((c) => c.id === activeId) ? activeId : payload.activeId;
    return {
      conversations,
      activeId:
        nextActive && conversations.some((c) => c.id === nextActive)
          ? nextActive
          : conversations[0]?.id ?? "",
    };
  }

  const incoming = payload.legacyMessages ?? [];
  if (incoming.length === 0) {
    return { conversations, activeId };
  }

  const target = pickLegacyTarget(conversations);
  if (!target) {
    return { conversations, activeId };
  }

  conversations = conversations.map((c) =>
    c.id === target.id
      ? { ...c, messages: mergeUniqueMessages(c.messages, incoming) }
      : c
  );
  return { conversations, activeId };
}
