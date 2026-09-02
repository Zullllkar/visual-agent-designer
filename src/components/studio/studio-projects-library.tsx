"use client";

import { BookOpen, ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { ProjectLibraryArt } from "@/components/studio/studio-library-art";
import { StudioProjectCard } from "@/components/studio/studio-project-card";
import {
  type LibraryTargetFilter,
  paginateStudioLibrary,
  projectMatchesLibraryTarget,
} from "@/lib/studio/home-projects";
import { importStudioProject } from "@/lib/studio/library";
import { getTargetRecipe, HOME_TARGET_IDS, parseTargetId } from "@/lib/targets/resolve";
import { useProjectStoreHydrated } from "@/lib/use-hydrated";
import { useProjectStore } from "@/store/project-store";
import "./studio-library.css";

function targetLabel(id?: string): string {
  return getTargetRecipe(parseTargetId(id)).label;
}

function visibleLibraryPages(page: number, pageCount: number): number[] {
  const width = Math.min(5, pageCount);
  const start = Math.max(1, Math.min(page - Math.floor((width - 1) / 2), pageCount - width + 1));
  return Array.from({ length: width }, (_, index) => start + index);
}

export function StudioProjectsLibrary() {
  const router = useRouter();
  const hydrated = useProjectStoreHydrated();
  const projectsDict = useProjectStore((state) => state.projects);
  const [query, setQuery] = useState("");
  const [targetFilter, setTargetFilter] = useState<LibraryTargetFilter>("all");
  const [sort, setSort] = useState<"updated" | "title">("updated");
  const [page, setPage] = useState(1);
  const galleryRef = useRef<HTMLDivElement>(null);

  const projects = useMemo(() => {
    const list = Object.values(projectsDict);
    const needle = query.trim().toLowerCase();
    return list
      .filter((project) => {
        if (!projectMatchesLibraryTarget(project.targetId, targetFilter)) return false;
        if (!needle) return true;
        return `${project.title} ${project.rawIdea} ${project.slug}`.toLowerCase().includes(needle);
      })
      .sort((a, b) =>
        sort === "title"
          ? a.title.localeCompare(b.title, "zh-CN")
          : b.updatedAt.localeCompare(a.updatedAt),
      );
  }, [projectsDict, query, sort, targetFilter]);

  const paged = useMemo(() => paginateStudioLibrary(projects, page), [projects, page]);
  const filteredEmpty = Boolean(query.trim() || targetFilter !== "all");
  const filterLabel = targetFilter === "all" ? "全部" : getTargetRecipe(targetFilter).label;

  function goToPage(next: number) {
    setPage(next);
    requestAnimationFrame(() => {
      galleryRef.current?.scrollIntoView({ block: "start" });
    });
  }

  return (
    <div className="studio-library">
      <header className="studio-library-hero">
        <div>
          <h1>项目库</h1>
          <p>整理创作页面、管理项目资产，集中呈现项目内容</p>
          <div className="studio-library-actions">
            <Link href="/#create" className="studio-library-btn is-primary">
              <Plus className="size-3.5" />
              新建项目
            </Link>
            <a
              href="https://github.com/Zullllkar/vibeboard#readme"
              target="_blank"
              rel="noreferrer"
              className="studio-library-btn"
            >
              <BookOpen className="size-3.5" />
              查看教程
            </a>
          </div>
        </div>
        <ProjectLibraryArt />
      </header>

      <div className="studio-library-toolbar">
        <fieldset className="studio-library-kinds" aria-label="画布目标">
          <button
            type="button"
            className={targetFilter === "all" ? "is-active" : ""}
            onClick={() => {
              setTargetFilter("all");
              setPage(1);
            }}
          >
            全部
          </button>
          {HOME_TARGET_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className={targetFilter === id ? "is-active" : ""}
              onClick={() => {
                setTargetFilter(id);
                setPage(1);
              }}
            >
              {getTargetRecipe(id).label}
            </button>
          ))}
        </fieldset>

        <div className="studio-library-toolbar-end">
          <label className="studio-library-search">
            <Search className="size-3.5" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="搜索项目"
              aria-label="搜索项目"
            />
          </label>

          <select
            className="studio-library-sort"
            value={sort}
            aria-label="排序"
            onChange={(event) => {
              setSort(event.target.value as "updated" | "title");
              setPage(1);
            }}
          >
            <option value="updated">最近更新</option>
            <option value="title">按名称</option>
          </select>
        </div>
      </div>

      {!hydrated ? (
        <div className="studio-empty">正在读取本地项目…</div>
      ) : projects.length === 0 ? (
        <div className={`studio-empty${filteredEmpty ? " is-filtered" : ""}`}>
          {filteredEmpty ? (
            <>
              <p>{query.trim() ? "没有找到匹配的项目。" : `「${filterLabel}」里还没有项目。`}</p>
              <div className="studio-library-empty-actions">
                <button
                  type="button"
                  className="studio-library-btn"
                  onClick={() => {
                    setQuery("");
                    setTargetFilter("all");
                    setPage(1);
                  }}
                >
                  查看全部
                </button>
              </div>
            </>
          ) : (
            <>
              <p>还没有本地项目。从首页写 Brief，或导入已有项目 JSON。</p>
              <div className="studio-library-empty-actions">
                <Link href="/#create" className="studio-library-btn is-primary">
                  开始创作
                </Link>
                <button
                  type="button"
                  className="studio-library-btn"
                  onClick={() => {
                    void importStudioProject().then((project) => {
                      if (project) router.push(`/projects/${project.id}`);
                    });
                  }}
                >
                  导入项目
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <>
          <div ref={galleryRef} className="studio-gallery studio-gallery--library">
            {paged.items.map((project) => (
              <StudioProjectCard
                key={project.id}
                project={project}
                variant="library"
                subtitle={targetLabel(project.targetId)}
              />
            ))}
          </div>
          {paged.pageCount > 1 ? (
            <nav className="studio-library-pager" aria-label="项目分页">
              <p>
                {`${paged.total} 个项目 · ${(paged.page - 1) * paged.pageSize + 1}–${Math.min(paged.page * paged.pageSize, paged.total)}`}
              </p>
              <div className="studio-library-pager-nav">
                <button
                  type="button"
                  disabled={paged.page <= 1}
                  aria-label="上一页"
                  onClick={() => goToPage(paged.page - 1)}
                >
                  <ChevronLeft className="size-4" />
                  上一页
                </button>
                {visibleLibraryPages(paged.page, paged.pageCount).map((number) => (
                  <button
                    key={number}
                    type="button"
                    className={number === paged.page ? "is-active" : ""}
                    aria-current={number === paged.page ? "page" : undefined}
                    onClick={() => goToPage(number)}
                  >
                    {number}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={paged.page >= paged.pageCount}
                  aria-label="下一页"
                  onClick={() => goToPage(paged.page + 1)}
                >
                  下一页
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
