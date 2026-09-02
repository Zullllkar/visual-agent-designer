/**
 * 会话记忆管理
 * --------------------------------------------------------------
 * 基于 LangGraph checkpoint 的会话记忆，
 * 提供对话摘要、上下文压缩和历史恢复能力。
 */

import "server-only";

import type { BaseCheckpointSaver } from "@langchain/langgraph";
import type { RunnableConfig } from "@langchain/core/runnables";

export interface SessionMemorySummary {
  threadId: string;
  messageCount: number;
  lastActiveAt: number;
  summary?: string;
}

/**
 * 从 checkpoint 恢复会话状态。
 */
export async function restoreSession(
  checkpointer: BaseCheckpointSaver,
  threadId: string
): Promise<SessionMemorySummary | null> {
  const config: RunnableConfig = { configurable: { thread_id: threadId } };
  const tuple = await checkpointer.getTuple(config);
  if (!tuple) return null;

  const metadata = tuple.metadata as { messageCount?: number; summary?: string };
  return {
    threadId,
    messageCount: metadata?.messageCount ?? 0,
    lastActiveAt: tuple.checkpoint.ts
      ? Number(tuple.checkpoint.ts)
      : Date.now(),
    summary: metadata?.summary,
  };
}

/**
 * 列出某项目的所有会话记忆。
 */
export async function listSessions(
  checkpointer: BaseCheckpointSaver,
  threadIdPrefix: string
): Promise<SessionMemorySummary[]> {
  const config: RunnableConfig = { configurable: { thread_id: threadIdPrefix } };
  const sessions: SessionMemorySummary[] = [];

  for await (const tuple of checkpointer.list(config)) {
    const tid =
      (tuple.config.configurable?.thread_id as string | undefined) ?? "";
    sessions.push({
      threadId: tid,
      messageCount: 0,
      lastActiveAt: tuple.checkpoint.ts
        ? Number(tuple.checkpoint.ts)
        : Date.now(),
    });
  }

  return sessions;
}

/**
 * 清除项目的所有会话记忆。
 */
export async function clearSessions(
  checkpointer: BaseCheckpointSaver,
  threadId: string
): Promise<void> {
  // SqliteSaver 支持 deleteThread，其他 saver 可能不支持
  const saver = checkpointer as unknown as {
    deleteThread?: (tid: string) => void;
  };
  if (saver.deleteThread) {
    saver.deleteThread(threadId);
  }
}
