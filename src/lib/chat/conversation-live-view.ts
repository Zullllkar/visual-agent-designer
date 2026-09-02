/**
 * 多会话下：仅把 live 时间线展示给发起该轮的会话
 * @author：wangjunhua
 */

export function liveViewForConversation<TEvent, TStatus extends string>({
  activeConversationId,
  runConversationId,
  liveEvents,
  status,
}: {
  activeConversationId: string;
  runConversationId: string | null;
  liveEvents: TEvent[];
  status: TStatus;
}): { liveEvents: TEvent[]; status: TStatus | "idle"; isRunOwner: boolean } {
  const isRunOwner =
    !runConversationId || runConversationId === activeConversationId;
  if (isRunOwner) {
    return { liveEvents, status, isRunOwner: true };
  }
  return { liveEvents: [], status: "idle", isRunOwner: false };
}
