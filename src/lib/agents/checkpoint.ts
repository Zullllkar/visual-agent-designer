/**
 * 会话记忆 — SqliteSaver 持久化
 * --------------------------------------------------------------
 * 使用 @langchain/langgraph-checkpoint-sqlite 的 SqliteSaver
 * 持久化 LangGraph Agent 的 checkpoint，实现会话记忆。
 *
 * 每个项目（threadId）的对话历史都会保存到本地 SQLite 文件，
 * Agent 重启后可以恢复上下文。
 */

import "server-only";

import path from "node:path";
import fs from "node:fs";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { checkpointDbPath, checkpointsDir } from "@/lib/vad/paths";

const DEFAULT_DB_PATH = checkpointDbPath();

let saverInstance: SqliteSaver | null = null;

/**
 * 获取全局 SqliteSaver 单例。
 * DB 文件路径可通过环境变量 VAD_CHECKPOINT_DB 覆盖。
 */
export function getCheckpointer(): BaseCheckpointSaver {
  if (saverInstance) return saverInstance;

  const dbPath = process.env.VAD_CHECKPOINT_DB ?? DEFAULT_DB_PATH;
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  saverInstance = SqliteSaver.fromConnString(dbPath);
  return saverInstance;
}

/**
 * 获取项目的 threadId（以 projectId 为基础生成稳定的 threadId）。
 */
export function threadIdForProject(projectId: string): string {
  return `vad-project-${projectId}`;
}

export function clearThreadMemory(threadId: string): void {
  if (!threadId.trim()) return;
  const saver = getCheckpointer() as SqliteSaver;
  try {
    saver.deleteThread(threadId);
  } catch (e) {
    console.warn(
      `[checkpoint] 清理 thread ${threadId} 失败:`,
      (e as Error).message
    );
  }
}

/**
 * 删除某个项目的所有 checkpoint（用于项目删除时清理）。
 */
export async function clearProjectMemory(projectId: string): Promise<void> {
  clearThreadMemory(threadIdForProject(projectId));
}
