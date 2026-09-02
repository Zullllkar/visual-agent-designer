/**
 * Chat SSE 实时事件类型（服务端/客户端共用）
 * @author：wangjunhua
 */

export interface ChatLiveEvent {
  /** Stable identity used to merge WebSocket replay and live events. */
  id?: string;
  /** Server sequence number, when the event came from the replay buffer. */
  seq?: number;
  type: string;
  data: unknown;
  at: number;
}
