/**
 * Agent Run 持久化
 * --------------------------------------------------------------
 * 将 AgentRun 状态持久化到 .vad/projects/<id>/runs/<runId>.json
 * 支持加载历史 Run 和列出项目所有 Run。
 */

import "server-only";

import { promises as fs } from "node:fs";
import { VAD_PROJECTS_DIR, runsDir, runJsonPath } from "@/lib/vad/paths";
import { ensureDir } from "@/lib/vad/persist";
import type { AgentRun } from "./agent-run-service";

/** 可序列化的 Run 快照（去掉内部状态） */
export type RunSnapshot = Omit<AgentRun, never>;

/** 保存 Run 到磁盘 */
export async function saveRun(projectId: string, run: AgentRun): Promise<void> {
  const dir = runsDir(projectId);
  await ensureDir(dir);
  const snapshot: RunSnapshot = { ...run };
  await fs.writeFile(
    runJsonPath(projectId, run.runId),
    JSON.stringify(snapshot, null, 2),
    "utf8"
  );
}

/** 加载单个 Run */
export async function loadRun(
  projectId: string,
  runId: string
): Promise<AgentRun | null> {
  try {
    const raw = await fs.readFile(runJsonPath(projectId, runId), "utf8");
    return JSON.parse(raw) as AgentRun;
  } catch {
    return null;
  }
}

/** 列出项目所有 Run（按时间倒序） */
export async function listRuns(projectId: string): Promise<AgentRun[]> {
  const dir = runsDir(projectId);
  try {
    await fs.access(dir);
  } catch {
    return [];
  }
  const files = await fs.readdir(dir);
  const runs: AgentRun[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(`${dir}/${file}`, "utf8");
      runs.push(JSON.parse(raw) as AgentRun);
    } catch {
      // 跳过损坏的文件
    }
  }
  return runs.sort((a, b) => b.startedAt - a.startedAt);
}

export async function interruptActiveRunsOnStartup(): Promise<number> {
  let interrupted = 0;
  let projectIds: string[];
  try {
    projectIds = await fs.readdir(VAD_PROJECTS_DIR);
  } catch {
    return 0;
  }

  for (const projectId of projectIds) {
    const runs = await listRuns(projectId);
    for (const run of runs) {
      if (
        run.status !== "accepted" &&
        run.status !== "running" &&
        run.status !== "cancelling"
      ) {
        continue;
      }
      run.status = "interrupted";
      run.endedAt = Date.now();
      run.lastHeartbeatAt = Date.now();
      run.error = "Interrupted by server restart";
      await saveRun(projectId, run).catch(() => undefined);
      interrupted++;
    }
  }

  return interrupted;
}

export async function loadPendingApprovalRuns(): Promise<AgentRun[]> {
  let projectIds: string[];
  try {
    projectIds = await fs.readdir(VAD_PROJECTS_DIR);
  } catch {
    return [];
  }
  const pending: AgentRun[] = [];
  for (const projectId of projectIds) {
    const runs = await listRuns(projectId);
    for (const run of runs) {
      if (
        run.status === "waiting_user" &&
        run.pendingToolApproval?.status === "pending"
      ) {
        pending.push(run);
      }
    }
  }
  return pending;
}
