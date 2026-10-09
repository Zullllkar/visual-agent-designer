"use client";

import type { ProjectFile } from "@/lib/project/schema";
import { workspaceFolderName } from "@/lib/studio/workspace-name";
import { useProjectStore } from "@/store/project-store";

export type HomeWorkspace = {
  path: string;
  label: string;
  projectId?: string;
};

const STORAGE_KEY = "vad.home.workspace.v1";

export function parseStoredHomeWorkspace(raw: string | null | undefined): HomeWorkspace | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as {
      path?: unknown;
      label?: unknown;
      projectId?: unknown;
    };
    if (typeof parsed.path !== "string" || !parsed.path.trim()) return null;
    return {
      path: parsed.path,
      label:
        typeof parsed.label === "string" ? parsed.label : workspaceFolderName(parsed.path),
      projectId: typeof parsed.projectId === "string" ? parsed.projectId : undefined,
    };
  } catch {
    return null;
  }
}

export function readStoredHomeWorkspace(): HomeWorkspace | null {
  if (typeof window === "undefined") return null;
  try {
    return parseStoredHomeWorkspace(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function storeHomeWorkspace(value: HomeWorkspace | null): void {
  if (typeof window === "undefined") return;
  if (!value) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export async function pickLocalDirectory(): Promise<string | null> {
  if (typeof window !== "undefined" && window.vadDesktop?.pickDirectory) {
    const result = await window.vadDesktop.pickDirectory();
    if (!result.ok || result.canceled || !result.path) return null;
    return result.path;
  }
  const typed = window.prompt("输入本机目录的绝对路径（将在该目录创作，而不是应用数据目录）");
  const path = typed?.trim();
  return path || null;
}

export async function attachLocalWorkspace(input: {
  path: string;
  idea?: string;
  mkdirIfMissing?: boolean;
}): Promise<HomeWorkspace> {
  const res = await fetch("/api/workspaces", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      path: input.path,
      idea: input.idea,
      mkdirIfMissing: input.mkdirIfMissing === true,
    }),
  });
  const data = (await res.json()) as {
    error?: string;
    project?: ProjectFile;
    workspacePath?: string;
  };
  if (!res.ok || !data.project || !data.workspacePath) {
    throw new Error(data.error || "无法打开该目录");
  }
  useProjectStore.getState().upsert(data.project, { syncToDisk: false });
  const next: HomeWorkspace = {
    path: data.workspacePath,
    label: data.project.title || workspaceFolderName(data.workspacePath),
    projectId: data.project.id,
  };
  storeHomeWorkspace(next);
  return next;
}

export async function pickAndAttachWorkspace(input: {
  mkdirIfMissing: boolean;
  idea?: string;
}): Promise<HomeWorkspace | null> {
  const path = await pickLocalDirectory();
  if (!path) return null;
  return attachLocalWorkspace({
    path,
    idea: input.idea,
    mkdirIfMissing: input.mkdirIfMissing,
  });
}
