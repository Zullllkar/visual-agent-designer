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

    const hit = editor.getCurrentPageShapes().find((s) => {
      if (focusTarget.kind === "note") {
        if ((s.type as string) !== "text-note") return false;
        return (
          (s as unknown as { props: { noteId: string } }).props.noteId ===
          focusTarget.id
        );
      }
      if (focusTarget.kind !== "asset") return false;
      if ((s.type as string) !== "image-asset") return false;
      const props = (s as unknown as { props: { assetId: string } }).props;
      return props.assetId === focusTarget.id;
    });

    if (!hit) return;

    if (focusTarget.kind === "note") {
      const bounds = editor.getShapePageBounds(hit.id);
      if (bounds) {
        editor.zoomToBounds(bounds, { animation: { duration: 280 } });
      }
      return;
    }

    editor.select(hit.id);
    editor.zoomToSelection({ animation: { duration: 280 } });
  }, [editor, focusToken, focusTarget]);

  return null;
}
