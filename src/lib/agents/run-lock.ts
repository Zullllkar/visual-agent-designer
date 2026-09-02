/**
 * 判断进行中的 Agent run 是否应拦住新的 agent.run。
 *
 * discovery / direction 会把 run 停在 waiting_user，等待用户下一条消息。
 * 若把这类等待也当成「任务执行中」，需求确认表单提交会被 RUN_IN_PROGRESS 挡掉。
 */

export function runBlocksNewAgentTurn(run: {
  status: string;
  pendingToolApproval?: { status?: string } | null;
}): boolean {
  if (run.status === "accepted" || run.status === "running" || run.status === "cancelling") {
    return true;
  }
  if (run.status === "waiting_user" && run.pendingToolApproval?.status === "pending") {
    return true;
  }
  return false;
}

export function isWaitingChatTurn(run: {
  status: string;
  pendingToolApproval?: { status?: string } | null;
}): boolean {
  return run.status === "waiting_user" && !runBlocksNewAgentTurn(run);
}

const STALE_HEARTBEAT_MS = 120_000;

/** 用户已经开新一轮时，清掉卡住的生图确认 / 无心跳僵尸 run。 */
export function shouldSupersedeForNewTurn(
  run: {
    status: string;
    pendingToolApproval?: { status?: string; toolName?: string } | null;
    lastHeartbeatAt?: number;
  },
  now = Date.now(),
): boolean {
  if (
    run.status === "waiting_user" &&
    run.pendingToolApproval?.status === "pending" &&
    (run.pendingToolApproval.toolName === "generate_images" ||
      run.pendingToolApproval.toolName === "generate_image_variants" ||
      !run.pendingToolApproval.toolName)
  ) {
    return true;
  }
  if (run.status !== "accepted" && run.status !== "running" && run.status !== "cancelling") {
    return false;
  }
  if (!run.lastHeartbeatAt) return true;
  return now - run.lastHeartbeatAt > STALE_HEARTBEAT_MS;
}
