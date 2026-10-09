"use client";

import "@/lib/canvas/tldraw-indicator-path";

/**
 * TldrawCanvas（client-only 实际加载点）
 * --------------------------------------------------------------
 * 在这一层挂载 <Tldraw />，并用 onMount 拿到 editor 后把 project.pages
 * 同步成 tldraw shape。
 *
 * tldraw 5.x 关键 API：
 *   - <Tldraw shapeUtils={...} onMount={(editor) => ...} />
 *   - BaseBoxShapeUtil<T> 自定义 shape util
 *   - editor.createShapes / deleteShapes / store
 *
 * 同步策略（Lovart 式）：
 *   - 同步 image-asset / reference-card / asset-link（父图→派生素材连线）
 *   - 旧版 canvas-page / flow-arrow / spec / handoff 一律删除
 *   - 按业务 id diff/patch，保留用户手动排布的 x/y
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Tldraw,
  useEditor,
  useValue,
  type Editor,
} from "tldraw";
import {
  ChevronDown,
  Grid2x2,
  Hand,
  Map as MapIcon,
  Minus,
  MousePointer2,
  Pencil,
  Plus,
  Redo2,
  Rows2,
  Spline,
  Type,
  Undo2,
} from "lucide-react";
import { isCanvasGridVisible } from "@/lib/canvas/grid-style";
import { useCanvasUiStore } from "@/store/canvas-ui-store";
import type { CanvasSnapshot, ProjectFile } from "@/lib/project/schema";
import { CanvasPageShapeUtil } from "./canvas-page-shape";
import { ImageAssetShapeUtil, makeImageAssetShape } from "./image-asset-shape";
import {
  ReferenceCardShapeUtil,
  makeReferenceCardShape,
} from "./reference-card-shape";
import { TextNoteShapeUtil, makeTextNoteShape } from "./text-note-shape";
import { CiteSpawnMenu, CitePortOverlay } from "./cite-spawn-menu";
import { FlowArrowShapeUtil } from "./flow-arrow-shape";
import {
  AssetLinkShapeUtil,
  computeAssetLinkLayout,
  linkLabelForAsset,
  makeAssetLinkShape,
} from "./asset-link-shape";
import {
  FamilyBoardShapeUtil,
  familyBoardFromMembers,
  makeFamilyBoardShape,
} from "./family-board-shape";
import {
  familyBoardPageName,
  resolveFamilyBoardTitle,
} from "@/lib/canvas/family-board-title";
import {
  HandoffCardShapeUtil,
  SpecCardShapeUtil,
} from "./deprecated-shape-stubs";
import { CanvasMinimap } from "./canvas-minimap";
import { CanvasFocusListener } from "./canvas-focus-listener";
import { CanvasEmptyState } from "./canvas-empty-state";
import { getTargetRecipe } from "@/lib/targets/catalog";
import { resolveTargetId } from "@/lib/targets/resolve";
import { CanvasSelectionBridge } from "./canvas-selection-bridge";
import { CanvasArtworkStrip } from "./canvas-artwork-strip";
import { CanvasFailedCleanup } from "./canvas-failed-cleanup";
import { CanvasAppearanceMenu } from "./canvas-appearance-menu";
import { SelectionFloatingBar } from "./selection-floating-bar";
import { useCanvasSelectionStore } from "@/store/canvas-selection-store";
import { useCanvasBoardStore } from "@/store/canvas-board-store";
import { useProjectStore } from "@/store/project-store";
import { computeBoardLayout, displaySizeForImageAsset, buildAssetFamilies, PARENT_CHILD_GAP } from "@/lib/canvas/board-layout";
import {
  applyUploadedImageToProject,
  buildUploadedImageAsset,
  isCanvasImageFile,
} from "@/lib/project/canvas-image-upload";
import {
  TEXT_NOTE_DEFAULT_H,
  TEXT_NOTE_DEFAULT_W,
  noteKindLabel,
  persistCanvasNoteLayout,
  placeCitedNode,
  spawnStandaloneNote,
} from "@/lib/canvas/canvas-notes";
import { isCanvasVisibleAsset, isCanvasVisibleReference } from "@/lib/project/asset-visibility";
import { discardAssetsInProject } from "@/lib/project/discard-assets";
import { imageAssetIdsFromRemovedRecords } from "@/lib/canvas/discard-removed-image-shapes";
import {
  ensureShapeUtilIndicatorPath,
  guardEditorIndicatorPath,
} from "@/lib/canvas/tldraw-indicator-path";

interface TldrawCanvasProps {
  project: ProjectFile | null;
  activePageId?: string;
  /** 资产/页面变更代次，驱动画布强制同步 */
  syncRevision?: string;
  /** AI 快捷动作：把预设 prompt 填入右侧助理输入框 */
  onPrompt?: (prompt: string) => void;
  /** 直接发起 Agent 任务 */
  onRunPrompt?: (prompt: string) => void;
  /** 导出当前页 JSON */
  onExportPage?: () => void;
  /** 打开 Handoff 对话框 */
  onOpenHandoff?: () => void;
}

const SHAPE_UTILS = [
  CanvasPageShapeUtil,
  ImageAssetShapeUtil,
  ReferenceCardShapeUtil,
  TextNoteShapeUtil,
  FlowArrowShapeUtil,
  AssetLinkShapeUtil,
  FamilyBoardShapeUtil,
  // 兼容旧 IndexedDB：校验通过后由 sync 删除，不渲染 UI
  SpecCardShapeUtil,
  HandoffCardShapeUtil,
];

for (const Util of SHAPE_UTILS) {
  ensureShapeUtilIndicatorPath(Util);
}

const TLDRAW_COMPONENTS = {
  InFrontOfTheCanvas: CitePortOverlay,
};

export function TldrawCanvas({
  project,
  activePageId: _activePageId,
  syncRevision,
  onPrompt,
  onRunPrompt,
  onExportPage,
  onOpenHandoff,
}: TldrawCanvasProps) {
  // 把最新 project 同步进 ref，让 selection interval 里能读到最新值
  // （onMount 闭包只会捕获 mount 时刻的 project 引用）。
  const projectRef = useRef(project);

  // editor 引用：drop 处理需要从 client 坐标 → page 坐标做 hit-test
  const editorRef = useRef<Editor | null>(null);
  const syncingRef = useRef(false);
  const linkRefreshRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const lastSnapshotJsonRef = useRef<string>("");
  const prevAssetCountRef = useRef(0);
  const lastSyncedRevisionRef = useRef<string | null>(null);
  const resetToken = useCanvasBoardStore((s) => s.resetToken);
  const resetProjectId = useCanvasBoardStore((s) => s.resetProjectId);

  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      guardEditorIndicatorPath(editor);
      restoreCanvasSnapshot(
        editor,
        projectRef.current?.canvasSnapshot,
        projectRef.current
      );
      syncProjectToEditor(editor, projectRef.current, { zoomToFit: true });
      saveCanvasSnapshot(editor, projectRef.current, lastSnapshotJsonRef);

      // 选中同步见 <CanvasSelectionBridge />
      const stopStoreListen = editor.store.listen(
        () => {
          if (syncingRef.current || linkRefreshRef.current) return;
          const liveProject = projectRef.current;
          if (!liveProject) return;
          // 拖拽图片时实时刷新血缘连线几何（不改 project）
          linkRefreshRef.current = true;
          try {
            refreshAssetLinkLayouts(editor);
          } finally {
            linkRefreshRef.current = false;
          }
          if (saveTimerRef.current !== null) {
            window.clearTimeout(saveTimerRef.current);
          }
          saveTimerRef.current = window.setTimeout(() => {
            saveTimerRef.current = null;
            // 用户拖拽/编辑只落盘 snapshot，不要再 sync 回写（否则 project upsert → 反馈环）
            const pid = projectRef.current?.id;
            const latestProject = pid
              ? (useProjectStore.getState().projects[pid] ?? projectRef.current)
              : projectRef.current;
            if (!latestProject) return;
            projectRef.current = latestProject;
            saveCanvasSnapshot(editor, latestProject, lastSnapshotJsonRef);
          }, 600);
        },
        { scope: "document" }
      );

      const stopUserDeleteListen = editor.store.listen(
        (entry) => {
          if (syncingRef.current) return;
          const ids = imageAssetIdsFromRemovedRecords(
            (entry.changes?.removed ?? {}) as Record<
              string,
              {
                typeName?: string;
                type?: string;
                props?: { assetId?: unknown };
              }
            >
          );
          if (ids.length === 0) return;
          const live = projectRef.current;
          if (!live) return;
          const latest =
            useProjectStore.getState().projects[live.id] ?? live;
          const next = discardAssetsInProject(latest, ids);
          if (next === latest) return;
          projectRef.current = next;
          useProjectStore.getState().upsert(next);
        },
        { scope: "document", source: "user" }
      );

      const cleanup = () => {
        if (saveTimerRef.current !== null) {
          window.clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
        saveCanvasSnapshot(editor, projectRef.current, lastSnapshotJsonRef);
        stopStoreListen();
        stopUserDeleteListen();
        useCanvasSelectionStore.getState().clear();
        if (editorRef.current === editor) {
          editorRef.current = null;
        }
      };
      (editor as unknown as { __vadCleanup?: () => void }).__vadCleanup = cleanup;

      editor.disposables.add(() => {
        (editor as unknown as { __vadCleanup?: () => void }).__vadCleanup?.();
      });

      // Strict Mode 双挂载：返回 cleanup，避免叠两套监听 / 残留 shape 源
      return cleanup;
    },
    // 依赖 [] —— 通过 projectRef 拿最新 project；onMount 在 Tldraw 内部
    // 只会被调用一次（mount 时），所以即使 deps 变 handleMount，也不会
    // 触发重新 mount。
    []
  );

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  // 仅当素材/参考/页内容指纹变化时 sync；勿依赖 project 对象引用（snapshot upsert 会换引用）
  useEffect(() => {
    const live =
      (project?.id
        ? useProjectStore.getState().projects[project.id]
        : null) ?? projectRef.current;
    const editor = editorRef.current;
    if (!editor || !live || !syncRevision) return;
    // Strict Mode / 父级重挂载可能用同一指纹再跑 effect；跳过重复全量 sync
    if (lastSyncedRevisionRef.current === syncRevision) {
      // revision 未变时仍清：同 id 残留副本 + from-asset 参考克隆
      const visibleRefIds = new Set(
        (live.references ?? [])
          .filter(isCanvasVisibleReference)
          .map((r) => r.id)
      );
      const orphanRefIds = editor
        .getCurrentPageShapes()
        .filter((s) => {
          if ((s.type as string) !== "reference-card") return false;
          const id = (s as unknown as { props: { referenceId: string } }).props
            .referenceId;
          return !visibleRefIds.has(id);
        })
        .map((s) => s.id);
      const dups = collectDuplicateVadShapeIds(editor.getCurrentPageShapes());
      const toDelete = [...new Set([...orphanRefIds, ...dups])];
      if (toDelete.length > 0) {
        syncingRef.current = true;
        try {
          editor.deleteShapes(toDelete);
        } finally {
          window.setTimeout(() => {
            syncingRef.current = false;
          }, 0);
        }
      }
      return;
    }
    lastSyncedRevisionRef.current = syncRevision;
    projectRef.current = live;
    const assetCount = (live.assets ?? []).filter(isCanvasVisibleAsset).length;
    const prevCount = prevAssetCountRef.current;
    const assetsJustAdded = assetCount > prevCount;
    prevAssetCountRef.current = assetCount;

    syncingRef.current = true;
    try {
      syncProjectToEditor(editor, live, { zoomToFit: false });
      // 镜头主权：仅「空板 → 首张作品」时自动适配，其余不抢镜
      if (assetsJustAdded && prevCount === 0 && assetCount > 0) {
        requestAnimationFrame(() => {
          zoomToBoardPrimary(editor, live);
        });
      }
    } finally {
      window.setTimeout(() => {
        syncingRef.current = false;
      }, 0);
    }
  }, [syncRevision, project?.id]);

  // 切项目时允许重新做一次内容指纹 sync
  useEffect(() => {
    lastSyncedRevisionRef.current = null;
    prevAssetCountRef.current = 0;
  }, [project?.id]);

  useEffect(() => {
    const editor = editorRef.current;
    const proj = projectRef.current;
    if (!editor || !proj || !resetProjectId || resetToken === 0) return;
    if (resetProjectId !== proj.id) return;

    const cleared: ProjectFile = {
      ...proj,
      canvasSnapshot: undefined,
      updatedAt: new Date().toISOString(),
    };
    useProjectStore.getState().upsert(cleared);
    projectRef.current = cleared;
    lastSnapshotJsonRef.current = "";
    syncingRef.current = true;
    try {
      syncProjectToEditor(editor, cleared, {
        zoomToFit: true,
        forceBoardLayout: true,
      });
      saveCanvasSnapshot(editor, cleared, lastSnapshotJsonRef);
    } finally {
      window.setTimeout(() => {
        syncingRef.current = false;
      }, 0);
    }
  }, [resetToken, resetProjectId]);


  // 按 projectId 命名 persistence key；v3 = 不再持久化网页结构框
  const persistenceKey = project
    ? `vad-canvas-v3-${project.id}`
    : "vad-canvas-v3-empty";

  // ── 本地图片拖入画布：落成可引用的 image-asset（捕获阶段抢在 tldraw 之前）
  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const hasVadAsset = e.dataTransfer.types.includes("application/x-vad-asset");
    const hasFile = Array.from(e.dataTransfer.items).some(
      (item) => item.kind === "file"
    );
    if (hasVadAsset || hasFile) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    const editor = editorRef.current;
    const proj = projectRef.current;
    if (!editor || !proj) return;

    // client → tldraw page 坐标
    const rect = e.currentTarget.getBoundingClientRect();
    const screenPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const pagePoint = editor.screenToPage(screenPoint);

    const imageFiles = Array.from(e.dataTransfer.files).filter((file) =>
      isCanvasImageFile(file)
    );
    if (imageFiles.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      const latest =
        useProjectStore.getState().projects[proj.id] ?? proj;
      let nextProject = latest;
      let cursorX = pagePoint.x;
      let lastShapeId: ReturnType<typeof makeImageAssetShape>["id"] | undefined;
      for (const imageFile of imageFiles) {
        const src = await readFileAsDataUrl(imageFile);
        const size = await readImageSize(src);
        const asset = buildUploadedImageAsset({
          fileName: imageFile.name,
          src,
          width: size.width,
          height: size.height,
        });
        nextProject = applyUploadedImageToProject(nextProject, asset);
        const { w } = displaySizeForImageAsset(asset.width, asset.height);
        const existing = editor.getCurrentPageShapes().find((s) => {
          if ((s.type as string) !== "image-asset") return false;
          return (
            (s as unknown as { props: { assetId: string } }).props.assetId ===
            asset.id
          );
        });
        if (!existing) {
          const shape = makeImageAssetShape(
            asset.id,
            proj.id,
            asset.prompt,
            asset.status ?? "candidate",
            asset.width,
            asset.height,
            cursorX,
            pagePoint.y
          );
          editor.createShapes(
            [shape] as unknown as Parameters<typeof editor.createShapes>[0]
          );
          lastShapeId = shape.id;
        }
        cursorX += w + 24;
      }
      projectRef.current = nextProject;
      if (lastShapeId) editor.select(lastShapeId);
      useProjectStore.getState().upsert(nextProject);
      return;
    }

    const raw = e.dataTransfer.getData("application/x-vad-asset");
    if (!raw) return;
    e.preventDefault();

    let assetId: string;
    try {
      assetId = (JSON.parse(raw) as { assetId: string }).assetId;
    } catch {
      return;
    }

    // 拖入素材：已在画布则聚焦，避免同 assetId 再造一份
    const asset = (proj.assets ?? []).find((a) => a.id === assetId);
    if (!asset) return;
    const existing = editor.getCurrentPageShapes().find((s) => {
      if ((s.type as string) !== "image-asset") return false;
      return (
        (s as unknown as { props: { assetId: string } }).props.assetId ===
        assetId
      );
    });
    if (existing) {
      editor.select(existing.id);
      editor.zoomToSelection({ animation: { duration: 180 } });
      return;
    }
    const shape = makeImageAssetShape(
      asset.id,
      proj.id,
      asset.prompt,
      asset.status ?? "candidate",
      asset.width,
      asset.height,
      pagePoint.x,
      pagePoint.y
    );
    editor.createShapes(
      [shape] as unknown as Parameters<typeof editor.createShapes>[0]
    );
  }, []);

  return (
    <div
      className="vad-canvas-surface relative h-full w-full"
      onDragOverCapture={handleDragOver}
      onDropCapture={handleDrop}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <Tldraw
        persistenceKey={persistenceKey}
        shapeUtils={SHAPE_UTILS}
        onMount={handleMount}
        hideUi
        components={TLDRAW_COMPONENTS}
        {...(process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY
          ? { licenseKey: process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY }
          : {})}
      >
        <CanvasToolbar projectId={project?.id} />
        <CiteSpawnMenu />
        <SelectionFloatingBar
          onPrompt={onPrompt}
          onRunPrompt={onRunPrompt}
          onExportPage={onExportPage}
          onOpenHandoff={onOpenHandoff}
        />
        <CanvasViewChrome />
        <CanvasFocusListener />
        <CanvasSelectionBridge projectId={project?.id} />
        <CanvasEmptyState
          title={getTargetRecipe(resolveTargetId(project)).canvas.emptyTitle}
          hint={getTargetRecipe(resolveTargetId(project)).canvas.emptyHint}
        />
        <CanvasArtworkStrip projectId={project?.id} />
        <CanvasFailedCleanup projectId={project?.id} />
      </Tldraw>
    </div>
  );
}

/* ── 画布工具系统（替代 tldraw 原生 UI 的精简版） ───────────────── */

const CANVAS_TOOLS = [
  { id: "select", label: "选择 (V)", Icon: MousePointer2 },
  { id: "hand", label: "抓手 · 平移画布 (H)", Icon: Hand },
  { id: "draw", label: "画笔 · 自由标注 (D)", Icon: Pencil },
] as const;

function CanvasToolbar({ projectId }: { projectId?: string }) {
  const editor = useEditor();
  const upsertProject = useProjectStore((s) => s.upsert);
  const currentTool = useValue(
    "current tool",
    () => editor.getCurrentToolId(),
    [editor]
  );
  const canUndo = useValue("can undo", () => editor.getCanUndo(), [editor]);
  const canRedo = useValue("can redo", () => editor.getCanRedo(), [editor]);

  return (
    <div className="vad-canvas-toolbar absolute bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-0.5 p-1.5">
      {CANVAS_TOOLS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          data-tip={label}
          aria-label={label}
          aria-pressed={currentTool === id ? "true" : "false"}
          onClick={() => editor.setCurrentTool(id)}
          className={
            "vad-canvas-toolbar-btn grid size-9 place-items-center transition-colors duration-150 " +
            (currentTool === id ? "vad-canvas-toolbar-btn--active" : "")
          }
        >
          <Icon className="size-4" />
        </button>
      ))}

      <span className="vad-canvas-toolbar-divider" aria-hidden />

      <button
        type="button"
        data-tip="文本卡片 · 脚本 / 文案 / 规则"
        aria-label="撤销"
        onClick={() => {
          if (!projectId) return;
          const project = useProjectStore.getState().projects[projectId];
          if (!project) return;
          const vp = editor.getViewportPageBounds();
          const x = vp.x + vp.w / 2 - TEXT_NOTE_DEFAULT_W / 2;
          const y = vp.y + vp.h / 2 - TEXT_NOTE_DEFAULT_H / 2;
          upsertProject(spawnStandaloneNote(project, { kind: "note", x, y }).project);
        }}
        className="vad-canvas-toolbar-btn grid size-9 place-items-center transition-colors duration-150"
      >
        <Type className="size-4" />
      </button>

      <span className="vad-canvas-toolbar-divider" aria-hidden />

      <button
        type="button"
        data-tip="撤销 (Ctrl+Z)"
        aria-label="撤销"
        disabled={!canUndo}
        onClick={() => editor.undo()}
        className="vad-canvas-toolbar-btn grid size-9 place-items-center transition-colors duration-150 disabled:cursor-default disabled:opacity-35"
      >
        <Undo2 className="size-4" />
      </button>
      <button
        type="button"
        data-tip="重做 (Ctrl+Shift+Z)"
        aria-label="撤销"
        disabled={!canRedo}
        onClick={() => editor.redo()}
        className="vad-canvas-toolbar-btn grid size-9 place-items-center transition-colors duration-150 disabled:cursor-default disabled:opacity-35"
      >
        <Redo2 className="size-4" />
      </button>

      <span className="vad-canvas-toolbar-divider" aria-hidden />

      <CanvasAppearanceMenu />
    </div>
  );
}

const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/** 右上角视图条：挂到 ide-shell 槽位，与左上「项目流程」对称（right-6 / top-4） */
function CanvasViewChrome() {
  const editor = useEditor();
  const zoom = useValue("zoom level", () => editor.getZoomLevel(), [editor]);
  const selectedCount = useValue(
    "selected count",
    () => editor.getSelectedShapeIds().length,
    [editor]
  );
  const canvasGridStyle = useCanvasUiStore((s) => s.canvasGridStyle);
  const toggleGrid = useCanvasUiStore((s) => s.toggleCanvasGrid);
  const showMinimap = useCanvasUiStore((s) => s.showCanvasMinimap);
  const toggleMinimap = useCanvasUiStore((s) => s.toggleCanvasMinimap);
  const gridOn = isCanvasGridVisible(canvasGridStyle);
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const [slotEl, setSlotEl] = useState<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSlotEl(document.getElementById("vad-canvas-view-slot"));
  }, []);

  useEffect(() => {
    if (!zoomMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setZoomMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [zoomMenuOpen]);

  const center = () => editor.getViewportScreenCenter();

  const body = (
    <div className="vad-canvas-view-chrome pointer-events-auto flex flex-col items-end gap-2">
      <div className="vad-canvas-view-bar flex h-10 items-center gap-0.5 px-1.5">
        <button
          type="button"
          data-tip="缩放至全部内容"
          data-tip-bottom=""
        aria-label="撤销"
          onClick={() => editor.zoomToFit({ animation: { duration: 180 } })}
          className="vad-canvas-view-btn"
        >
          <Rows2 className="size-3.5" />
        </button>

        <span className="vad-canvas-view-divider" aria-hidden />

        <button
          type="button"
          data-tip="缩放至全部内容"
          data-tip-bottom=""
        aria-label="撤销"
          onClick={() =>
            editor.zoomOut(center(), { animation: { duration: 120 } })
          }
          className="vad-canvas-view-btn"
        >
          <Minus className="size-3.5" />
        </button>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            data-tip="缩放比例"
            data-tip-bottom=""
            aria-label="缩放比例"
            aria-expanded={zoomMenuOpen}
            onClick={() => setZoomMenuOpen((v) => !v)}
            className="vad-canvas-view-zoom-label"
          >
            <span className="tabular-nums">{Math.round(zoom * 100)}%</span>
            <ChevronDown className="size-3 opacity-60" />
          </button>
          {zoomMenuOpen ? (
            <div className="vad-canvas-view-zoom-menu">
              {ZOOM_PRESETS.map((level) => (
                <button
                  key={level}
                  type="button"
                  className={
                    "vad-canvas-view-zoom-item" +
                    (Math.abs(zoom - level) < 0.02
                      ? " vad-canvas-view-zoom-item--active"
                      : "")
                  }
                  onClick={() => {
                    const cam = editor.getCamera();
                    editor.setCamera(
                      { x: cam.x, y: cam.y, z: level },
                      { animation: { duration: 120 } }
                    );
                    setZoomMenuOpen(false);
                  }}
                >
                  {Math.round(level * 100)}%
                </button>
              ))}
              <button
                type="button"
                className="vad-canvas-view-zoom-item"
                onClick={() => {
                  editor.zoomToFit({ animation: { duration: 180 } });
                  setZoomMenuOpen(false);
                }}
              >
                适应画布
              </button>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          data-tip="缩放至全部内容"
          data-tip-bottom=""
        aria-label="撤销"
          onClick={() =>
            editor.zoomIn(center(), { animation: { duration: 120 } })
          }
          className="vad-canvas-view-btn"
        >
          <Plus className="size-3.5" />
        </button>

        <span className="vad-canvas-view-divider" aria-hidden />

        <button
          type="button"
          data-tip={gridOn ? "隐藏网格" : "显示网格"}
          data-tip-bottom=""
          aria-label={gridOn ? "隐藏网格" : "显示网格"}
          aria-pressed={gridOn}
          onClick={toggleGrid}
          className={
            "vad-canvas-view-btn" +
            (gridOn ? " vad-canvas-view-btn--active" : "")
          }
        >
          <Grid2x2 className="size-3.5" />
        </button>

        <button
          type="button"
          data-tip={selectedCount ? "聚焦选中" : "缩放至全部内容"}
          data-tip-bottom=""
          aria-label={selectedCount ? "聚焦选中" : "缩放至全部内容"}
          onClick={() => {
            if (selectedCount > 0) {
              editor.zoomToSelection({ animation: { duration: 180 } });
            } else {
              editor.zoomToFit({ animation: { duration: 180 } });
            }
          }}
          className="vad-canvas-view-btn"
        >
          <Spline className="size-3.5" />
        </button>

        <button
          type="button"
          data-tip={showMinimap ? "隐藏小地图" : "显示小地图"}
          data-tip-bottom=""
          aria-label={showMinimap ? "隐藏小地图" : "显示小地图"}
          aria-pressed={showMinimap}
          onClick={toggleMinimap}
          className={
            "vad-canvas-view-minimap-btn" +
            (showMinimap ? " vad-canvas-view-minimap-btn--active" : "")
          }
        >
          <MapIcon className="size-3.5" />
          小地图
        </button>
      </div>

      {showMinimap ? (
        <div className="vad-canvas-view-minimap-host">
          <CanvasMinimap />
        </div>
      ) : null}
    </div>
  );

  if (slotEl) return createPortal(body, slotEl);
  // 槽位未就绪时先落在画布内，避免闪断
  return (
    <div className="absolute top-4 right-6 z-10">{body}</div>
  );
}

function syncProjectToEditor(
  editor: Editor,
  project: ProjectFile | null,
  options: { zoomToFit: boolean; forceBoardLayout?: boolean }
) {
  const force = options.forceBoardLayout === true;
  const shapes = editor.getCurrentPageShapes();
  const customShapes = shapes.filter((s) => isVadShapeType(String(s.type)));

  if (!project) {
    if (customShapes.length > 0) {
      editor.deleteShapes(customShapes.map((s) => s.id));
    }
    return;
  }

  const assetIds = new Set(
    (project.assets ?? []).filter(isCanvasVisibleAsset).map((a) => a.id)
  );
  const referenceIds = new Set(
    (project.references ?? [])
      .filter(isCanvasVisibleReference)
      .map((r) => r.id)
  );
  const noteIds = new Set((project.canvasNotes ?? []).map((n) => n.id));

  // 网页结构框 / 页间箭头 / 旧交付卡：一律清除
  const stale = customShapes
    .filter((s) => {
      const type = s.type as string;
      if (
        type === "canvas-page" ||
        type === "flow-arrow" ||
        type === "spec-card" ||
        type === "handoff-card"
      ) {
        return true;
      }
      if (type === "image-asset") {
        const props = (s as unknown as { props: { assetId: string } }).props;
        return !assetIds.has(props.assetId);
      }
      if (type === "reference-card") {
        const props = (s as unknown as { props: { referenceId: string } }).props;
        return !referenceIds.has(props.referenceId);
      }
      if (type === "text-note") {
        const props = (s as unknown as { props: { noteId: string } }).props;
        return !noteIds.has(props.noteId);
      }
      if (type === "asset-link") {
        const props = (
          s as unknown as {
            props: { fromAssetId: string; toAssetId: string; toNoteId?: string };
          }
        ).props;
        if (props.toNoteId) {
          return !assetIds.has(props.fromAssetId) || !noteIds.has(props.toNoteId);
        }
        return (
          !assetIds.has(props.fromAssetId) || !assetIds.has(props.toAssetId)
        );
      }
      if (type === "family-board") {
        const rootId = (
          s as unknown as { props: { rootAssetId: string } }
        ).props.rootAssetId;
        return !assetIds.has(rootId);
      }
      return false;
    })
    .map((s) => s.id);

  if (stale.length > 0) {
    editor.deleteShapes(stale);
  }

  // 同业务 id 多份 shape（拖入重复 / persistence+snapshot 叠层）只留一份
  const afterStale = editor.getCurrentPageShapes();
  const duplicateIds = collectDuplicateVadShapeIds(afterStale);
  if (duplicateIds.length > 0) {
    editor.deleteShapes(duplicateIds);
  }

  const freshShapes = editor.getCurrentPageShapes();
  const assetShapes = new Map(
    freshShapes
      .filter((s) => (s.type as string) === "image-asset")
      .map((s) => [
        (s as unknown as { props: { assetId: string } }).props.assetId,
        s,
      ])
  );
  const referenceShapes = new Map(
    freshShapes
      .filter((s) => (s.type as string) === "reference-card")
      .map((s) => [
        (s as unknown as { props: { referenceId: string } }).props.referenceId,
        s,
      ])
  );

  const board = computeBoardLayout(project);
  const activeAssets = (project.assets ?? []).filter(
      isCanvasVisibleAsset
  );

  const PARENT_GAP = PARENT_CHILD_GAP;
  const placedMeta = new Map<string, { x: number; y: number; w: number }>();
  for (const [id, shape] of assetShapes) {
    placedMeta.set(id, {
      x: shape.x,
      y: shape.y,
      w: (shape as unknown as { props: { w: number } }).props.w,
    });
  }

  activeAssets.forEach((asset) => {
    const slot =
      board.assetById[asset.id] ??
      board.assets[activeAssets.indexOf(asset)];
    const existing = assetShapes.get(asset.id);
    let ax = force ? (slot?.x ?? 0) : (existing?.x ?? (slot?.x ?? 0));
    let ay = force ? (slot?.y ?? 0) : (existing?.y ?? (slot?.y ?? 0));

    // 新派生卡（变体/框选重绘/+ 空节点）落在父素材右侧；多子纵向错开
    if (!existing && !force && asset.parentAssetId) {
      const primed = useCanvasUiStore.getState().takeSpawnPoint();
      if (primed) {
        ax = primed.x;
        ay = primed.y;
      } else {
        const parent = placedMeta.get(asset.parentAssetId);
        if (parent) {
          const siblingIndex = [...placedMeta.keys()].filter((id) => {
            if (id === asset.parentAssetId) return false;
            const sib = activeAssets.find((a) => a.id === id);
            return sib?.parentAssetId === asset.parentAssetId;
          }).length;
          const childH =
            board.assetById[asset.id]?.h ??
            displaySizeForImageAsset(asset.width, asset.height).h;
          ax = parent.x + parent.w + PARENT_GAP;
          ay = parent.y + siblingIndex * (childH + 24);
        }
      }
    }

    const nextShape = makeImageAssetShape(
      asset.id,
      project.id,
      asset.prompt,
      asset.status ?? "candidate",
      asset.width,
      asset.height,
      ax,
      ay
    );
    if (existing) {
      updateCustomShapes(editor, [
        {
          id: existing.id,
          type: "image-asset",
          x: ax,
          y: ay,
          props: {
            ...nextShape.props,
            status: asset.status ?? "candidate",
            promptSnippet: asset.prompt.slice(0, 60),
          },
        },
      ]);
      placedMeta.set(asset.id, { x: ax, y: ay, w: nextShape.props.w });
    } else {
      createCustomShapes(editor, [nextShape]);
      placedMeta.set(asset.id, { x: ax, y: ay, w: nextShape.props.w });
    }
  });

  (project.references ?? [])
    .filter(isCanvasVisibleReference)
    .forEach((reference, index) => {
    const slot = board.references[index];
    const existing = referenceShapes.get(reference.id);
    const rx = force ? (slot?.x ?? 0) : (existing?.x ?? (slot?.x ?? 0));
    const ry = force ? (slot?.y ?? 0) : (existing?.y ?? (slot?.y ?? 0));
    const nextShape = makeReferenceCardShape(
      reference.id,
      project.id,
      reference.label,
      reference.source,
      reference.width,
      reference.height,
      rx,
      ry
    );
    if (existing) {
      updateCustomShapes(editor, [
        {
          id: existing.id,
          type: "reference-card",
          x: rx,
          y: ry,
          props: nextShape.props,
        },
      ]);
    } else {
      createCustomShapes(editor, [nextShape]);
    }
  });

  syncCanvasNotes(editor, project, placedMeta, force);
  syncAssetLinks(editor, project);
  syncFamilyBoards(editor, project);
  restackCanvasLayers(editor);

  if (options.zoomToFit) {
    requestAnimationFrame(() => {
      zoomToBoardPrimary(editor, project);
    });
  }
}

function syncCanvasNotes(
  editor: Editor,
  project: ProjectFile,
  placedMeta: Map<string, { x: number; y: number; w: number }>,
  force: boolean
) {
  const notes = project.canvasNotes ?? [];
  const shapes = editor.getCurrentPageShapes();
  const existingById = new Map(
    shapes
      .filter((s) => (s.type as string) === "text-note")
      .map((s) => [
        (s as unknown as { props: { noteId: string } }).props.noteId,
        s,
      ])
  );

  notes.forEach((note) => {
    const existing = existingById.get(note.id);
    let ax = force ? (note.x ?? 0) : (existing?.x ?? note.x ?? 0);
    let ay = force ? (note.y ?? 0) : (existing?.y ?? note.y ?? 0);
    if (!existing && note.parentAssetId) {
      const parent = placedMeta.get(note.parentAssetId);
      if (parent) {
        const siblingIndex = notes.filter(
          (item) =>
            item.parentAssetId === note.parentAssetId &&
            item.createdAt < note.createdAt
        ).length;
        const pos = placeCitedNode(
          { ...parent, h: parent.w },
          siblingIndex,
          note.h ?? TEXT_NOTE_DEFAULT_H
        );
        ax = note.x ?? pos.x;
        ay = note.y ?? pos.y;
      }
    }
    const next = makeTextNoteShape({
      noteId: note.id,
      projectId: project.id,
      x: ax,
      y: ay,
      w: existing
        ? (existing as unknown as { props: { w: number } }).props.w
        : (note.w ?? TEXT_NOTE_DEFAULT_W),
      h: existing
        ? (existing as unknown as { props: { h: number } }).props.h
        : (note.h ?? TEXT_NOTE_DEFAULT_H),
    });
    if (existing) {
      updateCustomShapes(editor, [
        {
          id: existing.id,
          type: "text-note",
          x: ax,
          y: ay,
          props: next.props,
        },
      ]);
    } else {
      createCustomShapes(editor, [next]);
    }
  });
}

/** 按 parentAssetId 维护父图 → 子素材连线 */
function syncAssetLinks(editor: Editor, project: ProjectFile) {
  const assets = (project.assets ?? []).filter(isCanvasVisibleAsset);
  const byId = new Map(assets.map((a) => [a.id, a]));
  const shapes = editor.getCurrentPageShapes();
  const assetBoxes = new Map<string, LinkEndpointBox>();
  const noteBoxes = new Map<string, LinkEndpointBox>();
  for (const shape of shapes) {
    const type = shape.type as string;
    if (type === "image-asset") {
      const props = shape as unknown as {
        props: { assetId: string; w: number; h: number };
      };
      assetBoxes.set(props.props.assetId, {
        x: shape.x,
        y: shape.y,
        w: props.props.w,
        h: props.props.h,
      });
    }
    if (type === "text-note") {
      const props = shape as unknown as {
        props: { noteId: string; w: number; h: number };
      };
      noteBoxes.set(props.props.noteId, {
        x: shape.x,
        y: shape.y,
        w: props.props.w,
        h: props.props.h,
      });
    }
  }

  const desired = new Map<
    string,
    {
      fromAssetId: string;
      toAssetId: string;
      toNoteId?: string;
      label: string;
    }
  >();
  for (const child of assets) {
    const parentId = child.parentAssetId;
    if (!parentId || !byId.has(parentId)) continue;
    if (!assetBoxes.has(parentId) || !assetBoxes.has(child.id)) continue;
    desired.set(`${parentId}→${child.id}`, {
      fromAssetId: parentId,
      toAssetId: child.id,
      label: linkLabelForAsset(child),
    });
  }
  for (const note of project.canvasNotes ?? []) {
    if (!note.parentAssetId || !assetBoxes.has(note.parentAssetId)) continue;
    if (!noteBoxes.has(note.id)) continue;
    desired.set(`${note.parentAssetId}→note:${note.id}`, {
      fromAssetId: note.parentAssetId,
      toAssetId: "",
      toNoteId: note.id,
      label: noteKindLabel(note.kind),
    });
  }

  const existingLinks = shapes.filter(
    (s) => (s.type as string) === "asset-link"
  );
  const existingByKey = new Map<string, (typeof shapes)[number]>();
  for (const link of existingLinks) {
    const props = (
      link as unknown as {
        props: { fromAssetId: string; toAssetId: string; toNoteId?: string };
      }
    ).props;
    const key = props.toNoteId
      ? `${props.fromAssetId}→note:${props.toNoteId}`
      : `${props.fromAssetId}→${props.toAssetId}`;
    existingByKey.set(key, link);
  }

  const toDelete = existingLinks
    .filter((link) => {
      const props = (
        link as unknown as {
          props: { fromAssetId: string; toAssetId: string; toNoteId?: string };
        }
      ).props;
      const key = props.toNoteId
        ? `${props.fromAssetId}→note:${props.toNoteId}`
        : `${props.fromAssetId}→${props.toAssetId}`;
      return !desired.has(key);
    })
    .map((l) => l.id);
  if (toDelete.length) editor.deleteShapes(toDelete);

  const toCreate: ReturnType<typeof makeAssetLinkShape>[] = [];
  const toUpdate: Array<{
    id: (typeof shapes)[number]["id"];
    type: "asset-link";
    x: number;
    y: number;
    isLocked: boolean;
    props: ReturnType<typeof makeAssetLinkShape>["props"];
  }> = [];

  for (const [key, edge] of desired) {
    const from = assetBoxes.get(edge.fromAssetId)!;
    const to = edge.toNoteId
      ? noteBoxes.get(edge.toNoteId)!
      : assetBoxes.get(edge.toAssetId)!;
    const next = makeAssetLinkShape({
      fromAssetId: edge.fromAssetId,
      toAssetId: edge.toAssetId,
      toNoteId: edge.toNoteId,
      label: edge.label,
      from,
      to,
    });
    const existing = existingByKey.get(key);
    if (!existing) {
      toCreate.push(next);
    } else {
      toUpdate.push({
        id: existing.id,
        type: "asset-link",
        x: next.x,
        y: next.y,
        isLocked: false,
        props: next.props,
      });
    }
  }

  if (toCreate.length) {
    createCustomShapes(editor, toCreate);
    editor.sendToBack(toCreate.map((s) => s.id));
  }
  if (toUpdate.length) {
    updateCustomShapes(editor, toUpdate);
    editor.sendToBack(toUpdate.map((s) => s.id));
  }
}

/** 有派生关系的家族画一块底板，压在连线和图下面 */
function syncFamilyBoards(editor: Editor, project: ProjectFile) {
  const assets = (project.assets ?? []).filter(isCanvasVisibleAsset);
  const families = buildAssetFamilies(assets).filter(
    (family) => family.descendants.length > 0
  );
  const desired = new Map<
    string,
    { rootAssetId: string; memberAssetIds: string[]; label: string }
  >();
  for (const family of families) {
    const memberAssetIds = [
      family.root.id,
      ...family.descendants.map((child) => child.id),
    ];
    const current = editor
      .getCurrentPageShapes()
      .find((shape) => {
        if ((shape.type as string) !== "family-board") return false;
        return (
          (shape as unknown as { props: { rootAssetId: string } }).props
            .rootAssetId === family.root.id
        );
      });
    const currentLabel =
      (current as unknown as { props?: { label?: string } } | undefined)?.props
        ?.label ?? "";
    desired.set(family.root.id, {
      rootAssetId: family.root.id,
      memberAssetIds,
      label: resolveFamilyBoardTitle({
        familyTitle: family.root.familyTitle,
        currentLabel,
        pageName: familyBoardPageName({
          usedInPages: family.root.usedInPages,
          pages: project.pages,
          architecturePages: project.architecture?.pages,
        }),
      }),
    });
  }

  const existing = editor
    .getCurrentPageShapes()
    .filter((s) => (s.type as string) === "family-board");
  const existingByRoot = new Map<string, (typeof existing)[number]>();
  for (const board of existing) {
    const rootId = (
      board as unknown as { props: { rootAssetId: string } }
    ).props.rootAssetId;
    existingByRoot.set(rootId, board);
  }

  const toDelete = existing
    .filter((board) => {
      const rootId = (
        board as unknown as { props: { rootAssetId: string } }
      ).props.rootAssetId;
      return !desired.has(rootId);
    })
    .map((board) => board.id);
  if (toDelete.length) editor.deleteShapes(toDelete);

  const toCreate: ReturnType<typeof makeFamilyBoardShape>[] = [];
  const toUpdate: Array<{
    id: (typeof existing)[number]["id"];
    type: "family-board";
    x: number;
    y: number;
    isLocked: boolean;
    props: ReturnType<typeof makeFamilyBoardShape>["props"];
  }> = [];

  for (const [rootId, spec] of desired) {
    const bounds = familyBoardFromMembers(editor, spec.memberAssetIds);
    if (!bounds) continue;
    const next = makeFamilyBoardShape({
      rootAssetId: spec.rootAssetId,
      memberAssetIds: spec.memberAssetIds,
      label: spec.label,
      bounds,
      projectId: project.id,
    });
    const current = existingByRoot.get(rootId);
    if (!current) {
      toCreate.push(next);
      continue;
    }
    const currentProps = current as unknown as {
      x: number;
      y: number;
      props: {
        w: number;
        h: number;
        label: string;
        memberAssetIds: string;
        projectId?: string;
      };
    };
    if (
      Math.abs(currentProps.x - next.x) < 0.5 &&
      Math.abs(currentProps.y - next.y) < 0.5 &&
      Math.abs(currentProps.props.w - next.props.w) < 0.5 &&
      Math.abs(currentProps.props.h - next.props.h) < 0.5 &&
      currentProps.props.label === next.props.label &&
      currentProps.props.memberAssetIds === next.props.memberAssetIds &&
      (currentProps.props.projectId ?? "") === next.props.projectId
    ) {
      continue;
    }
    toUpdate.push({
      id: current.id,
      type: "family-board",
      x: next.x,
      y: next.y,
      isLocked: false,
      props: next.props,
    });
  }

  if (toCreate.length) {
    createCustomShapes(editor, toCreate);
  }
  if (toUpdate.length) {
    updateCustomShapes(editor, toUpdate);
  }
}

/** 底板 < 连线 < 卡片，避免半透明底板罩在图上把画面洗白 */
function restackCanvasLayers(editor: Editor) {
  const shapes = editor.getCurrentPageShapes();
  const boardIds = shapes
    .filter((s) => (s.type as string) === "family-board")
    .map((s) => s.id);
  const linkIds = shapes
    .filter((s) => (s.type as string) === "asset-link")
    .map((s) => s.id);
  const contentIds = shapes
    .filter((s) => {
      const type = s.type as string;
      return type === "image-asset" || type === "reference-card" || type === "text-note";
    })
    .map((s) => s.id);

  if (boardIds.length) {
    editor.sendToBack(boardIds);
  }
  if (linkIds.length) {
    editor.sendToBack(linkIds);
    if (boardIds.length) editor.sendToBack(boardIds);
  }
  if (contentIds.length) editor.bringToFront(contentIds);
}

type LinkEndpointBox = { x: number; y: number; w: number; h: number };

/** 仅刷新已有连线几何（拖拽时调用） */
function refreshAssetLinkLayouts(editor: Editor) {
  const shapes = editor.getCurrentPageShapes();
  const assetBoxes = new Map<string, LinkEndpointBox>();
  for (const shape of shapes) {
    if ((shape.type as string) !== "image-asset") continue;
    const props = shape as unknown as {
      props: { assetId: string; w: number; h: number };
    };
    assetBoxes.set(props.props.assetId, {
      x: shape.x,
      y: shape.y,
      w: props.props.w,
      h: props.props.h,
    });
  }

  const updates: Array<{
    id: (typeof shapes)[number]["id"];
    type: "asset-link";
    x: number;
    y: number;
    props: {
      w: number;
      h: number;
      fromAssetId: string;
      toAssetId: string;
      label: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    };
  }> = [];

  for (const shape of shapes) {
    if ((shape.type as string) !== "asset-link") continue;
    const props = shape as unknown as {
      props: {
        fromAssetId: string;
        toAssetId: string;
        label: string;
        w: number;
        h: number;
        x1: number;
        y1: number;
        x2: number;
        y2: number;
      };
    };
    const from = assetBoxes.get(props.props.fromAssetId);
    const to = assetBoxes.get(props.props.toAssetId);
    if (!from || !to) continue;
    const layout = computeAssetLinkLayout(from, to);
    if (
      Math.abs(shape.x - layout.x) < 0.5 &&
      Math.abs(shape.y - layout.y) < 0.5 &&
      Math.abs(props.props.w - layout.w) < 0.5 &&
      Math.abs(props.props.h - layout.h) < 0.5 &&
      Math.abs(props.props.x1 - layout.x1) < 0.5 &&
      Math.abs(props.props.y1 - layout.y1) < 0.5 &&
      Math.abs(props.props.x2 - layout.x2) < 0.5 &&
      Math.abs(props.props.y2 - layout.y2) < 0.5
    ) {
      continue;
    }
    updates.push({
      id: shape.id,
      type: "asset-link",
      x: layout.x,
      y: layout.y,
      props: {
        w: layout.w,
        h: layout.h,
        fromAssetId: props.props.fromAssetId,
        toAssetId: props.props.toAssetId,
        label: props.props.label,
        x1: layout.x1,
        y1: layout.y1,
        x2: layout.x2,
        y2: layout.y2,
      },
    });
  }

  if (updates.length) {
    // 避免连线更新再次触发监听形成抖动：由外层 syncingRef 罩不住 store.listen 内部调用
    updateCustomShapes(editor, updates);
  }
}

/** 初始视口聚焦生图/参考主视觉层，避免整页 mock 占满屏幕 */
function zoomToBoardPrimary(editor: Editor, project: ProjectFile) {
  const shapes = editor.getCurrentPageShapes();
  const assetIdSet = new Set(
    (project.assets ?? []).filter(isCanvasVisibleAsset).map((a) => a.id)
  );
  const referenceIdSet = new Set(
    (project.references ?? [])
      .filter(isCanvasVisibleReference)
      .map((r) => r.id)
  );

  const primary = shapes.filter((s) => {
    const type = s.type as string;
    if (type === "image-asset") {
      const props = (s as unknown as { props: { assetId: string } }).props;
      return assetIdSet.has(props.assetId);
    }
    if (type === "reference-card") {
      const props = (s as unknown as { props: { referenceId: string } }).props;
      return referenceIdSet.has(props.referenceId);
    }
    if (type === "text-note") return true;
    return false;
  });

  const targets = primary;

  if (targets.length === 0) {
    editor.zoomToFit({ animation: { duration: 300 } });
    return;
  }

  const shapeIds = targets.map((s) => s.id).filter((id): id is NonNullable<typeof id> => Boolean(id));
  if (shapeIds.length === 0) {
    editor.zoomToFit({ animation: { duration: 300 } });
    return;
  }

  // tldraw 5：select 为可变参数，勿传入数组（否则会读 undefined.id）
  editor.select(...shapeIds);
  editor.zoomToSelection({ animation: { duration: 300 } });
  editor.selectNone();
}

function restoreCanvasSnapshot(
  editor: Editor,
  snapshot: CanvasSnapshot | undefined,
  project: ProjectFile | null | undefined
) {
  if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.shapes.length === 0) {
    return;
  }
  if (editor.getCurrentPageShapes().length > 0) {
    return;
  }
  const visibleAssetIds = new Set(
    (project?.assets ?? []).filter(isCanvasVisibleAsset).map((a) => a.id)
  );
  const visibleReferenceIds = new Set(
    (project?.references ?? [])
      .filter(isCanvasVisibleReference)
      .map((r) => r.id)
  );
  const shapes = snapshot.shapes.filter((shape) => {
    const type = String((shape as { type?: string }).type ?? "");
    if (
      type === "spec-card" ||
      type === "handoff-card" ||
      type === "canvas-page" ||
      type === "flow-arrow"
    ) {
      return false;
    }
    if (type === "image-asset") {
      const assetId = (
        shape as { props?: { assetId?: string } }
      ).props?.assetId;
      return Boolean(assetId && visibleAssetIds.has(assetId));
    }
    if (type === "reference-card") {
      const referenceId = (
        shape as { props?: { referenceId?: string } }
      ).props?.referenceId;
      return Boolean(referenceId && visibleReferenceIds.has(referenceId));
    }
    if (type === "asset-link") {
      const fromId = (
        shape as { props?: { fromAssetId?: string; toAssetId?: string; toNoteId?: string } }
      ).props?.fromAssetId;
      const toNoteId = (
        shape as { props?: { toNoteId?: string } }
      ).props?.toNoteId;
      const toId = (
        shape as { props?: { toAssetId?: string } }
      ).props?.toAssetId;
      if (toNoteId) {
        return Boolean(
          fromId &&
            visibleAssetIds.has(fromId) &&
            (project?.canvasNotes ?? []).some((n) => n.id === toNoteId)
        );
      }
      return Boolean(
        fromId &&
          toId &&
          visibleAssetIds.has(fromId) &&
          visibleAssetIds.has(toId)
      );
    }
    if (type === "family-board") {
      const rootId = (shape as { props?: { rootAssetId?: string } }).props
        ?.rootAssetId;
      return Boolean(rootId && visibleAssetIds.has(rootId));
    }
    return true;
  });
  createCustomShapes(editor, shapes);
}

function saveCanvasSnapshot(
  editor: Editor,
  project: ProjectFile | null,
  lastSnapshotJsonRef: { current: string }
) {
  if (!project) return;
  const latestForSnap =
    useProjectStore.getState().projects[project.id] ?? project;
  const visibleAssetIds = new Set(
    (latestForSnap.assets ?? [])
      .filter(isCanvasVisibleAsset)
      .map((a) => a.id)
  );
  const visibleReferenceIds = new Set(
    (latestForSnap.references ?? [])
      .filter(isCanvasVisibleReference)
      .map((r) => r.id)
  );
  const snapshot: CanvasSnapshot = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    shapes: editor
      .getCurrentPageShapes()
      .filter((shape) => {
        const type = String(shape.type);
        if (
          type === "spec-card" ||
          type === "handoff-card" ||
          type === "canvas-page" ||
          type === "flow-arrow"
        ) {
          return false;
        }
        if (type === "image-asset") {
          const assetId = (shape as unknown as { props: { assetId: string } })
            .props.assetId;
          return visibleAssetIds.has(assetId);
        }
        if (type === "reference-card") {
          const referenceId = (
            shape as unknown as { props: { referenceId: string } }
          ).props.referenceId;
          return visibleReferenceIds.has(referenceId);
        }
        if (type === "text-note") {
          const noteId = (shape as unknown as { props: { noteId: string } }).props
            .noteId;
          return (latestForSnap.canvasNotes ?? []).some((n) => n.id === noteId);
        }
        if (type === "asset-link") {
          const props = shape as unknown as {
            props: { fromAssetId: string; toAssetId: string; toNoteId?: string };
          };
          if (props.props.toNoteId) {
            return (
              visibleAssetIds.has(props.props.fromAssetId) &&
              (latestForSnap.canvasNotes ?? []).some(
                (n) => n.id === props.props.toNoteId
              )
            );
          }
          return (
            visibleAssetIds.has(props.props.fromAssetId) &&
            visibleAssetIds.has(props.props.toAssetId)
          );
        }
        if (type === "family-board") {
          const rootId = (
            shape as unknown as { props: { rootAssetId: string } }
          ).props.rootAssetId;
          return visibleAssetIds.has(rootId);
        }
        return true;
      })
      .map((shape) =>
        JSON.parse(JSON.stringify(shape)) as Record<string, unknown>
      ),
  };
  const snapshotJson = JSON.stringify(snapshot.shapes);
  if (snapshotJson === lastSnapshotJsonRef.current) return;
  lastSnapshotJsonRef.current = snapshotJson;
  // 以 store 最新 assets 为准，避免 snapshot 回写时用陈旧 project 覆盖丢弃状态
  useProjectStore.getState().upsert({
    ...latestForSnap,
    updatedAt: snapshot.updatedAt,
    canvasSnapshot: snapshot,
    canvasNotes: persistCanvasNoteLayout(
      latestForSnap.canvasNotes,
      editor.getCurrentPageShapes().map((shape) => ({
        type: String(shape.type),
        x: shape.x,
        y: shape.y,
        props: (shape as unknown as {
          props: { noteId?: string; w?: number; h?: number };
        }).props,
      }))
    ),
  });
}

function isVadShapeType(type: string): boolean {
  return (
    type === "canvas-page" ||
    type === "image-asset" ||
    type === "reference-card" ||
    type === "text-note" ||
    type === "flow-arrow" ||
    type === "asset-link" ||
    type === "family-board" ||
    // 旧版残留：同步时识别并删除
    type === "spec-card" ||
    type === "handoff-card"
  );
}

/**
 * 同一 assetId / referenceId 只保留面积最大的一份（通常为已适配自然尺寸的主图），
 * 其余视为残留副本，返回待删除的 shape id。
 */
function collectDuplicateVadShapeIds(
  shapes: ReturnType<Editor["getCurrentPageShapes"]>
): ReturnType<Editor["getCurrentPageShapes"]>[number]["id"][] {
  type Entry = {
    id: ReturnType<Editor["getCurrentPageShapes"]>[number]["id"];
    area: number;
  };
  const bestAsset = new Map<string, Entry>();
  const bestRef = new Map<string, Entry>();
  const bestBoard = new Map<string, Entry>();
  const bestNote = new Map<string, Entry>();
  const drop: Entry["id"][] = [];

  for (const shape of shapes) {
    const type = shape.type as string;
    const props = (shape as unknown as { props: { w?: number; h?: number } })
      .props;
    const area = Math.max(1, (props.w ?? 1) * (props.h ?? 1));

    if (type === "image-asset") {
      const assetId = (shape as unknown as { props: { assetId: string } }).props
        .assetId;
      if (!assetId) {
        drop.push(shape.id);
        continue;
      }
      const prev = bestAsset.get(assetId);
      if (!prev) {
        bestAsset.set(assetId, { id: shape.id, area });
      } else if (area > prev.area) {
        drop.push(prev.id);
        bestAsset.set(assetId, { id: shape.id, area });
      } else {
        drop.push(shape.id);
      }
      continue;
    }

    if (type === "reference-card") {
      const referenceId = (
        shape as unknown as { props: { referenceId: string } }
      ).props.referenceId;
      if (!referenceId) {
        drop.push(shape.id);
        continue;
      }
      const prev = bestRef.get(referenceId);
      if (!prev) {
        bestRef.set(referenceId, { id: shape.id, area });
      } else if (area > prev.area) {
        drop.push(prev.id);
        bestRef.set(referenceId, { id: shape.id, area });
      } else {
        drop.push(shape.id);
      }
      continue;
    }

    if (type === "text-note") {
      const noteId = (shape as unknown as { props: { noteId: string } }).props
        .noteId;
      if (!noteId) {
        drop.push(shape.id);
        continue;
      }
      const prev = bestNote.get(noteId);
      if (!prev) {
        bestNote.set(noteId, { id: shape.id, area });
      } else if (area > prev.area) {
        drop.push(prev.id);
        bestNote.set(noteId, { id: shape.id, area });
      } else {
        drop.push(shape.id);
      }
      continue;
    }

    if (type === "family-board") {
      const rootId = (
        shape as unknown as { props: { rootAssetId: string } }
      ).props.rootAssetId;
      if (!rootId) {
        drop.push(shape.id);
        continue;
      }
      const prev = bestBoard.get(rootId);
      if (!prev) {
        bestBoard.set(rootId, { id: shape.id, area });
      } else if (area > prev.area) {
        drop.push(prev.id);
        bestBoard.set(rootId, { id: shape.id, area });
      } else {
        drop.push(shape.id);
      }
    }
  }

  return drop;
}

function createCustomShapes(
  editor: Editor,
  shapes: unknown[]
) {
  if (shapes.length === 0) return;
  editor.createShapes(
    shapes as unknown as Parameters<typeof editor.createShapes>[0]
  );
}

function updateCustomShapes(
  editor: Editor,
  shapes: unknown[]
) {
  if (shapes.length === 0) return;
  editor.updateShapes(
    shapes as unknown as Parameters<typeof editor.updateShapes>[0]
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function readImageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve({
        width: img.naturalWidth || 1200,
        height: img.naturalHeight || 800,
      });
    img.onerror = () => resolve({ width: 1200, height: 800 });
    img.src = src;
  });
}
