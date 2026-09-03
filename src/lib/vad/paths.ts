/**
 * .vad 路径常量
 * --------------------------------------------------------------
 * 本地项目文件系统根目录：.vad/projects/<projectId>/
 * 桌面端通过 VAD_ROOT / VAD_CHECKPOINTS_DIR 指到 userData。
 *
 * @author：wangjunhua
 */

import { join } from "node:path";

export function resolveVadRoot(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
): string {
  return env.VAD_ROOT?.trim() || join(cwd, ".vad");
}

export function resolveCheckpointsDir(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
): string {
  return env.VAD_CHECKPOINTS_DIR?.trim() || join(cwd, ".vad-data");
}

export function resolveProjectRoot(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
): string {
  return env.VAD_PROJECT_ROOT?.trim() || cwd;
}

export const VAD_ROOT = resolveVadRoot();
export const VAD_PROJECTS_DIR = join(VAD_ROOT, "projects");
export const VAD_CHECKPOINTS_DIR = resolveCheckpointsDir();

export function projectDir(projectId: string): string {
  return join(VAD_PROJECTS_DIR, projectId);
}

export function projectJsonPath(projectId: string): string {
  return join(projectDir(projectId), "project.json");
}

export function canvasJsonPath(projectId: string): string {
  return join(projectDir(projectId), "canvas.json");
}

export function chatHistoryPath(projectId: string): string {
  return join(projectDir(projectId), "chat-history.jsonl");
}

export function conversationsJsonPath(projectId: string): string {
  return join(projectDir(projectId), "conversations.json");
}

/** 流水线执行日志（JSONL，每行一条） */
export function pipelineLogPath(projectId: string): string {
  return join(projectDir(projectId), "pipeline-log.jsonl");
}

/** 允许在线编辑的相对路径前缀 */
export const EDITABLE_PREFIXES = [
  "prompts/",
  "handoff/",
  "design/",
  "html-artifact/",
] as const;

export const EDITABLE_EXTENSIONS = [".md", ".json", ".txt", ".cursorrules"] as const;

/** LangGraph SqliteSaver checkpoint 存储目录 */
export function checkpointsDir(): string {
  return VAD_CHECKPOINTS_DIR;
}

/** checkpoint SQLite 文件路径 */
export function checkpointDbPath(): string {
  return join(VAD_CHECKPOINTS_DIR, "checkpoints.sqlite");
}

/** Agent Run 持久化目录 */
export function runsDir(projectId: string): string {
  return join(projectDir(projectId), "runs");
}

/** 单个 Run JSON 文件路径 */
export function runJsonPath(projectId: string, runId: string): string {
  return join(runsDir(projectId), `${runId}.json`);
}

export function jobsDir(projectId: string): string {
  return join(projectDir(projectId), "jobs");
}

export function jobJsonPath(projectId: string, jobId: string): string {
  return join(jobsDir(projectId), `${jobId}.json`);
}

/** 事件日志文件路径（JSONL） */
export function eventLogPath(projectId: string): string {
  return join(projectDir(projectId), "event-log.jsonl");
}

/** coding agent 回报的实现截图与验收报告目录 */
export function implementationDir(projectId: string): string {
  return join(projectDir(projectId), "implementation");
}

export function implementationReportPath(projectId: string, reportId: string): string {
  return join(implementationDir(projectId), `${reportId}.json`);
}
