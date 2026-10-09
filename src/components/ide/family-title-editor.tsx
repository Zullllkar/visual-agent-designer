"use client";

/**
 * 组合页名输入。由家族底板顶栏渲染（底板 HTML 在图之上，仅顶栏可点）。
 */

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useEditor } from "tldraw";
import {
  applyFamilyTitle,
  resolveFamilyBoardTitle,
} from "@/lib/canvas/family-board-title";
import { usePreferences } from "@/lib/preferences";
import { useProjectStore } from "@/store/project-store";

export function FamilyTitleEditor({
  rootAssetId,
  projectId,
  derivedCount,
  boardShapeId,
  boardLabel,
}: {
  rootAssetId: string;
  projectId: string;
  derivedCount: number;
  boardShapeId: string;
  boardLabel: string;
}) {
  const editor = useEditor();
  const { t } = usePreferences();
  const upsert = useProjectStore((s) => s.upsert);
  const familyTitle = useProjectStore((s) => {
    const asset = s.projects[projectId]?.assets?.find(
      (item) => item.id === rootAssetId
    );
    return asset?.familyTitle ?? "";
  });
  const resolved = resolveFamilyBoardTitle({
    familyTitle,
    currentLabel: boardLabel,
    pageName: "",
  });
  const focused = useRef(false);
  const [draft, setDraft] = useState(resolved);

  useEffect(() => {
    if (!focused.current) setDraft(resolved);
  }, [resolved]);

  const persistTitle = (value: string) => {
    const next = value.trim();
    const project = useProjectStore.getState().projects[projectId];
    if (project?.assets) {
      upsert({
        ...project,
        assets: applyFamilyTitle(project.assets, rootAssetId, next),
        updatedAt: new Date().toISOString(),
      });
    }
    if (editor.getShape(boardShapeId as never)) {
      editor.updateShapes([
        {
          id: boardShapeId as never,
          type: "family-board" as any,
          props: { label: next },
        },
      ]);
    }
  };

  const blockCanvas = (event: React.SyntheticEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  return (
    <div
      className="vad-family-board-head"
      onPointerDown={blockCanvas}
      onDoubleClick={blockCanvas}
    >
      <span className="vad-family-board-mark" aria-hidden />
      <input
        className="vad-family-title-input"
        value={draft}
        placeholder={t("canvas.family.placeholder")}
        aria-label={t("canvas.family.placeholder")}
        onPointerDown={(event) => event.stopPropagation()}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
          persistTitle(draft);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            (event.target as HTMLInputElement).blur();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setDraft(resolved);
            (event.target as HTMLInputElement).blur();
          }
        }}
      />
      {derivedCount > 0 ? (
        <span className="vad-family-board-meta">
          {derivedCount} {t("canvas.family.derived")}
        </span>
      ) : null}
    </div>
  );
}

export function countFamilyDescendants(
  assets: Array<{ parentAssetId?: string; status?: string }>,
  rootAssetId: string
): number {
  return assets.filter((asset) => {
    if (asset.parentAssetId !== rootAssetId) return false;
    const status = asset.status ?? "candidate";
    return (
      status !== "discarded" && status !== "failed" && status !== "cancelled"
    );
  }).length;
}
