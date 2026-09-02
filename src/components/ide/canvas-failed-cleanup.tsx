"use client";

/**
 * 作品板失败/取消占位一键清理
 */

import { useMemo } from "react";
import { Eraser } from "lucide-react";
import { useEditor } from "tldraw";
import { useProjectStore } from "@/store/project-store";
import { discardAssetsInProject } from "@/lib/project/discard-assets";
import { useCanvasSelectionStore } from "@/store/canvas-selection-store";
import type { ImageAsset } from "@/lib/project/assets-schema";

const EMPTY_ASSETS: ImageAsset[] = [];

export function CanvasFailedCleanup({ projectId }: { projectId?: string }) {
  const editor = useEditor();
  const upsert = useProjectStore((s) => s.upsert);
  const rawAssets = useProjectStore((s) => {
    if (!projectId) return EMPTY_ASSETS;
    return s.projects[projectId]?.assets ?? EMPTY_ASSETS;
  });

  const failedIds = useMemo(
    () =>
      rawAssets
        .filter((a) => a.status === "failed" || a.status === "cancelled")
        .map((a) => a.id),
    [rawAssets]
  );

  if (!projectId || failedIds.length === 0) return null;

  function clearFailed() {
    if (!projectId) return;
    const pid = projectId;
    const ids = failedIds;
    const project = useProjectStore.getState().projects[pid];
    if (!project) return;
    upsert(discardAssetsInProject(project, ids));
    const shapes = editor.getCurrentPageShapes().filter((s) => {
      if ((s.type as string) !== "image-asset") return false;
      const id = (s as unknown as { props: { assetId: string } }).props.assetId;
      return ids.includes(id);
    });
    if (shapes.length > 0) {
      editor.deleteShapes(shapes.map((s) => s.id));
    }
    useCanvasSelectionStore.getState().clear();
    editor.selectNone();
  }

  return (
    <button
      type="button"
      onClick={clearFailed}
      className="vad-canvas-cleanup pointer-events-auto absolute left-4 top-4 z-10 inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium tracking-[-0.01em] transition-colors"
      title="移除失败与已取消的占位图"
    >
      <Eraser className="size-3.5" aria-hidden />
      清理 {failedIds.length} 张失败
    </button>
  );
}
