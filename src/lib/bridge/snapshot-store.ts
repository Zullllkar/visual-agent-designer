/**
 * 设计快照落盘（server-only）
 * --------------------------------------------------------------
 * .vad/projects/<id>/snapshots/<takenAt>.json。内容指纹没变就不重复写；
 * 只保留最近 MAX_KEEP 份。coding agent 拉交付包 / 拿单屏任务 / 回报实现时各记一次，
 * 这样 get_design_changes 总能找到"agent 上次看到的那版"。
 */

import "server-only";

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { type DesignSnapshot, takeDesignSnapshot } from "@/lib/handoff/design-snapshot";
import type { ProjectFile } from "@/lib/project/schema";
import { designSnapshotsDir } from "@/lib/vad/paths";
import { ensureDir } from "@/lib/vad/persist";

const MAX_KEEP = 40;
const inflight = new Map<string, Promise<DesignSnapshot>>();

/** 记录当前设计状态；同一进程内并发调用合并成一次写盘。 */
export function recordDesignSnapshot(project: ProjectFile): Promise<DesignSnapshot> {
  const existing = inflight.get(project.id);
  if (existing) return existing;
  const task = writeSnapshot(project).finally(() => inflight.delete(project.id));
  inflight.set(project.id, task);
  return task;
}

async function writeSnapshot(project: ProjectFile): Promise<DesignSnapshot> {
  const snapshot = takeDesignSnapshot(project);
  const dir = designSnapshotsDir(project.id);
  await ensureDir(dir);
  const all = await listDesignSnapshots(project.id);
  const newest = all[0];
  if (newest && newest.hash === snapshot.hash) return newest;

  const file = join(dir, `${snapshot.takenAt.replace(/[:.]/g, "-")}.json`);
  await fs.writeFile(file, JSON.stringify(snapshot), "utf8");

  const stale = all.slice(MAX_KEEP - 1);
  for (const s of stale) {
    await fs.unlink(join(dir, fileNameFor(s))).catch(() => undefined);
  }
  return snapshot;
}

/** 新→旧 */
export async function listDesignSnapshots(projectId: string): Promise<DesignSnapshot[]> {
  const dir = designSnapshotsDir(projectId);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: DesignSnapshot[] = [];
  for (const name of names.filter((n) => n.endsWith(".json"))) {
    try {
      const parsed = JSON.parse(await fs.readFile(join(dir, name), "utf8")) as DesignSnapshot;
      if (parsed?.version === 1 && parsed.projectId === projectId) out.push(parsed);
    } catch {
      // 坏文件跳过
    }
  }
  return out.sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}

/**
 * 找基线：takenAt ≤ since 的最新一份。没有更早的就退到最早那份
 * （agent 第一次问时至少给它一个"从项目最初到现在"的 diff）。
 */
export async function findBaselineSnapshot(
  projectId: string,
  sinceMs: number,
): Promise<{ snapshot: DesignSnapshot; exact: boolean } | null> {
  const all = await listDesignSnapshots(projectId);
  if (all.length === 0) return null;
  const at = all.find((s) => Date.parse(s.takenAt) <= sinceMs);
  if (at) return { snapshot: at, exact: true };
  return { snapshot: all[all.length - 1], exact: false };
}

function fileNameFor(s: DesignSnapshot): string {
  return `${s.takenAt.replace(/[:.]/g, "-")}.json`;
}
