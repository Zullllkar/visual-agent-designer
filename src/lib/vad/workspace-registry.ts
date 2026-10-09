/**
 * 用户工作区索引：id → 本机目录。应用数据根只记指针，创作写进目录里的 .vibeboard。
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { workspacesIndexPath } from "./paths";
import {
  bindProjectWorkspace,
  setWorkspaceBindingLoader,
  unbindProjectWorkspace,
} from "./workspace-bindings";

export type WorkspaceIndexEntry = {
  id: string;
  path: string;
  title: string;
  updatedAt: string;
};

type WorkspaceIndexFile = {
  version: 1;
  entries: Record<string, WorkspaceIndexEntry>;
};

let ready = false;
let indexCache: Record<string, WorkspaceIndexEntry> = {};

function readIndexFile(filePath: string): WorkspaceIndexFile {
  try {
    const text = readFileSync(filePath, "utf8");
    if (!text.trim()) return { version: 1, entries: {} };
    const raw = JSON.parse(text) as WorkspaceIndexFile;
    if (raw?.version === 1 && raw.entries && typeof raw.entries === "object") {
      return raw;
    }
  } catch {
    /* missing or corrupt */
  }
  return { version: 1, entries: {} };
}

function writeIndexFile(): void {
  const filePath = workspacesIndexPath();
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    JSON.stringify({ version: 1, entries: indexCache }, null, 2),
    "utf8",
  );
}

function hydrateBindings(): void {
  for (const entry of Object.values(indexCache)) {
    bindProjectWorkspace(entry.id, entry.path);
  }
}

export function loadWorkspaceIndex(): void {
  indexCache = readIndexFile(workspacesIndexPath()).entries;
  hydrateBindings();
  ready = true;
}

function ensureIndex(): void {
  if (ready) return;
  loadWorkspaceIndex();
}

setWorkspaceBindingLoader(loadWorkspaceIndex);

export function rememberWorkspace(entry: WorkspaceIndexEntry): void {
  ensureIndex();
  indexCache[entry.id] = entry;
  bindProjectWorkspace(entry.id, entry.path);
  writeIndexFile();
}

export function forgetWorkspace(projectId: string): void {
  ensureIndex();
  delete indexCache[projectId];
  unbindProjectWorkspace(projectId);
  writeIndexFile();
}

export function listWorkspaceIndex(): WorkspaceIndexEntry[] {
  ensureIndex();
  return Object.values(indexCache).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export function peekWorkspaceEntry(
  projectId: string,
): WorkspaceIndexEntry | undefined {
  ensureIndex();
  return indexCache[projectId];
}

export function resetWorkspaceRegistry(): void {
  ready = false;
  indexCache = {};
}
