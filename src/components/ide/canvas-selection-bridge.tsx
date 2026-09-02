"use client";

/**
 * 将 tldraw 选中同步到 canvas-selection-store（作品板）
 */

import { useEffect } from "react";
import { useEditor, useValue } from "tldraw";
import { useCanvasSelectionStore } from "@/store/canvas-selection-store";
import { useProjectStore } from "@/store/project-store";

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

  useEffect(() => {
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

  return null;
}
