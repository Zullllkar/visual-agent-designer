"use client";

import type { MouseEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings } from "lucide-react";
import { VadMark } from "@/components/brand/vad-mark";
import { desktopTitleForPath, parseProjectIdFromPath } from "@/lib/desktop/project-path";
import { openSettings } from "@/lib/settings/events";
import { getTargetRecipe, resolveTargetId } from "@/lib/targets/resolve";
import { useProjectStore } from "@/store/project-store";
import type { VadDesktopMenuId } from "@/types/vad-desktop";

const MENUS: Array<{ id: VadDesktopMenuId; label: string }> = [
  { id: "file", label: "文件" },
  { id: "edit", label: "编辑" },
  { id: "view", label: "查看" },
  { id: "help", label: "帮助" },
];

export function DesktopTitlebar() {
  const pathname = usePathname() ?? "/";
  const projectId = parseProjectIdFromPath(pathname);
  const project = useProjectStore((s) =>
    projectId ? (s.projects[projectId] ?? null) : null
  );
  const fallback = desktopTitleForPath(pathname);
  const title = project?.title?.trim() || fallback;
  const targetLabel = project?.targetId
    ? getTargetRecipe(resolveTargetId(project)).label
    : null;
  const atHome = pathname === "/" || pathname === "/projects" || pathname.startsWith("/projects/new");

  function popup(id: VadDesktopMenuId, event: MouseEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    window.vadDesktop?.popupMenu({
      id,
      x: Math.round(rect.left),
      y: Math.round(rect.bottom + 4),
    });
  }

  return (
    <header
      className="desktop-titlebar"
      onDoubleClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("[data-no-drag]")) return;
        window.vadDesktop?.window("maximize");
      }}
    >
      <div className="desktop-titlebar-left" data-no-drag>
        <Link href="/" className="desktop-titlebar-logo" title="回到首页">
          <VadMark size={18} />
          <span>Vibeboard</span>
        </Link>
        <nav className="desktop-titlebar-menus" aria-label="应用菜单">
          {MENUS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="desktop-titlebar-menu"
              onClick={(event) => popup(item.id, event)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      <div
        className="desktop-titlebar-center"
        {...(!atHome ? { "data-no-drag": true } : {})}
      >
        {!atHome ? (
          <Link href={projectId ? `/projects/${projectId}` : "/"} className="desktop-titlebar-doc">
            <span className="desktop-titlebar-title">{title}</span>
            {targetLabel ? (
              <span className="desktop-titlebar-target">{targetLabel}</span>
            ) : null}
          </Link>
        ) : null}
      </div>

      <div className="desktop-titlebar-actions" data-no-drag>
        <button
          type="button"
          className="desktop-titlebar-icon"
          aria-label="打开设置"
          onClick={() => openSettings()}
        >
          <Settings className="size-3.5" />
        </button>
      </div>
    </header>
  );
}
