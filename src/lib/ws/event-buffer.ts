/**
 * 事件缓存（断线重连）
 * --------------------------------------------------------------
 * 按 threadId 缓存最近的事件，支持序列号 (seq) 增量回放。
 */

import type { WsEvent } from "./types";

interface BufferedEntry {
  event: WsEvent;
  seq: number;
}

class EventBuffer {
  private buffers = new Map<string, BufferedEntry[]>();
  private seqCounters = new Map<string, number>();
  private maxBufferSize = 200;

  push(threadId: string, event: WsEvent): WsEvent {
    const seq = (this.seqCounters.get(threadId) ?? 0) + 1;
    this.seqCounters.set(threadId, seq);

    const sequencedEvent = { ...event, seq, at: event.at ?? Date.now() };
    const entry: BufferedEntry = { event: sequencedEvent, seq };
    const buf = this.buffers.get(threadId) ?? [];
    buf.push(entry);
    if (buf.length > this.maxBufferSize) buf.shift();
    this.buffers.set(threadId, buf);

    return sequencedEvent;
  }

  getRecent(threadId: string): WsEvent[] {
    return (this.buffers.get(threadId) ?? []).map((e) => e.event);
  }

  getAfter(threadId: string, lastSeq: number): WsEvent[] {
    const buf = this.buffers.get(threadId) ?? [];
    return buf.filter((e) => e.seq > lastSeq).map((e) => ({ ...e.event, seq: e.seq }));
  }

  getLatestSeq(threadId: string): number {
    return this.seqCounters.get(threadId) ?? 0;
  }

  clear(threadId: string): void {
    this.buffers.delete(threadId);
    this.seqCounters.delete(threadId);
  }
}

export const eventBuffer = new EventBuffer();
