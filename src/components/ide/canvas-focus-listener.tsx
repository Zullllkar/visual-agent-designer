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

    const shapes = editor.getCurrentPageShapes();

    const hit =
      focusTarget.kind === "asset"
        ? shapes.find((s) => {
            if ((s.type as string) !== "image-asset") return false;
            const props = (s as unknown as { props: { assetId: string } }).props;
            return props.assetId === focusTarget.id;
          })
        : shapes.find((s) => {
            if ((s.type as string) !== "canvas-page") return false;
            const props = (s as unknown as { props: { pageId: string } }).props;
            return props.pageId === focusTarget.id;
          });

    if (!hit) return;

    editor.select(hit.id);
    editor.zoomToSelection({ animation: { duration: 280 } });
  }, [editor, focusToken, focusTarget]);

  return null;
}
