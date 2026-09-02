"use client";

import type { ProjectFile } from "@/lib/project/schema";
import { applyProjectRename, isSafeProjectId, prepareImportedProject } from "@/lib/studio/project-actions";
import { openTextFile, PROJECT_JSON_FILTERS } from "@/lib/studio/native-file";
import { useChatStore } from "@/store/chat-store";
import { useProjectStore } from "@/store/project-store";
import { nanoid } from "nanoid";

export async function renameStudioProject(id: string, rawTitle: string): Promise<boolean> {
  const project = useProjectStore.getState().get(id);
  if (!project) return false;
  const next = applyProjectRename(project, rawTitle);
  if (!next) return false;
  useProjectStore.getState().upsert(next);
  return true;
}

export async function duplicateStudioProject(id: string): Promise<boolean> {
  if (!isSafeProjectId(id)) return false;
  const res = await fetch(`/api/projects/${encodeURIComponent(id)}/duplicate`, {
    method: "POST",
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { project?: ProjectFile };
  if (!data.project) return false;
  useProjectStore.getState().upsert(data.project, { syncToDisk: false });
  return true;
}

export function revealStudioProject(id: string): boolean {
  if (!isSafeProjectId(id)) return false;
  if (!window.vadDesktop?.openProjectDir) return false;
  window.vadDesktop.openProjectDir(id);
  return true;
}

export async function deleteStudioProject(id: string): Promise<boolean> {
  if (!isSafeProjectId(id)) return false;
  const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) return false;
  useProjectStore.getState().remove(id);
  useChatStore.getState().clear(id);
  return true;
}

export async function importStudioProject(): Promise<ProjectFile | null> {
  const picked = await openTextFile({ filters: PROJECT_JSON_FILTERS });
  if (!picked.ok || picked.canceled || !picked.data) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(picked.data);
  } catch {
    return null;
  }
  const existingIds = Object.keys(useProjectStore.getState().projects);
  let project: ProjectFile;
  try {
    project = prepareImportedProject(raw, existingIds, nanoid(10));
  } catch {
    return null;
  }
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(project),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { project?: ProjectFile };
  const saved = data.project ?? project;
  useProjectStore.getState().upsert(saved, { syncToDisk: false });
  return saved;
}
