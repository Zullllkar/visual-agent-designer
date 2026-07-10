"use client";

import { useMemo, useEffect } from "react";
import Link from "next/link";
import { FolderOpen, Loader2 } from "lucide-react";
import { useProjectStore } from "@/store/project-store";
import { useProjectStoreHydrated } from "@/lib/use-hydrated";
import { usePreferences } from "@/lib/preferences";

export function ProjectList() {
  const hydrated = useProjectStoreHydrated();
  const importProjectsQuietly = useProjectStore((s) => s.importProjectsQuietly);
  const { locale, t } = usePreferences();

  const projectsDict = useProjectStore((s) => s.projects);
  const projects = useMemo(
    () =>
      Object.values(projectsDict).sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt)
      ),
    [projectsDict]
  );

  useEffect(() => {
    if (hydrated) {
      fetch("/api/projects")
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) {
            importProjectsQuietly(data);
          }
        })
        .catch((err) => {
          console.warn("[project-list] pull disk projects failed:", err);
        });
    }
  }, [hydrated, importProjectsQuietly]);

  if (!hydrated) {
    return (
      <div className="app-empty">
        <Loader2 className="mb-3 size-5 animate-spin text-[var(--primary)]" />
        {t("projects.loading")}
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="app-empty">
        <FolderOpen className="mb-3 size-8 text-[var(--primary)] opacity-60" />
        <p>{t("projects.empty")}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      {projects.map((p) => (
        <Link
          key={p.id}
          href={`/projects/${p.id}`}
          className="app-card app-card-interactive group rounded-2xl p-5"
        >
          <div className="flex items-start justify-between gap-3">
            <h3 className="line-clamp-1 text-sm font-semibold tracking-tight transition-colors group-hover:text-[var(--primary)]">
              {p.title}
            </h3>
            <span className="app-badge shrink-0">
              {p.pages.length} {t("projects.pages")}
            </span>
          </div>
          <p className="mt-3 line-clamp-2 text-sm leading-relaxed app-subtle">
            {p.rawIdea}
          </p>
          <div className="mt-5 flex items-center justify-between gap-2 border-t border-[color-mix(in_srgb,var(--border)_70%,transparent)] pt-4">
            <span className="rounded-full bg-[var(--surface-muted)] px-2.5 py-0.5 text-[11px] app-subtle">
              {t("projects.updated")}:{" "}
              {new Date(p.updatedAt).toLocaleDateString(
                locale === "zh" ? "zh-CN" : "en-US"
              )}
            </span>
            <span className="text-xs font-semibold text-[var(--primary)] opacity-0 transition-opacity group-hover:opacity-100">
              {t("projects.open")} →
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}
