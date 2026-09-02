/**
 * Chat 历史 .vad 双写（客户端防抖）
 * --------------------------------------------------------------
 * 写入 conversations.json（全表）+ chat-history.jsonl（当前会话快照）。
 *
 * @author：wangjunhua
 */

import type { ChatMessage } from "@/lib/agents/chat-schema";
import type { Conversation } from "@/lib/chat/conversation-model";
import {
  parseVadChatPayload,
  type VadChatPayload,
} from "@/lib/chat/conversation-persist";

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export interface ChatSyncPayload {
  conversations?: Conversation[];
  activeId?: string;
  messages?: ChatMessage[];
}

export function scheduleChatSyncToVad(
  projectId: string,
  payload: ChatSyncPayload | ChatMessage[],
  delayMs = 800
): void {
  if (typeof window === "undefined") return;

  const body: ChatSyncPayload = Array.isArray(payload)
    ? { messages: payload }
    : payload;

  const prev = timers.get(projectId);
  if (prev) clearTimeout(prev);

  timers.set(
    projectId,
    setTimeout(() => {
      timers.delete(projectId);
      fetch(`/api/projects/${projectId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).catch((err) => {
        console.warn("[chat-sync] failed:", err);
      });
    }, delayMs)
  );
}

export async function loadChatFromVad(
  projectId: string
): Promise<VadChatPayload> {
  try {
    const res = await fetch(`/api/projects/${projectId}/chat`);
    if (!res.ok) return {};
    const data: unknown = await res.json();
    return parseVadChatPayload(data);
  } catch {
    return {};
  }
}
