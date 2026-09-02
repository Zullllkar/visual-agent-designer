/**
 * 发送前解析对话：首页进 IDE 可能早于 chat hydrate，不能因缺 threadId 拒发
 * @author：wangjunhua
 */

import type { Conversation } from "./conversation-model";

export function resolveSendConversation(
  existing: Conversation | null | undefined,
  ensure: () => Conversation
): Conversation {
  if (existing?.threadId) return existing;
  return ensure();
}
