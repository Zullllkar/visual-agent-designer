"use client";

import { MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { VadMark } from "@/components/brand/vad-mark";
import { useDesktopRuntime } from "@/lib/desktop/use-desktop-runtime";
import { formatRelativeTime, projectCoverSrc } from "@/lib/project/cover";
import type { ProjectFile } from "@/lib/project/schema";
import { formatLibraryDate } from "@/lib/studio/home-projects";
import {
  deleteStudioProject,
  duplicateStudioProject,
  renameStudioProject,
  revealStudioProject,
} from "@/lib/studio/library";
import { exportProjectJsonFile } from "@/lib/studio/native-file";
import { getTargetRecipe, parseTargetId } from "@/lib/targets/resolve";

function targetLabel(id?: string): string {
  return getTargetRecipe(parseTargetId(id)).label;
}

function fallbackTone(id: string): "clay" | "olive" | "ink" {
  const sum = [...id].reduce((total, char) => total + char.charCodeAt(0), 0);
  return (["clay", "olive", "ink"] as const)[sum % 3];
}

export function StudioProjectCard({
  project,
  variant = "default",
  subtitle,
}: {
  project: ProjectFile;
  variant?: "default" | "library";
  subtitle?: string;
}) {
  const desktop = useDesktopRuntime();
  const cover = projectCoverSrc(project);
  const library = variant === "library";
  const assetCount = (project.assets ?? []).filter((asset) => asset.status !== "discarded").length;
  const kind = targetLabel(project.targetId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mode, setMode] = useState<"idle" | "rename" | "delete">("idle");
  const [draft, setDraft] = useState(project.title);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  async function confirmRename() {
    setBusy(true);
    const ok = await renameStudioProject(project.id, draft);
    setBusy(false);
    if (ok) setMode("idle");
  }

  async function confirmDelete() {
    setBusy(true);
    const ok = await deleteStudioProject(project.id);
    setBusy(false);
    if (ok) setMode("idle");
  }

  return (
    <article className="studio-card">
      <Link href={`/projects/${project.id}`} className="studio-card-hit">
        <div className="studio-card-media">
          <div className="studio-card-frame">
            {cover ? (
              <img src={cover} alt="" />
            ) : (
              <div className={`studio-card-fallback is-${fallbackTone(project.id)}`}>
                <span className="studio-card-fallback-board" aria-hidden />
                <VadMark size={22} />
              </div>
            )}
          </div>
        </div>
        <div className="studio-card-body">
          <h3>{project.title}</h3>
          <div className="studio-card-meta">
            <span className="studio-card-kind">{subtitle ?? kind}</span>
            <small>
              {library
                ? formatLibraryDate(project.updatedAt)
                : `${assetCount} 素材 · ${formatRelativeTime(project.updatedAt)}`}
            </small>
          </div>
        </div>
      </Link>

      <div className="studio-card-tools" ref={menuRef}>
        <button
          type="button"
          className="studio-card-more"
          aria-label="项目操作"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <MoreHorizontal className="size-4" />
        </button>
        {menuOpen ? (
          <div className="studio-card-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setDraft(project.title);
                setMode("rename");
                setMenuOpen(false);
              }}
            >
              重命名
             </button>
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void duplicateStudioProject(project.id).finally(() => {
                  setBusy(false);
                  setMenuOpen(false);
                });
              }}
            >
              复制一份
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                void exportProjectJsonFile(project);
                setMenuOpen(false);
              }}
            >
              导出 JSON
            </button>
            {desktop ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  revealStudioProject(project.id);
                  setMenuOpen(false);
                }}
              >
                打开文件夹
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              className="is-danger"
              onClick={() => {
                setMode("delete");
                setMenuOpen(false);
              }}
            >
              删除
            </button>
          </div>
        ) : null}
      </div>

      {mode === "rename" ? (
        <div className="studio-card-dialog">
          <strong>重命名项目</strong>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void confirmRename();
              if (event.key === "Escape") setMode("idle");
            }}
          />
          <div className="studio-card-dialog-actions">
            <button type="button" onClick={() => setMode("idle")}>
              取消
            </button>
            <button type="button" disabled={busy} onClick={() => void confirmRename()}>
              保存
            </button>
          </div>
        </div>
      ) : null}

      {mode === "delete" ? (
        <div className="studio-card-dialog">
          <strong>删除「{project.title}」？</strong>
          <p>本机文件夹和浏览器缓存都会删掉，不能恢复。</p>
          <div className="studio-card-dialog-actions">
            <button type="button" onClick={() => setMode("idle")}>
              取消
            </button>
            <button
              type="button"
              className="is-danger"
              disabled={busy}
              onClick={() => void confirmDelete()}
            >
              删除
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
