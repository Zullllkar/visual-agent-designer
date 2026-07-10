/**
 * 流水线日志落盘（.vad/projects/<id>/pipeline-log.jsonl）
 * --------------------------------------------------------------
 * @author：wangjunhua
 */

import "server-only";

import { appendFile, readFile } from "node:fs/promises";
import type { PipelineLogEntry } from "@/lib/agents/pipeline-logger";
import { ensureDir } from "./persist";
import { pipelineLogPath, projectDir } from "./paths";

/** 追加一条日志行（JSONL） */
export async function appendPipelineLogEntry(
  projectId: string,
  entry: PipelineLogEntry,
  runMeta?: { runId: string; source: string }
): Promise<void> {
  const dir = projectDir(projectId);
  await ensureDir(dir);
  const line = JSON.stringify({
    ...entry,
    runId: runMeta?.runId,
    source: runMeta?.source,
  });
  await appendFile(pipelineLogPath(projectId), line + "\n", "utf8");
}

/** 读取最近 N 条日志（倒序截取后再正序返回） */
export async function readPipelineLog(
  projectId: string,
  limit = 500
): Promise<PipelineLogEntry[]> {
  const path = pipelineLogPath(projectId);
  try {
    const raw = await readFile(path, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const slice = lines.slice(-limit);
    return slice.map((line) => JSON.parse(line) as PipelineLogEntry);
  } catch {
    return [];
  }
}
