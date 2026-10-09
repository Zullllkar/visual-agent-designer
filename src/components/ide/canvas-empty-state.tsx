"use client";

/**
 * 作品板空态 — 引导去 Composer 描述画面
 */

import { Sparkles } from "lucide-react";
import { useEditor, useValue } from "tldraw";
import { useCanvasUiStore } from "@/store/canvas-ui-store";

export function CanvasEmptyState({
  title = "作品板",
  hint = "在右侧描述画面，生成结果会落在这里",
}: {
  title?: string;
  hint?: string;
}) {
  const editor = useEditor();
  const requestComposerFocus = useCanvasUiStore((s) => s.requestComposerFocus);

  const hasArtwork = useValue(
    "canvas has artwork",
    () =>
      editor
        .getCurrentPageShapes()
        .some((s) =>
          ["image-asset", "reference-card", "text-note"].includes(
            s.type as string
          )
        ),
    [editor],
  );

  if (hasArtwork) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[5] grid place-items-center px-6">
      <div className="vad-canvas-empty pointer-events-auto">
        <div className="vad-canvas-empty-frame" aria-hidden>
          <span className="vad-canvas-empty-tile is-a" />
          <span className="vad-canvas-empty-tile is-b" />
          <span className="vad-canvas-empty-tile is-c" />
        </div>
        <p className="vad-canvas-empty-title">{title}</p>
        <p className="vad-canvas-empty-hint">{hint}</p>
        <button
          type="button"
          onClick={() => requestComposerFocus()}
          className="vad-canvas-empty-cta"
        >
          <Sparkles className="size-3.5" aria-hidden />
          开始描述
        </button>
      </div>
    </div>
  );
}
