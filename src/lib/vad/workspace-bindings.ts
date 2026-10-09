/**
 * In-memory projectId → user workspace folder.
 * paths.projectDir reads this so assets/chat still resolve after bind.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const workspaceById = new Map<string, string>();
let ensureLoaded: (() => void) | null = defaultLoadWorkspaceIndex;
let loaded = false;

function defaultLoadWorkspaceIndex(): void {
  const root = process.env.VAD_ROOT?.trim() || join(process.cwd(), ".vad");
  try {
    const text = readFileSync(join(root, "workspaces.json"), "utf8");
    if (!text.trim()) return;
    const raw = JSON.parse(text) as {
      version?: number;
      entries?: Record<string, { id: string; path: string }>;
    };
    if (raw?.version !== 1 || !raw.entries) return;
    for (const entry of Object.values(raw.entries)) {
      if (entry?.id && entry?.path) workspaceById.set(entry.id, entry.path);
    }
  } catch {
    /* missing index */
  }
}

export function setWorkspaceBindingLoader(loader: () => void): void {
  ensureLoaded = loader;
  loaded = false;
}

export function ensureWorkspaceBindingsLoaded(): void {
  if (loaded) return;
  loaded = true;
  ensureLoaded?.();
}

export function bindProjectWorkspace(projectId: string, workspacePath: string): void {
  workspaceById.set(projectId, workspacePath);
}

export function unbindProjectWorkspace(projectId: string): void {
  workspaceById.delete(projectId);
}

export function peekProjectWorkspace(projectId: string): string | undefined {
  ensureWorkspaceBindingsLoaded();
  return workspaceById.get(projectId);
}

export function listBoundWorkspaces(): Array<{ id: string; path: string }> {
  ensureWorkspaceBindingsLoaded();
  return [...workspaceById.entries()].map(([id, path]) => ({ id, path }));
}

export function resetWorkspaceBindings(): void {
  workspaceById.clear();
  loaded = false;
}
