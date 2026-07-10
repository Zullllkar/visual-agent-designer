"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, FileJson, Package } from "lucide-react";
import { useProjectStore } from "@/store/project-store";
import { useProjectStoreHydrated } from "@/lib/use-hydrated";
import { CanvasSvg } from "@/lib/canvas/svg-renderer";
import { HandoffDialog } from "@/components/handoff-dialog";

const AGENTS = [
  { name: "Brief Agent", state: "done" },
  { name: "Product Architect", state: "pending" },
  { name: "Design Director", state: "pending" },
  { name: "Layout Agent", state: "done" },
  { name: "Content Agent", state: "pending" },
  { name: "Prompt Agent", state: "pending" },
  { name: "Image Agent", state: "done" },
  { name: "Vision Critic", state: "done" },
  { name: "Handoff Agent", state: "pending" },
] as const;

export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const hydrated = useProjectStoreHydrated();
  const project = useProjectStore((s) => s.projects[projectId]);
  const [activePage, setActivePage] = useState(0);
  const [handoffOpen, setHandoffOpen] = useState(false);

  if (!hydrated) {
    return (
      <main className="app-shell grid flex-1 place-items-center text-sm app-subtle">
        加载本地项目中…
      </main>
    );
  }

  if (!project) {
    return (
      <main className="app-shell flex flex-1 flex-col items-center justify-center gap-4 px-8 py-16 text-center">
        <p className="text-base app-strong">
          找不到项目{" "}
          <code className="rounded bg-[var(--surface-muted)] px-1 font-mono text-sm">
            {projectId}
          </code>
        </p>
        <Link
          href="/projects"
          className="text-sm app-subtle underline hover:text-[var(--foreground)]"
        >
          回到项目列表
        </Link>
      </main>
    );
  }

  const page = project.pages[activePage] ?? project.pages[0];

  function exportProjectJson() {
    if (!project) return;
    const blob = new Blob([JSON.stringify(project, null, 2)], {
      type: "application/json",
    });
    triggerDownload(blob, `${project.slug || project.id}.project.json`);
  }

  function exportPageJson() {
    if (!page) return;
    const blob = new Blob([JSON.stringify(page, null, 2)], {
      type: "application/json",
    });
    triggerDownload(blob, `${project.slug || project.id}-${page.id}.canvas.json`);
  }

  return (
    <main className="app-shell flex flex-1 flex-col">
      <header className="border-b app-border app-surface px-6 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link
              href="/projects"
              className="inline-flex items-center gap-1 text-xs app-subtle hover:text-[var(--foreground)]"
            >
              <ArrowLeft className="size-3" />
              项目列表
            </Link>
            <div className="h-4 w-px bg-[var(--border)]" />
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold">{project.title}</span>
              <span className="text-[10px] app-subtle">
                {project.brief?.platform} · {project.brief?.visualStyle}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={exportPageJson}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border app-border app-surface px-3 text-xs font-medium transition hover:bg-[var(--surface-muted)]"
            >
              <FileJson className="size-3.5" />
              当前页 JSON
            </button>
            <button
              type="button"
              onClick={exportProjectJson}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border app-border app-surface px-3 text-xs font-medium transition hover:bg-[var(--surface-muted)]"
            >
              <Download className="size-3.5" />
              项目 JSON
            </button>
            <button
              type="button"
              onClick={() => setHandoffOpen(true)}
              className="app-primary inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium"
            >
              <Package className="size-3.5" />
              导出 Handoff 包
            </button>
          </div>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-[260px_1fr_320px] divide-x divide-[var(--border)] overflow-hidden">
        <aside className="app-surface overflow-y-auto p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider app-subtle">
            Agent 工作流
          </h2>
          <ol className="mt-3 space-y-1.5 text-sm">
            {AGENTS.map((a, i) => (
              <li
                key={a.name}
                className="flex items-center gap-2 rounded-md px-2 py-1.5"
              >
                <span
                  className={
                    "grid size-5 place-items-center rounded-full text-[10px] font-medium " +
                    (a.state === "done"
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                      : "bg-[var(--surface-muted)] app-subtle")
                  }
                >
                  {a.state === "done" ? "✓" : i + 1}
                </span>
                <span
                  className={
                    a.state === "done"
                      ? "font-medium text-[var(--foreground)]"
                      : "app-subtle"
                  }
                >
                  {a.name}
                </span>
              </li>
            ))}
          </ol>

          <h2 className="mt-6 text-xs font-semibold uppercase tracking-wider app-subtle">
            页面
          </h2>
          <ul className="mt-3 space-y-1 text-sm">
            {project.pages.map((p, i) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setActivePage(i)}
                  className={
                    "w-full rounded-md px-2 py-1.5 text-left transition-colors " +
                    (i === activePage
                      ? "bg-[var(--primary)] font-medium text-[var(--vad-accent-fg-on)]"
                      : "hover:bg-[var(--surface-muted)] app-subtle hover:text-[var(--foreground)]")
                  }
                >
                  {p.name}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="app-muted-surface grid place-items-center overflow-auto p-8">
          {page ? (
            <div className="app-card rounded-2xl shadow-xl ring-1 ring-[var(--border)]">
              <CanvasSvg page={page} />
            </div>
          ) : (
            <p className="text-sm app-subtle">这个项目还没有页面。</p>
          )}
        </section>

        <aside className="app-surface overflow-y-auto p-4">
          {handoffOpen && project ? (
            <HandoffDialog project={project} onClose={() => setHandoffOpen(false)} />
          ) : null}
          <h2 className="text-xs font-semibold uppercase tracking-wider app-subtle">
            Brief
          </h2>
          {project.brief ? (
            <dl className="mt-3 space-y-3 text-sm">
              <Row k="产品名" v={project.brief.productName} />
              <Row k="定位" v={project.brief.positioning} />
              <Row k="目标用户" v={project.brief.targetUser} />
              <Row k="平台" v={project.brief.platform} />
              <Row k="视觉" v={project.brief.visualStyle} />
              <div>
                <dt className="text-xs app-subtle">核心功能</dt>
                <dd className="mt-1 flex flex-wrap gap-1">
                  {project.brief.coreFeatures.map((f) => (
                    <span
                      key={f}
                      className="rounded-full bg-[var(--primary-soft)] px-2 py-0.5 text-[11px] text-[var(--primary)]"
                    >
                      {f}
                    </span>
                  ))}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="mt-3 text-sm app-subtle">无 Brief。</p>
          )}

          <h2 className="mt-6 text-xs font-semibold uppercase tracking-wider app-subtle">
            原始想法
          </h2>
          <p className="mt-2 rounded-md bg-[var(--surface-muted)] p-3 text-xs leading-relaxed app-subtle">
            {project.rawIdea}
          </p>
        </aside>
      </div>
    </main>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs app-subtle">{k}</dt>
      <dd className="mt-0.5 text-sm">{v}</dd>
    </div>
  );
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
