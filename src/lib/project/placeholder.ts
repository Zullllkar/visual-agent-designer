/**
 * 首页跳转 IDE 前的占位项目
 * --------------------------------------------------------------
 * @author：wangjunhua
 */

import type { ProjectFile } from "./schema";

export function createPlaceholderProject(
  id: string,
  rawIdea: string
): ProjectFile {
  const now = new Date().toISOString();
  const title =
    rawIdea.trim().slice(0, 48) +
    (rawIdea.trim().length > 48 ? "…" : "") || "新项目";
  const slug = id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  return {
    id,
    slug: slug || id,
    title,
    rawIdea: rawIdea.trim(),
    createdAt: now,
    updatedAt: now,
    pages: [],
  };
}
