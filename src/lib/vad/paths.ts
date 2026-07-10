/**
 * .vad 路径常量
 * --------------------------------------------------------------
 * 本地项目文件系统根目录：.vad/projects/<projectId>/
 *
 * @author：wangjunhua
 */

import { join } from "node:path";

export const VAD_ROOT = join(process.cwd(), ".vad");
export const VAD_PROJECTS_DIR = join(VAD_ROOT, "projects");

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
