"use client";

/**
 * 作品板底边缩略导航 — 快速跳转到任意生图卡片
 */

import { useMemo } from "react";
import { useEditor, useValue } from "tldraw";
import { useProjectStore } from "@/store/project-store";
import { isCanvasVisibleAsset } from "@/lib/project/asset-visibility";
import { useCanvasUiStore } from "@/store/canvas-ui-store";
import type { ImageAsset } from "@/lib/project/assets-schema";

const EMPTY_ASSETS: ImageAsset[] = [];

export function CanvasArtworkStrip({ projectId }: { projectId?: string }) {
  const editor = useEditor();
  const requestFocusAsset = useCanvasUiStore((s) => s.requestFocusAsset);
  const selectedIds = useValue(
    "strip selection",
    () => editor.getSelectedShapeIds(),
    [editor]
  );

  // 选择器只返回 store 内既有引用，避免每次 filter 新数组触发 getSnapshot 死循环
  const rawAssets = useProjectStore((s) => {
    if (!projectId) return EMPTY_ASSETS;
    return s.projects[projectId]?.assets ?? EMPTY_ASSETS;
  });

  const assets = useMemo(
    () => rawAssets.filter(isCanvasVisibleAsset),
    [rawAssets]
  );

  const selectedAssetId = useMemo(() => {
    for (const id of selectedIds) {
      const shape = editor.getShape(id);
      if (!shape || (shape.type as string) !== "image-asset") continue;
      return (shape as unknown as { props: { assetId: string } }).props.assetId;
    }
    return null;
  }, [editor, selectedIds]);

  if (assets.length < 2) return null;

  return (
    <div className="vad-artwork-strip pointer-events-auto absolute bottom-[4.75rem] left-1/2 z-10 flex max-w-[min(480px,68vw)] -translate-x-1/2 items-center gap-1 overflow-x-auto p-1.5">
      {assets.map((asset, index) => {
        const active = asset.id === selectedAssetId;
        const failed =
          asset.status === "failed" || asset.status === "cancelled";
        const generating = asset.status === "generating";
        return (
          <button
            key={asset.id}
            type="button"
            title={(asset.prompt || `作品 ${index + 1}`).slice(0, 48)}
            aria-label={`聚焦作品 ${index + 1}`}
            aria-current={active ? "true" : undefined}
            onClick={() => requestFocusAsset(asset.id)}
            className={
              "vad-artwork-strip-item relative size-10 shrink-0 overflow-hidden border transition-[border-color,box-shadow] " +
              (active
                ? "vad-artwork-strip-item--active"
                : "border-[var(--border)]")
            }
          >
            {asset.src && !generating ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={asset.src}
                alt=""
                className="size-full object-cover"
                draggable={false}
              />
            ) : (
              <span
                className={
                  "grid size-full place-items-center text-[9px] font-semibold " +
                  (generating
                    ? "vad-shimmer text-[var(--muted)]"
                    : "bg-[var(--surface-muted)] text-[var(--muted)]")
                }
              >
                {generating ? "…" : failed ? "!" : index + 1}
              </span>
            )}
            {failed ? (
              <span className="absolute inset-0 bg-[rgba(15,15,18,0.35)]" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
