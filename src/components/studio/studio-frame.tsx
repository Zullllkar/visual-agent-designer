"use client";

import { FolderKanban, FolderOpen, PanelLeft, PenLine, Puzzle } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { VadMark } from "@/components/brand/vad-mark";
import { formatRelativeTime, projectCoverSrc } from "@/lib/project/cover";
import type { ProjectFile } from "@/lib/project/schema";
import { isMockImageConfig, isMockLlmConfig } from "@/lib/providers/validate";
import { openSettings } from "@/lib/settings/events";
import { useStudioRail } from "@/lib/studio/rail";
import { getTargetRecipe, isTargetId } from "@/lib/targets/catalog";
import { useProjectStoreHydrated } from "@/lib/use-hydrated";
import { useProjectStore } from "@/store/project-store";
import { useProviderStore } from "@/store/provider-store";
import "./studio-home.css";

export type StudioSection = "home" | "projects" | "skills";

function targetLabel(id?: string): string {
  return isTargetId(id) ? getTargetRecipe(id).label : "画布";
}

function RecentProject({ project }: { project: ProjectFile }) {
  const cover = projectCoverSrc(project);
  return (
    <Link href={`/projects/${project.id}`} className="studio-recent-item">
      <span className="studio-thumb">
        {cover ? <img src={cover} alt="" /> : <VadMark size={14} />}
      </span>
      <span className="studio-recent-meta">
        <span>{project.title}</span>
        <small>
          {targetLabel(project.targetId)} · {formatRelativeTime(project.updatedAt)}
        </small>
      </span>
    </Link>
  );
}

export function StudioFrame({
  active,
  children,
}: {
  active: StudioSection;
  children: React.ReactNode;
}) {
  const hydrated = useProjectStoreHydrated();
  const importProjectsQuietly = useProjectStore((state) => state.importProjectsQuietly);
  const projectsDict = useProjectStore((state) => state.projects);
  const providerConfig = useProviderStore((state) => state.config);
  const [rail, persistRail] = useStudioRail();
  const [mobileOpen, setMobileOpen] = useState(false);
  const projects = useMemo(
    () => Object.values(projectsDict).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [projectsDict],
  );
  const modelReady = !isMockLlmConfig(providerConfig) && !isMockImageConfig(providerConfig);

  useEffect(() => {
    if (!hydrated) return;
    void fetch("/api/projects")
      .then(async (response) => {
        const type = response.headers.get("content-type") ?? "";
        if (!response.ok || !type.includes("application/json")) return [];
        const text = await response.text();
        if (!text.trim()) return [];
        return JSON.parse(text) as unknown;
      })
      .then((data) => {
        if (Array.isArray(data)) importProjectsQuietly(data);
      })
      .catch((error) => {
        console.warn("[studio-frame] pull disk projects failed:", error);
      });
  }, [hydrated, importProjectsQuietly]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        openSettings();
      }
      if (event.key === "Escape") setMobileOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shellClass = ["studio-app", rail ? "is-rail" : "", mobileOpen ? "is-mobile-open" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={shellClass}>
      {mobileOpen ? (
        <button
          type="button"
          className="studio-backdrop"
          aria-label="关闭侧栏"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <aside className="studio-sidebar" aria-label="主导航">
        <div className="studio-side-top">
          <Link href="/" className="studio-brand">
            <span className="studio-brand-mark">
              <VadMark size={26} />
            </span>
            <span className="studio-brand-name">Vibeboard</span>
          </Link>
          <button
            type="button"
            className="studio-icon-btn"
            aria-label={rail ? "展开侧栏" : "收起侧栏"}
            onClick={() => persistRail(!rail)}
          >
            <PanelLeft className="size-4" />
          </button>
        </div>

        <Link
          href="/#create"
          className={`studio-create${active === "home" ? " is-active" : ""}`}
          data-tip="开始创作"
          onClick={() => setMobileOpen(false)}
        >
          <PenLine className="size-3.5" />
          <span className="studio-create-label">开始创作</span>
        </Link>

        <nav className="studio-nav" aria-label="工作室">
          <Link
            href="/projects"
            className={`studio-nav-item${active === "projects" ? " is-active" : ""}`}
            data-tip="项目库"
            onClick={() => setMobileOpen(false)}
          >
            <FolderKanban className="size-4" />
            <span className="studio-nav-text">项目库</span>
            <span className="studio-nav-count">{projects.length}</span>
          </Link>
          <Link
            href="/skills"
            className={`studio-nav-item${active === "skills" ? " is-active" : ""}`}
            data-tip="Skill"
            onClick={() => setMobileOpen(false)}
          >
            <Puzzle className="size-4" />
            <span className="studio-nav-text">Skill</span>
          </Link>
        </nav>

        <div className="studio-recent">
          <div className="studio-recent-label">最近项目</div>
          <ul className="studio-recent-list">
            {!hydrated ? (
              <li className="studio-recent-empty">读取本地项目…</li>
            ) : projects.length === 0 ? (
              <li className="studio-recent-empty">还没有项目</li>
            ) : (
              projects.slice(0, 8).map((project) => (
                <li key={project.id}>
                  <RecentProject project={project} />
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="studio-side-foot">
          <button
            type="button"
            className="studio-acct"
            data-tip="设置"
            onClick={() => openSettings()}
          >
            <span className="studio-avatar" aria-hidden>
              <VadMark size={16} />
            </span>
            <span className="studio-user-meta">
              <strong>设置</strong>
              <span>{modelReady ? "模型已就绪" : "先配置模型才能生成"}</span>
            </span>
          </button>
        </div>
      </aside>

      <main className={`studio-main studio-main--${active}`}>
        <div className="studio-stage-dots" aria-hidden />
        <div className="studio-mobile-bar">
          <button
            type="button"
            className="studio-icon-btn"
            aria-label="打开菜单"
            onClick={() => setMobileOpen(true)}
          >
            <FolderOpen className="size-4" />
          </button>
          <strong>
            {active === "projects" ? "项目库" : active === "skills" ? "Skill" : "开始创作"}
          </strong>
        </div>
        {children}
      </main>
    </div>
  );
}
