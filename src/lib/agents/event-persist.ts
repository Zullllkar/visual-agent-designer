/**
 * 事件持久化和回放
 * --------------------------------------------------------------
 * 将 WebSocket 事件写入 .vad/projects/<id>/event-log.jsonl
 * 支持从日志文件重放事件历史。
 */

import "server-only";

import { promises as fs } from "node:fs";
import { eventLogPath } from "@/lib/vad/paths";
import { ensureDir } from "@/lib/vad/persist";
import { dirname } from "node:path";
import type { WsEvent } from "@/lib/ws/types";

/** 追加一条事件到 JSONL 日志 */
export async function appendEvent(
  projectId: string,
  event: WsEvent
): Promise<void> {
  const path = eventLogPath(projectId);
  await ensureDir(dirname(path));
  const line = JSON.stringify(event) + "\n";
  await fs.appendFile(path, line, "utf8");
}

/** 从日志文件读取所有事件 */
export async function readEventLog(
  projectId: string
): Promise<WsEvent[]> {
  try {
    const raw = await fs.readFile(eventLogPath(projectId), "utf8");
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l) as WsEvent);
  } catch {
    return [];
  }
}

/** 从指定 seq 之后读取事件（用于断线重放） */
export async function readEventLogAfter(
  projectId: string,
  lastSeq: number
): Promise<WsEvent[]> {
  const events = await readEventLog(projectId);
  return events.filter((e) => {
    const seq = (e as WsEvent & { seq?: number }).seq;
    return seq === undefined || seq > lastSeq;
  });
}

/** 清空事件日志 */
export async function clearEventLog(projectId: string): Promise<void> {
  try {
    await fs.unlink(eventLogPath(projectId));
  } catch {
    // 文件不存在，忽略
  }
}
