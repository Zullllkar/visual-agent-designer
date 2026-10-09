"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  FolderOpen,
  LayoutGrid,
  PanelLeft,
  PenLine,
  Puzzle,
} from "lucide-react";
import { VadMark } from "@/components/brand/vad-mark";
import { BriefLauncher } from "@/components/brief-launcher";
import { formatRelativeTime, projectCoverSrc } from "@/lib/project/cover";
import {
  isMockImageConfig,
  isMockLlmConfig,
} from "@/lib/providers/validate";
import { openSettings } from "@/lib/settings/events";
import { getTargetRecipe, isTargetId } from "@/lib/targets/catalog";
import { useStudioRail } from "@/lib/studio/rail";
import { importStudioProject } from "@/lib/studio/library";
import { useProjectStoreHydrated } from "@/lib/use-hydrated";
import { useProjectStore } from "@/store/project-store";
import { useProviderStore } from "@/store/provider-store";
import type { ProjectFile } from "@/lib/project/schema";
import { StudioProjectCard } from "@/components/studio/studio-project-card";
import "./studio-home.css";

function targetLabel(id?: string): string {
  if (isTargetId(id)) return getTargetRecipe(id).label;
  return "画布";
}

function focusPrompt() {
  const input = document.getElementById("studio-prompt-input");
  input?.scrollIntoView({ block: "center", behavior: "smooth" });
  if (input instanceof HTMLTextAreaElement) input.focus();
}

export function StudioHome() {
  const router = useRouter();
  const hydrated = useProjectStoreHydrated();
  const importProjectsQuietly = useProjectStore((s) => s.importProjectsQuietly);
  const projectsDict = useProjectStore((s) => s.projects);
  const [rail, persistRail] = useStudioRail();
  const [mobileOpen, setMobileOpen] = useState(false);
  const providerConfig = useProviderStore((s) => s.config);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [panel, setPanel] = useState<"create" | "all">("create");
  const [copied, setCopied] = useState(false);
  const modelReady =
    !isMockLlmConfig(providerConfig) && !isMockImageConfig(providerConfig);

  const projects = useMemo(
    () =>
      Object.values(projectsDict).sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt)
      ),
    [projectsDict]
  );

  useEffect(() => {
    if (!hydrated) return;
    fetch("/api/projects")
      .then(async (res) => {
        const type = res.headers.get("content-type") ?? "";
        if (!res.ok || !type.includes("application/json")) return [];
        const text = await res.text();
        if (!text.trim()) return [];
        return JSON.parse(text);
      })
      .then((data) => {
        if (Array.isArray(data)) importProjectsQuietly(data);
      })
      .catch((err) => {
        console.warn("[studio-home] pull disk projects failed:", err);
      });
  }, [hydrated, importProjectsQuietly]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash === "#gallery") {
      setPanel("all");
      document.getElementById("studio-gallery")?.scrollIntoView();
    }
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      const meta = event.metaKey || event.ctrlKey;
      if (meta && key === "k") {
        event.preventDefault();
        const input = document.getElementById("studio-search");
        if (input instanceof HTMLInputElement) {
          input.focus();
          input.select();
        }
      }
      if (meta && event.key === ",") {
        event.preventDefault();
        openSettings();
      }
      if (event.key === "Escape") setMobileOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const matched = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((project) => {
      const hay = `${project.title} ${project.rawIdea} ${project.slug}`.toLowerCase();
      const textOk = !q || hay.includes(q);
      const filterOk = filter === "all" || project.targetId === filter;
      return textOk && filterOk;
    });
  }, [projects, query, filter]);

  const recents = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects
      .filter((project) => {
        if (!q) return true;
        return `${project.title} ${project.rawIdea}`.toLowerCase().includes(q);
      })
      .slice(0, 8);
  }, [projects, query]);

  const filterIds = useMemo(() => {
    const ids = new Set<string>();
    for (const project of projects) {
      if (project.targetId) ids.add(project.targetId);
    }
    return [...ids];
  }, [projects]);

  const shellClass = [
    "studio-app",
    rail ? "is-rail" : "",
    mobileOpen ? "is-mobile-open" : "",
  ]
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

        <button
          type="button"
          className={"studio-create" + (panel === "create" ? " is-active" : "")}
          data-tip="开始创作"
          onClick={() => {
            setPanel("create");
            setMobileOpen(false);
            focusPrompt();
          }}
        >
          <PenLine className="size-3.5" />
          <span className="studio-create-label">开始创作</span>
        </button>

        <nav className="studio-nav" aria-label="工作室">
          <button
            type="button"
            className={"studio-nav-item" + (panel === "all" ? " is-active" : "")}
            data-tip="全部创作"
            onClick={() => {
              setPanel("all");
              setMobileOpen(false);
              document.getElementById("studio-gallery")?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });
            }}
          >
            <LayoutGrid className="size-4" />
            <span className="studio-nav-text">全部创作</span>
            <span className="studio-nav-count">{projects.length}</span>
          </button>
          <Link
            href="/skills"
            className="studio-nav-item"
            data-tip="Skill 管理"
            onClick={() => setMobileOpen(false)}
          >
            <Puzzle className="size-4" />
            <span className="studio-nav-text">Skill 管理</span>
          </Link>
        </nav>

        <div className="studio-recent">
          <div className="studio-recent-label">最近创作</div>
          <input
            id="studio-search"
            className="studio-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索项目  Ctrl K"
          />
          <ul className="studio-recent-list">
            {!hydrated ? (
              <li className="studio-recent-empty">读取本地项目…</li>
            ) : recents.length === 0 ? (
              <li className="studio-recent-empty">还没有项目</li>
            ) : (
              recents.map((project) => (
                <li key={project.id}>
                  <RecentRow project={project} />
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

      <main className="studio-main">
        <div className="studio-grid" aria-hidden />
        <div className="studio-inner">
          <div className="studio-mobile-bar">
            <button
              type="button"
              className="studio-icon-btn"
              aria-label="打开菜单"
              onClick={() => setMobileOpen(true)}
            >
              <FolderOpen className="size-4" />
            </button>
            <strong>Vibeboard</strong>
          </div>

          <div className="studio-hero">
            <div className="studio-hero-logo">
              <VadMark size={56} />
            </div>
            <p className="studio-kicker">本地优先 · 画布工作台</p>
            <h1>Vibeboard</h1>
            <p>写 Brief，在画布上跑 Agent，把图和上下文交给开发。</p>
          </div>

          <BriefLauncher className="studio-brief" />

          <ol className="studio-steps" aria-label="工作流程">
            <li>
              <em>01</em>
              <strong>写 Brief</strong>
              <span>选目标，描述要画什么</span>
            </li>
            <li>
              <em>02</em>
              <strong>画布生成</strong>
              <span>Agent 在无限画布上出图</span>
            </li>
            <li>
              <em>03</em>
              <strong>导出 Handoff</strong>
              <span>打包 PNG、prompt 和上下文</span>
            </li>
          </ol>

          <div className="studio-gallery-head" id="studio-gallery">
            <div>
              <h2>全部创作</h2>
              <p>{hydrated ? `${projects.length} 个本机项目` : "正在读取…"}</p>
            </div>
            <button
              type="button"
              className="studio-import"
              onClick={() => {
                void importStudioProject().then((project) => {
                  if (project) router.push(`/projects/${project.id}`);
                });
              }}
            >
              导入项目
            </button>
          </div>

          <div className="studio-filters">
            <button
              type="button"
              className={"studio-pill" + (filter === "all" ? " is-active" : "")}
              onClick={() => setFilter("all")}
            >
              全部
            </button>
            {filterIds.map((id) => (
              <button
                key={id}
                type="button"
                className={"studio-pill" + (filter === id ? " is-active" : "")}
                onClick={() => setFilter(id)}
              >
                {targetLabel(id)}
              </button>
            ))}
            <div className="studio-filter-links">
              <a
                href="https://github.com/Zullllkar/vibeboard#readme"
                target="_blank"
                rel="noreferrer"
              >
                使用指南
              </a>
              <a
                href="https://github.com/Zullllkar/vibeboard"
                target="_blank"
                rel="noreferrer"
              >
                GitHub
              </a>
            </div>
          </div>

          {!hydrated ? (
            <div className="studio-empty">正在读取本地项目…</div>
          ) : matched.length === 0 ? (
            <div className="studio-empty">
              <VadMark size={36} />
              <p>
                {projects.length === 0
                  ? "还没有项目。写完 Brief 会在本机建项目并打开画布。"
                  : "没有符合筛选的项目。换一个目标，或清空搜索。"}
              </p>
              <button type="button" onClick={focusPrompt}>
                开始写 Brief
              </button>
            </div>
          ) : (
            <div className="studio-gallery">
              {matched.map((project) => (
                <StudioProjectCard key={project.id} project={project} />
              ))}
            </div>
          )}

          <div className="studio-oss">
            <code>git clone https://github.com/Zullllkar/vibeboard.git</code>
            <button
              type="button"
              className="studio-copy"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    "git clone https://github.com/Zullllkar/vibeboard.git"
                  );
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1600);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? "已复制" : "复制"}
            </button>
            <span>Apache-2.0</span>
            <span>数据留在本机</span>
            <a
              href="https://github.com/Zullllkar/vibeboard/issues"
              target="_blank"
              rel="noreferrer"
            >
              Issues <ArrowUpRight className="size-3" />
            </a>
          </div>
        </div>
      </main>

    </div>
  );
}

function RecentRow({ project }: { project: ProjectFile }) {
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

