"use client";

/**
 * 订阅 canvas-ui-store 的聚焦请求，在 tldraw 内选中并缩放到对应 shape
 * @author：wangjunhua
 */

import { useEffect } from "react";
import { useEditor } from "tldraw";
import { useCanvasUiStore } from "@/store/canvas-ui-store";

export function CanvasFocusListener() {
  const editor = useEditor();
  const focusToken = useCanvasUiStore((s) => s.focusToken);
  const focusTarget = useCanvasUiStore((s) => s.focusTarget);

  useEffect(() => {
    if (!focusTarget || focusToken === 0) return;
    // 作品板只聚焦 image-asset（canvas-page 已废弃）
    if (focusTarget.kind !== "asset") return;

    const hit = editor.getCurrentPageShapes().find((s) => {
      if ((s.type as string) !== "image-asset") return false;
      const props = (s as unknown as { props: { assetId: string } }).props;
      return props.assetId === focusTarget.id;
    });

    if (!hit) return;

    editor.select(hit.id);
    editor.zoomToSelection({ animation: { duration: 280 } });
  }, [editor, focusToken, focusTarget]);

  return null;
}
