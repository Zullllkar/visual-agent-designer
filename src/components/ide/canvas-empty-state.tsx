"use client";

/**
 * 作品板空态 — 引导去 Composer 描述画面
 */

import { useValue, useEditor } from "tldraw";
import { Sparkles } from "lucide-react";
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
          ["image-asset", "reference-card"].includes(s.type as string)
        ),
    [editor]
  );

  if (hasArtwork) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[5] grid place-items-center px-6">
      <div className="pointer-events-auto flex max-w-xs flex-col items-center text-center">
        <p className="text-[22px] font-semibold tracking-[-0.03em] text-[var(--foreground)]">
          {title}
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">
          {hint}
        </p>
        <button
          type="button"
          onClick={() => requestComposerFocus()}
          className="vad-canvas-empty-cta mt-5 inline-flex items-center gap-2 px-3.5 py-2 text-[12px] font-semibold tracking-[-0.01em] transition-[filter]"
        >
          <Sparkles className="size-3.5" aria-hidden />
          开始描述
        </button>
      </div>
    </div>
  );
}
