"use client";

/**
 * IDE CanvasPane（B1 + B2 + B4）
 * --------------------------------------------------------------
 * 中间的无限画布，基于 tldraw 5.x。
 *
 * 加载策略：
 *   - tldraw 是纯 client（用 DOM/canvas），不能 SSR
 *   - 通过 next/dynamic + ssr:false 异步加载
 *   - 这一层只负责"挂载 Tldraw + 同步 project.pages"，
 *     真正的 shape util 写在 ./canvas-page-shape.tsx
 *
 * 同步策略（Lovart 式排版）：
 *   - 生图/参考图：主视觉网格落在画布中心区域
 *   - 结构稿页面：缩略图排在主网格下方，供点选编辑与 Handoff
 *   - 用户拖拽后的 x/y 由 canvasSnapshot 保留
 */

import { useMemo } from "react";
import dynamic from "next/dynamic";
import type { ProjectFile } from "@/lib/project/schema";
import "tldraw/tldraw.css";

const TldrawCanvas = dynamic(
  () => import("./tldraw-canvas").then((m) => m.TldrawCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-full place-items-center bg-[var(--background)] text-xs text-[var(--muted)]">
        <span className="animate-pulse font-medium tracking-wide">正在加载画布…</span>
      </div>
    ),
  }
);

interface CanvasPaneProps {
  project: ProjectFile | null;
  activePageId?: string;
  /** AI 快捷动作：填入右侧助理输入框 */
  onPrompt?: (prompt: string) => void;
  /** 直接发起 Agent 任务（变体网格 / 画布内联输入） */
  onRunPrompt?: (prompt: string) => void;
  onExportPage?: () => void;
  onOpenHandoff?: () => void;
}

export function CanvasPane({
  project,
  activePageId,
  onPrompt,
  onRunPrompt,
  onExportPage,
  onOpenHandoff,
}: CanvasPaneProps) {
  const versionKey = useMemo(
    () => `${project?.id ?? "empty"}`,
    [project?.id]
  );
  const syncRevision = useMemo(() => {
    const assets = project?.assets ?? [];
    const refs = project?.references ?? [];
    const notes = project?.canvasNotes ?? [];
    // 故意不含 updatedAt / canvasSnapshot：仅 snapshot 落盘时不应触发全量 sync
    const assetSig = assets
      .map((a) => `${a.id}:${a.status ?? ""}:${a.src ? "1" : "0"}`)
      .join("|");
    const refSig = refs.map((r) => r.id).join("|");
    const noteSig = notes.map((n) => n.id).join("|");
    return `${project?.id ?? ""}:${assets.length}:${refs.length}:${notes.length}:${project?.pages?.length ?? 0}:${assetSig}:${refSig}:${noteSig}`;
  }, [
    project?.id,
    project?.assets,
    project?.references,
    project?.canvasNotes,
    project?.pages?.length,
  ]);

  return (
    <div className="relative h-full w-full">
      <TldrawCanvas
        key={versionKey}
        project={project}
        activePageId={activePageId}
        syncRevision={syncRevision}
        onPrompt={onPrompt}
        onRunPrompt={onRunPrompt}
        onExportPage={onExportPage}
        onOpenHandoff={onOpenHandoff}
      />
      {/* 防 tldraw 全屏鼠标事件穿透到外层；同时给容器一个明确的尺寸 */}
    </div>
  );
}
