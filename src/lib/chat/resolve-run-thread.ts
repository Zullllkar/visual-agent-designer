/**
 * agent.run 必须带会话 threadId，禁止静默回落到项目级线程
 * @author：wangjunhua
 */

export type ResolveRunThreadResult =
  | { ok: true; threadId: string }
  | { ok: false; code: "THREAD_ID_REQUIRED"; message: string };

export function resolveAgentRunThreadId(input: {
  projectId: string;
  threadId?: string | null;
}): ResolveRunThreadResult {
  const threadId = input.threadId?.trim();
  if (!threadId) {
    return {
      ok: false,
      code: "THREAD_ID_REQUIRED",
      message: "缺少 threadId，拒绝回落到项目级线程以免串记忆",
    };
  }
  return { ok: true, threadId };
}
