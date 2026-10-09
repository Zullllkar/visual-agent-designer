"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FolderOpen, FolderPlus, FolderSearch } from "lucide-react";
import type { ProjectFile } from "@/lib/project/schema";
import { workspaceFolderName } from "@/lib/studio/workspace-name";
import {
  type HomeWorkspace,
  pickAndAttachWorkspace,
  storeHomeWorkspace,
} from "@/lib/studio/workspace-client";
import { useProjectStore } from "@/store/project-store";

export function WorkspacePicker({
  value,
  onChange,
  disabled,
  idea,
}: {
  value: HomeWorkspace | null;
  onChange: (next: HomeWorkspace | null) => void;
  disabled?: boolean;
  idea?: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const projectsDict = useProjectStore((s) => s.projects);
  const recents = useMemo(
    () =>
      Object.values(projectsDict)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 8),
    [projectsDict],
  );

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function pick(mkdirIfMissing: boolean) {
    setError(null);
    try {
      const next = await pickAndAttachWorkspace({ mkdirIfMissing, idea });
      if (!next) return;
      onChange(next);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法打开目录");
    }
  }

  function selectProject(project: ProjectFile) {
    if (project.workspacePath) {
      const next = {
        path: project.workspacePath,
        label: project.title || workspaceFolderName(project.workspacePath),
        projectId: project.id,
      };
      storeHomeWorkspace(next);
      onChange(next);
    } else {
      onChange({
        path: "",
        label: project.title,
        projectId: project.id,
      });
    }
    setOpen(false);
  }

  const label = value?.label || "选择项目";

  return (
    <div className="studio-workspace" ref={rootRef}>
      <button
        type="button"
        className="studio-workspace-trigger"
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <FolderOpen className="size-3.5" aria-hidden />
        <span>{label}</span>
        <em aria-hidden>▾</em>
      </button>
      {open ? (
        <div className="studio-workspace-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => void pick(false)}>
            <FolderSearch className="size-3.5" aria-hidden />
            打开已有目录
          </button>
          <button type="button" role="menuitem" onClick={() => void pick(true)}>
            <FolderPlus className="size-3.5" aria-hidden />
            新建目录
          </button>
          {recents.length > 0 ? (
            <div className="studio-workspace-recents">
              <p>最近项目</p>
              {recents.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  role="menuitem"
                  onClick={() => selectProject(project)}
                >
                  <span>{project.title}</span>
                  <small>
                    {project.workspacePath
                      ? workspaceFolderName(project.workspacePath)
                      : "应用内项目"}
                  </small>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? <p className="studio-workspace-error">{error}</p> : null}
    </div>
  );
}
