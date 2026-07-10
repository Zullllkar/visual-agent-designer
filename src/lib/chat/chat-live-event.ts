/**
 * Chat SSE 实时事件类型（服务端/客户端共用）
 * @author：wangjunhua
 */

export interface ChatLiveEvent {
  type: string;
  data: unknown;
  at: number;
}
