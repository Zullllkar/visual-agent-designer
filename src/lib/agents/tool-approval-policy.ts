import "server-only";
import type { ProjectFile } from "@/lib/project/schema";

/** Per-project consent for moderate tools. Destructive/external tools never use it. */
const grants = new Map<string, Set<string>>();

export function grantToolForProject(projectId: string, toolName: string): void {
  const set = grants.get(projectId) ?? new Set<string>();
  set.add(toolName);
  grants.set(projectId, set);
}

export function isToolGrantedForProject(projectId: string | undefined, toolName: string): boolean {
  return Boolean(projectId && grants.get(projectId)?.has(toolName));
}

export function isToolGrantedByProject(project: ProjectFile | null | undefined, toolName: string): boolean {
  return project?.approvalPolicy?.[toolName] === "project";
}

export function grantToolInProject(project: ProjectFile, toolName: string): ProjectFile {
  return {
    ...project,
    approvalPolicy: { ...(project.approvalPolicy ?? {}), [toolName]: "project" },
    updatedAt: new Date().toISOString(),
  };
}

export function revokeToolInProject(project: ProjectFile, toolName?: string): ProjectFile {
  const next = { ...(project.approvalPolicy ?? {}) };
  if (toolName) delete next[toolName];
  else for (const key of Object.keys(next)) delete next[key];
  return {
    ...project,
    approvalPolicy: Object.keys(next).length ? next : undefined,
    updatedAt: new Date().toISOString(),
  };
}

export function revokeToolGrant(projectId: string, toolName?: string): void {
  if (!toolName) {
    grants.delete(projectId);
    return;
  }
  const set = grants.get(projectId);
  set?.delete(toolName);
  if (set?.size === 0) grants.delete(projectId);
}
