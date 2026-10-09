import type { ProjectFile } from "@/lib/project/schema";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function isSafeProjectId(id: string): boolean {
  return SAFE_ID.test(id);
}

export function normalizeProjectTitle(raw: string): string | null {
  const title = raw.trim().replace(/\s+/g, " ");
  return title.length > 0 ? title : null;
}

export function applyProjectRename(
  project: ProjectFile,
  rawTitle: string,
  updatedAt: string = new Date().toISOString()
): ProjectFile | null {
  const title = normalizeProjectTitle(rawTitle);
  if (!title) return null;
  return { ...project, title, updatedAt };
}

export function applyProjectDuplicate(
  project: ProjectFile,
  newId: string,
  now: string = new Date().toISOString()
): ProjectFile {
  const oldId = project.id;
  const rewritten = JSON.parse(
    JSON.stringify(project)
      .split(`/api/assets/${oldId}/`)
      .join(`/api/assets/${newId}/`)
      .split(`/api/projects/${oldId}/`)
      .join(`/api/projects/${newId}/`)
      .split(`"projectId":"${oldId}"`)
      .join(`"projectId":"${newId}"`)
      .split(`"projectId": "${oldId}"`)
      .join(`"projectId": "${newId}"`)
  ) as ProjectFile;
  const slugBase = project.slug.replace(/-copy$/, "") || newId;
  return {
    ...rewritten,
    id: newId,
    slug: `${slugBase}-copy`.slice(0, 40),
    title: `${project.title} 副本`,
    createdAt: now,
    updatedAt: now,
    linkedRepo: undefined,
    workspacePath: undefined,
  };
}

export function projectExportFilename(project: Pick<ProjectFile, "id" | "slug">): string {
  const base = project.slug.trim() || project.id;
  return `${base}.project.json`;
}

export function isImportableProject(raw: unknown): raw is ProjectFile {
  if (!raw || typeof raw !== "object") return false;
  const rec = raw as Record<string, unknown>;
  return (
    typeof rec.id === "string" &&
    isSafeProjectId(rec.id) &&
    typeof rec.title === "string" &&
    rec.title.trim().length > 0 &&
    Array.isArray(rec.pages)
  );
}

/** 导入 JSON：id 冲突时改成副本，避免覆盖本机已有项目。 */
export function prepareImportedProject(
  raw: unknown,
  existingIds: Iterable<string>,
  newId: string
): ProjectFile {
  if (!isImportableProject(raw)) {
    throw new Error("invalid_project");
  }
  const taken = new Set(existingIds);
  if (!taken.has(raw.id)) return raw;
  if (!isSafeProjectId(newId) || taken.has(newId)) {
    throw new Error("invalid_project_id");
  }
  return applyProjectDuplicate(raw, newId);
}
