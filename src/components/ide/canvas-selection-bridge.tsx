"use client";

/**
 * 将 tldraw 选中同步到 canvas-selection-store（作品板）
 */

import { useEffect, useRef } from "react";
import { useEditor, useValue } from "tldraw";
import { useCanvasSelectionStore } from "@/store/canvas-selection-store";
import { useProjectStore } from "@/store/project-store";
import {
  CANVAS_SELECTION_DISMISS_EVENT,
  shouldDismissCanvasSelection,
} from "@/lib/canvas/dismiss-canvas-selection";
import { SETTINGS_OPEN_EVENT } from "@/lib/settings/events";

export function CanvasSelectionBridge({
  projectId,
}: {
  projectId: string | undefined;
}) {
  const editor = useEditor();
  const selectedIds = useValue(
    "selected shape ids",
    () => editor.getSelectedShapeIds(),
    [editor]
  );

  const suppressSelectionRef = useRef(false);

  useEffect(() => {
    if (suppressSelectionRef.current) {
      useCanvasSelectionStore.getState().clear();
      if (selectedIds.length === 0) suppressSelectionRef.current = false;
      return;
    }

    if (!projectId) {
      useCanvasSelectionStore.getState().clear();
      return;
    }

    const project = useProjectStore.getState().projects[projectId];
    if (!project) {
      useCanvasSelectionStore.getState().clear();
      return;
    }

    const selected = selectedIds
      .map((id) => editor.getShape(id))
      .filter(Boolean);

    const imageShapes = selected.filter(
      (s) => s && (s.type as string) === "image-asset"
    );

    if (imageShapes.length === 1) {
      const shape = imageShapes[0]!;
      const props = (shape as unknown as { props: { assetId: string } }).props;
      const asset = project.assets?.find((a) => a.id === props.assetId);
      useCanvasSelectionStore.getState().set({
        projectId,
        kind: "asset",
        pageId: asset?.usedInPages?.[0] ?? "",
        pageName: (asset?.prompt ?? "生图").slice(0, 48),
        assetId: props.assetId,
        assetIds: [props.assetId],
      });
      return;
    }

    if (imageShapes.length > 1) {
      const assetIds = imageShapes.map(
        (s) =>
          (s as unknown as { props: { assetId: string } }).props.assetId
      );
      useCanvasSelectionStore.getState().set({
        projectId,
        kind: "asset",
        pageId: "",
        pageName: `${assetIds.length} 张作品`,
        assetId: assetIds[0],
        assetIds,
      });
      return;
    }

    useCanvasSelectionStore.getState().clear();
  }, [editor, projectId, selectedIds]);

  useEffect(() => {
    function dismissAll() {
      suppressSelectionRef.current = true;
      editor.selectNone();
      useCanvasSelectionStore.getState().clear();
    }
    function onPointerDown(event: PointerEvent) {
      if (shouldDismissCanvasSelection(event.target)) dismissAll();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (document.querySelector(".vad-settings-overlay, .app-dialog-overlay")) {
        return;
      }
      dismissAll();
    }
    function onDismissEvent() {
      editor.selectNone();
    }
    window.addEventListener(SETTINGS_OPEN_EVENT, dismissAll);
    window.addEventListener(CANVAS_SELECTION_DISMISS_EVENT, onDismissEvent);
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(SETTINGS_OPEN_EVENT, dismissAll);
      window.removeEventListener(CANVAS_SELECTION_DISMISS_EVENT, onDismissEvent);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [editor]);

  return null;
}
