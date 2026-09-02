import type { ProjectFile } from "@/lib/project/schema";
import { parseTargetId, type TargetId } from "@/lib/targets/resolve";

export const HOME_PROJECT_PREVIEW_LIMIT = 3;
export const LIBRARY_PAGE_SIZE = 12;

export type LibraryTargetFilter = "all" | TargetId;

export function latestStudioProjects(
  projects: readonly ProjectFile[],
  limit = HOME_PROJECT_PREVIEW_LIMIT,
): ProjectFile[] {
  return [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
}

export function paginateStudioLibrary<T>(
  items: readonly T[],
  page: number,
  pageSize = LIBRARY_PAGE_SIZE,
): {
  items: T[];
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
} {
  const total = items.length;
  const size = Math.max(1, pageSize);
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(pageCount, Math.max(1, Math.trunc(page) || 1));
  const start = (current - 1) * size;
  return {
    items: items.slice(start, start + size),
    page: current,
    pageCount,
    pageSize: size,
    total,
  };
}

export function projectMatchesLibraryTarget(
  targetId: string | undefined,
  filter: LibraryTargetFilter,
): boolean {
  if (filter === "all") return true;
  return parseTargetId(targetId) === filter;
}

export function formatLibraryDate(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;
}
