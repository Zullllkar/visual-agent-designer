/**
 * .vad 存储网关
 * --------------------------------------------------------------
 * 统一对外 API：优先走 Daemon（VAD_DAEMON_URL），不可达时回退进程内写盘。
 *
 * @author：wangjunhua
 */

import type { ProjectFile } from "@/lib/project/schema";
import type { ChatMessage } from "@/lib/agents/chat-schema";
import type { VadFileNode } from "./types";
import {
  applyFileEditToProject,
  loadMergedProjectFromVad as loadMergedLocal,
  type ApplyFileEditResult,
} from "./apply-file-edit";
import { isDaemonEnabled } from "./daemon-config";
import * as daemon from "./daemon-client";
import * as local from "./persist";

export type { VadFileNode } from "./types";
export type { ApplyFileEditResult } from "./apply-file-edit";

/** 是否当前通过 Daemon 落盘（供调试 UI 使用） */
export { isDaemonEnabled };

async function withFallback<T>(
  daemonFn: () => Promise<T>,
  localFn: () => Promise<T>,
  label: string
): Promise<T> {
  if (!isDaemonEnabled()) return localFn();
  try {
    return await daemonFn();
  } catch (e) {
    console.warn(`[vad-storage] daemon ${label} failed, fallback local:`, e);
    return localFn();
  }
}

export async function saveProjectToVad(
  project: ProjectFile
): Promise<ProjectFile> {
  return withFallback(
    () => daemon.daemonSaveProject(project),
    () => local.saveProjectToVad(project),
    "saveProject"
  );
}

export async function loadProjectFromVad(
  projectId: string
): Promise<ProjectFile | null> {
  return withFallback(
    async () => {
      const p = await daemon.daemonLoadProject(projectId);
      return p;
    },
    () => local.loadProjectFromVad(projectId),
    "loadProject"
  );
}

export async function loadMergedProjectFromVad(
  projectId: string
): Promise<ProjectFile | null> {
  return withFallback(
    () => daemon.daemonLoadProject(projectId),
    () => loadMergedLocal(projectId),
    "loadMergedProject"
  );
}

export async function listProjectsFromVad(): Promise<ProjectFile[]> {
  return withFallback(
    () => daemon.daemonListProjects(),
    () => local.listProjectsFromVad(),
    "listProjects"
  );
}

export async function saveChatHistoryToVad(
  projectId: string,
  messages: ChatMessage[]
): Promise<void> {
  return withFallback(
    () => daemon.daemonSaveChat(projectId, messages),
    () => local.saveChatHistoryToVad(projectId, messages),
    "saveChat"
  );
}

export async function loadChatHistoryFromVad(
  projectId: string
): Promise<ChatMessage[]> {
  return withFallback(
    () => daemon.daemonLoadChat(projectId),
    () => local.loadChatHistoryFromVad(projectId),
    "loadChat"
  );
}

export async function listProjectFileTree(
  projectId: string
): Promise<VadFileNode[]> {
  return withFallback(
    () => daemon.daemonListFileTree(projectId),
    () => local.listProjectFileTree(projectId),
    "listFiles"
  );
}

export async function readProjectFile(
  projectId: string,
  relPath: string
): Promise<string> {
  return withFallback(
    () => daemon.daemonReadFile(projectId, relPath),
    () => local.readProjectFile(projectId, relPath),
    "readFile"
  );
}

export async function writeProjectFile(
  projectId: string,
  relPath: string,
  content: string
): Promise<void> {
  return withFallback(
    async () => {
      await daemon.daemonWriteFile(projectId, relPath, content);
    },
    () => local.writeProjectFile(projectId, relPath, content),
    "writeFile"
  );
}

export async function applyFileEditToProjectViaStorage(
  projectId: string,
  relPath: string,
  content: string
): Promise<ApplyFileEditResult> {
  if (!isDaemonEnabled()) {
    await local.writeProjectFile(projectId, relPath, content);
    return applyFileEditToProject(projectId, relPath, content);
  }
  try {
    const out = await daemon.daemonWriteFile(projectId, relPath, content);
    if (out.project) {
      return { synced: true, project: out.project };
    }
    return { synced: false, reason: "unchanged" };
  } catch (e) {
    console.warn("[vad-storage] daemon writeFile failed, fallback local:", e);
    await local.writeProjectFile(projectId, relPath, content);
    return applyFileEditToProject(projectId, relPath, content);
  }
}
