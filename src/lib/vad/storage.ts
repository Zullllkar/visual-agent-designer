/**
 * .vad 存储网关
 * --------------------------------------------------------------
 * 统一对外 API：优先走 Daemon（VAD_DAEMON_URL），不可达时回退进程内写盘。
 *
 * @author：wangjunhua
 */

import type { ProjectFile } from "@/lib/project/schema";
import type { ChatMessage } from "@/lib/agents/chat-schema";
import { mergeAssetsPreferDiscarded } from "@/lib/project/asset-visibility";
import { scheduleLinkedRepoSync } from "@/lib/bridge/repo-sync";
import type { VadFileNode } from "./types";
import {
  applyFileEditToProject,
  loadMergedProjectFromVad as loadMergedLocal,
  type ApplyFileEditResult,
} from "./apply-file-edit";
import { isDaemonEnabled } from "./daemon-config";
import * as daemon from "./daemon-client";
import * as local from "./persist";
import { loadWithDaemonFallback, loadListPreferLocalIfEmpty } from "./load-with-daemon-fallback";
import { mergeProjectsById } from "./merge-project-lists";
import { isStaleProjectWrite, nextProjectRevision } from "@/lib/project/revision";

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
  // 落盘前与磁盘合并 discarded，避免 Job/Agent 旧快照把已删素材写回
  let toSave = project;
  try {
    const existing = await loadProjectFromVad(project.id);
    if (existing) {
      if (isStaleProjectWrite(project, existing)) return existing;
      toSave = {
        ...project,
        assets: existing.assets?.length
          ? mergeAssetsPreferDiscarded(existing.assets, project.assets)
          : project.assets,
        linkedRepo: project.linkedRepo ?? existing.linkedRepo,
      };
      toSave = nextProjectRevision(toSave, existing);
    } else {
      toSave = { ...project, revision: project.revision ?? 1 };
    }
  } catch {
    /* 首次保存或读盘失败：按入参写入 */
  }

  const saved = await withFallback(
    () => daemon.daemonSaveProject(toSave),
    () => local.saveProjectToVad(toSave),
    "saveProject"
  );
  scheduleLinkedRepoSync(saved);
  return saved;
}

export async function loadProjectFromVad(
  projectId: string
): Promise<ProjectFile | null> {
  return loadWithDaemonFallback(
    () => daemon.daemonLoadProject(projectId),
    () => local.loadProjectFromVad(projectId),
    isDaemonEnabled(),
    "loadProject"
  );
}

export async function loadMergedProjectFromVad(
  projectId: string
): Promise<ProjectFile | null> {
  return loadWithDaemonFallback(
    () => daemon.daemonLoadProject(projectId),
    () => loadMergedLocal(projectId),
    isDaemonEnabled(),
    "loadMergedProject"
  );
}

export async function listProjectsFromVad(): Promise<ProjectFile[]> {
  if (!isDaemonEnabled()) return local.listProjectsFromVad();
  try {
    const fromDaemon = await daemon.daemonListProjects();
    const fromLocal = await local.listProjectsFromVad();
    return mergeProjectsById(fromDaemon, fromLocal);
  } catch (e) {
    console.warn("[vad-storage] daemon listProjects failed, fallback local:", e);
    return local.listProjectsFromVad();
  }
}

export async function deleteProjectFromVad(projectId: string): Promise<void> {
  return local.deleteProjectFromVad(projectId);
}

export async function duplicateProjectFromVad(
  projectId: string,
  newId: string
): Promise<ProjectFile> {
  return local.duplicateProjectFromVad(projectId, newId);
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
  return loadListPreferLocalIfEmpty(
    () => daemon.daemonLoadChat(projectId),
    () => local.loadChatHistoryFromVad(projectId),
    isDaemonEnabled(),
    "loadChat"
  );
}

export async function listProjectFileTree(
  projectId: string
): Promise<VadFileNode[]> {
  return loadListPreferLocalIfEmpty(
    () => daemon.daemonListFileTree(projectId),
    () => local.listProjectFileTree(projectId),
    isDaemonEnabled(),
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
