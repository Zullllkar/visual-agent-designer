"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { FolderOpen, ScrollText } from "lucide-react";
import { parseProjectIdFromPath } from "@/lib/desktop/project-path";
import { openFirstRunSetup } from "@/lib/studio/first-run";
import { getTargetRecipe, resolveTargetId } from "@/lib/targets/resolve";
import {
  isMockImageConfig,
  isMockLlmConfig,
} from "@/lib/providers/validate";
import { useProjectStore } from "@/store/project-store";
import { useProviderStore } from "@/store/provider-store";
import type { VadDesktopInfo } from "@/types/vad-desktop";

export function DesktopStatusbar() {
  const pathname = usePathname() ?? "/";
  const projectId = parseProjectIdFromPath(pathname);
  const project = useProjectStore((s) =>
    projectId ? (s.projects[projectId] ?? null) : null
  );
  const providerConfig = useProviderStore((s) => s.config);
  const [info, setInfo] = useState<VadDesktopInfo | null>(null);
  const modelReady =
    !isMockLlmConfig(providerConfig) && !isMockImageConfig(providerConfig);

  useEffect(() => {
    let cancelled = false;
    void window.vadDesktop?.getInfo().then((value) => {
      if (!cancelled) setInfo(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const targetLabel = project?.targetId
    ? getTargetRecipe(resolveTargetId(project)).label
    : null;
  const port = info?.port ?? (typeof window !== "undefined" ? window.location.port : "");
  const folder = info?.vadRoot ? shortPath(info.vadRoot) : "本地项目";

  return (
    <footer className="desktop-statusbar">
      <button
        type="button"
        className="desktop-statusbar-item"
        onClick={() => window.vadDesktop?.openPath("vadRoot")}
        title={info?.vadRoot ?? "打开项目目录"}
      >
        <span className="desktop-statusbar-dot" aria-hidden />
        <FolderOpen className="size-3" />
        <span>{folder}</span>
        {port ? <span className="desktop-statusbar-dim">{port}</span> : null}
      </button>
      <span className="desktop-statusbar-rule" aria-hidden />
      <span className="desktop-statusbar-item is-static">
        {targetLabel ? `目标 · ${targetLabel}` : project ? "画布" : "首页"}
      </span>
      <span className="desktop-statusbar-rule" aria-hidden />
      {modelReady ? (
        <span className="desktop-statusbar-item is-static">模型就绪</span>
      ) : (
        <button
          type="button"
          className="desktop-statusbar-item is-warn"
          onClick={() => openFirstRunSetup()}
        >
          模型未配置
        </button>
      )}
      <span className="desktop-statusbar-spacer" />
      {info?.version ? (
        <span className="desktop-statusbar-item is-static">v{info.version}</span>
      ) : null}
      <button
        type="button"
        className="desktop-statusbar-item"
        onClick={() => window.vadDesktop?.openPath("logs")}
      >
        <ScrollText className="size-3" />
        日志
      </button>
    </footer>
  );
}

function shortPath(path: string): string {
  const parts = path.replace(/[/\\]+$/, "").split(/[/\\]/);
  if (parts.length <= 2) return path;
  return `…/${parts.slice(-2).join("/")}`;
}
