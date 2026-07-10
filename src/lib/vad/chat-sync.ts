/**
 * Chat 历史 .vad 双写（客户端防抖）
 * --------------------------------------------------------------
 * @author：wangjunhua
 */

import type { ChatMessage } from "@/lib/agents/chat-schema";

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleChatSyncToVad(
  projectId: string,
  messages: ChatMessage[],
  delayMs = 800
): void {
  if (typeof window === "undefined") return;

  const prev = timers.get(projectId);
  if (prev) clearTimeout(prev);

  timers.set(
    projectId,
    setTimeout(() => {
      timers.delete(projectId);
      fetch(`/api/projects/${projectId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages }),
      }).catch((err) => {
        console.warn("[chat-sync] failed:", err);
      });
    }, delayMs)
  );
}

export async function loadChatFromVad(
  projectId: string
): Promise<ChatMessage[]> {
  try {
    const res = await fetch(`/api/projects/${projectId}/chat`);
    if (!res.ok) return [];
    const data = (await res.json()) as { messages?: ChatMessage[] };
    return data.messages ?? [];
  } catch {
    return [];
  }
}
