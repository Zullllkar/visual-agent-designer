/**
 * 项目解析
 * --------------------------------------------------------------
 * `project` 参数支持：精确 id → slug → 精确标题 → 标题子串（唯一命中）。
 * 省略时回退到 active context。所有工具共用，保证提示语一致。
 */

import { isCodingHandoffPack, resolveHandoffPackKind } from "@/lib/handoff/pack-kind";
import type { ProjectFile } from "@/lib/project/schema";
import { listProjectsFromVad, loadMergedProjectFromVad } from "@/lib/vad/storage";
import { activeContext } from "./active-context";

export type ProjectResolution =
  | { ok: true; project: ProjectFile; source: "id" | "slug" | "title" | "substring" | "active" }
  | { ok: false; error: string; candidates?: Array<{ id: string; title: string }> };

export async function resolveProject(
  ref: string | undefined | null
): Promise<ProjectResolution> {
  const query = ref?.trim();

  if (!query) {
    const ctx = activeContext.snapshot();
    if (!ctx.active || !ctx.projectId) {
      return {
        ok: false,
        error:
          ctx.hint ??
          "No active project. Pass `project` (id or title) or ask the user to open a project in Vibeboard.",
      };
    }
    const project = await loadMergedProjectFromVad(ctx.projectId).catch(() => null);
    if (!project) {
      return { ok: false, error: `Active project ${ctx.projectId} could not be loaded from disk.` };
    }
    return { ok: true, project, source: "active" };
  }

  const direct = await loadMergedProjectFromVad(query).catch(() => null);
  if (direct) return { ok: true, project: direct, source: "id" };

  const all = await listProjectsFromVad().catch(() => [] as ProjectFile[]);
  const lower = query.toLowerCase();

  const bySlug = all.find((p) => p.slug === query);
  if (bySlug) return hydrate(bySlug, "slug");

  const byTitle = all.find((p) => p.title.toLowerCase() === lower);
  if (byTitle) return hydrate(byTitle, "title");

  const partial = all.filter((p) => p.title.toLowerCase().includes(lower));
  if (partial.length === 1) return hydrate(partial[0], "substring");
  if (partial.length > 1) {
    return {
      ok: false,
      error: `"${query}" matches ${partial.length} projects. Pass the exact id.`,
      candidates: partial.slice(0, 10).map((p) => ({ id: p.id, title: p.title })),
    };
  }

  return {
    ok: false,
    error: `No project matches "${query}". Call list_projects to see available ids.`,
  };
}

async function hydrate(
  summary: ProjectFile,
  source: "slug" | "title" | "substring"
): Promise<ProjectResolution> {
  const project = (await loadMergedProjectFromVad(summary.id).catch(() => null)) ?? summary;
  return { ok: true, project, source };
}

export function summarizeProject(project: ProjectFile) {
  const assets = project.assets ?? [];
  const finals = assets.filter(
    (a) =>
      a.status !== "discarded" &&
      a.status !== "failed" &&
      a.status !== "cancelled" &&
      a.status !== "generating" &&
      a.source !== "materialized" &&
      !!a.src
  );
  return {
    id: project.id,
    slug: project.slug,
    title: project.title,
    rawIdea: project.rawIdea,
    targetId: project.targetId ?? "ui-visual",
    packKind: resolveHandoffPackKind(project),
    codingHandoff: isCodingHandoffPack(resolveHandoffPackKind(project)),
    platform: project.brief?.platform,
    positioning: project.brief?.positioning,
    visualStyle: project.brief?.visualStyle,
    finalAssetCount: finals.length,
    starredAssetCount: finals.filter((a) => a.status === "starred").length,
    referenceCount: project.references?.length ?? 0,
    materializationCount: Object.keys(project.materializations ?? {}).length,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}
