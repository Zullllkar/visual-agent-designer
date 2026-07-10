"use client";

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
 *   - 只同步 image-asset / reference-card（视觉素材）
 *   - 旧版 canvas-page / flow-arrow / spec / handoff 一律删除
 *   - 按业务 id diff/patch，保留用户手动排布的 x/y
 */

import { useCallback, useEffect, useRef } from "react";
import { nanoid } from "nanoid";
import {
  Tldraw,
  useEditor,
  useValue,
  type Editor,
} from "tldraw";
import {
  Frame as FrameIcon,
  Hand,
  Maximize,
  Minus,
  MousePointer2,
  Pencil,
  Plus,
  Redo2,
  StickyNote,
  Type as TypeIcon,
  Undo2,
} from "lucide-react";
import type { CanvasSnapshot, ProjectFile } from "@/lib/project/schema";
import { CanvasPageShapeUtil } from "./canvas-page-shape";
import { ImageAssetShapeUtil, makeImageAssetShape } from "./image-asset-shape";
import {
  ReferenceCardShapeUtil,
  makeReferenceCardShape,
} from "./reference-card-shape";
import { FlowArrowShapeUtil } from "./flow-arrow-shape";
import {
  HandoffCardShapeUtil,
  SpecCardShapeUtil,
} from "./deprecated-shape-stubs";
import { CanvasMinimap } from "./canvas-minimap";
import { CanvasFocusListener } from "./canvas-focus-listener";
import { SelectionFloatingBar } from "./selection-floating-bar";
import { useCanvasSelectionStore } from "@/store/canvas-selection-store";
import { useCanvasBoardStore } from "@/store/canvas-board-store";
import { useProjectStore } from "@/store/project-store";
import type { ReferenceAsset } from "@/lib/project/assets-schema";
import { computeBoardLayout } from "@/lib/canvas/board-layout";

interface TldrawCanvasProps {
  project: ProjectFile | null;
  activePageId?: string;
  /** 资产/页面变更代次，驱动画布强制同步 */
  syncRevision?: string;
  /** AI 快捷动作：把预设 prompt 填入右侧助理输入框 */
  onPrompt?: (prompt: string) => void;
  /** 导出当前页 JSON */
  onExportPage?: () => void;
}

const SHAPE_UTILS = [
  CanvasPageShapeUtil,
  ImageAssetShapeUtil,
  ReferenceCardShapeUtil,
  FlowArrowShapeUtil,
  // 兼容旧 IndexedDB：校验通过后由 sync 删除，不渲染 UI
  SpecCardShapeUtil,
  HandoffCardShapeUtil,
];

export function TldrawCanvas({
  project,
  activePageId,
  syncRevision,
  onPrompt,
  onExportPage,
}: TldrawCanvasProps) {
  // 把最新 project 同步进 ref，让 selection interval 里能读到最新值
  // （onMount 闭包只会捕获 mount 时刻的 project 引用）。
  const projectRef = useRef(project);

  // editor 引用：drop 处理需要从 client 坐标 → page 坐标做 hit-test
  const editorRef = useRef<Editor | null>(null);
  const syncingRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const lastSnapshotJsonRef = useRef<string>("");
  const prevAssetCountRef = useRef(0);
  const resetToken = useCanvasBoardStore((s) => s.resetToken);
  const resetProjectId = useCanvasBoardStore((s) => s.resetProjectId);

  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      restoreCanvasSnapshot(editor, projectRef.current?.canvasSnapshot);
      syncProjectToEditor(editor, projectRef.current, { zoomToFit: true });
      saveCanvasSnapshot(editor, projectRef.current, lastSnapshotJsonRef);

      // ── B6 Comment Mode ──────────────────────────────────────
      // 监听 selection 变化，把"只选中的 canvas-page shape"映射到
      // 全局 canvas-selection-store。
      // tldraw 5.x 的 selection 订阅可以用 editor.store.listen() 或者
      // 简单地用 setInterval 轮询；这里用 150ms 间隔 + last-id diff，
      // 足够交互响应又避免依赖内部 API 细节。
      let lastSelectedId: string | null = null;
      const intervalId = window.setInterval(() => {
        const only = editor.getOnlySelectedShape();
        const id = only ? String(only.id) : null;
        if (id === lastSelectedId) return;
        lastSelectedId = id;

        const liveProject = projectRef.current;
        if (!liveProject) {
          useCanvasSelectionStore.getState().clear();
          return;
        }
        if (only && (only.type as string) === "canvas-page") {
          const props = (only as unknown as {
            props: { pageId: string; serializedPage: string };
          }).props;
          let pageName = "页面";
          try {
            const page = JSON.parse(props.serializedPage) as { name?: string };
            if (page?.name) pageName = page.name;
          } catch {
            /* ignore */
          }
          useCanvasSelectionStore.getState().set({
            projectId: liveProject.id,
            kind: "page",
            pageId: props.pageId,
            pageName,
          });
        } else if (only && (only.type as string) === "image-asset") {
          const props = (only as unknown as { props: { assetId: string } }).props;
          const asset = liveProject.assets?.find((a) => a.id === props.assetId);
          useCanvasSelectionStore.getState().set({
            projectId: liveProject.id,
            kind: "asset",
            pageId: asset?.usedInPages?.[0] ?? "",
            pageName: (asset?.prompt ?? "生图").slice(0, 48),
            assetId: props.assetId,
          });
        } else {
          useCanvasSelectionStore.getState().clear();
        }
      }, 150);

      const stopStoreListen = editor.store.listen(
        () => {
          if (syncingRef.current) return;
          const liveProject = projectRef.current;
          if (!liveProject) return;
          if (saveTimerRef.current !== null) {
            window.clearTimeout(saveTimerRef.current);
          }
          saveTimerRef.current = window.setTimeout(() => {
            saveTimerRef.current = null;
            const latestProject = projectRef.current;
            if (!latestProject) return;
            syncingRef.current = true;
            try {
              syncProjectToEditor(editor, latestProject, { zoomToFit: false });
              saveCanvasSnapshot(editor, latestProject, lastSnapshotJsonRef);
            } finally {
              window.setTimeout(() => {
                syncingRef.current = false;
              }, 0);
            }
          }, 600);
        },
        { scope: "document" }
      );

      // unmount 时清理：editor 没有显式 onUnmount 钩子，
      // 我们用 disposable map 挂到 editor 实例上让 GC 顺带清理。
      // 同时 dispose 时清空 selection store。
      (editor as unknown as { __vadCleanup?: () => void }).__vadCleanup = () => {
        if (saveTimerRef.current !== null) {
          window.clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
        saveCanvasSnapshot(editor, projectRef.current, lastSnapshotJsonRef);
        stopStoreListen();
        window.clearInterval(intervalId);
        useCanvasSelectionStore.getState().clear();
      };

      editor.disposables.add(() => {
        (editor as unknown as { __vadCleanup?: () => void }).__vadCleanup?.();
      });
    },
    // 依赖 [] —— 通过 projectRef 拿最新 project；onMount 在 Tldraw 内部
    // 只会被调用一次（mount 时），所以即使 deps 变 handleMount，也不会
    // 触发重新 mount。
    []
  );

  useEffect(() => {
    projectRef.current = project;
    const editor = editorRef.current;
    if (!editor || !project) return;
    const assetCount = (project.assets ?? []).filter(
      (a) => a.status !== "discarded"
    ).length;
    const assetsJustAdded = assetCount > prevAssetCountRef.current;
    prevAssetCountRef.current = assetCount;

    syncingRef.current = true;
    try {
      syncProjectToEditor(editor, project, { zoomToFit: false });
      if (assetsJustAdded && assetCount > 0) {
        requestAnimationFrame(() => {
          zoomToBoardPrimary(editor, project);
        });
      }
    } finally {
      window.setTimeout(() => {
        syncingRef.current = false;
      }, 0);
    }
  }, [project, syncRevision]);

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

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !activePageId) return;
    const shape = editor.getCurrentPageShapes().find((candidate) => {
      if ((candidate.type as string) !== "canvas-page") return false;
      const props = (candidate as unknown as { props: { pageId: string } }).props;
      return props.pageId === activePageId;
    });
    if (!shape) return;
    editor.select(shape.id);
    editor.zoomToSelection({ animation: { duration: 180 } });
  }, [activePageId]);

  // 按 projectId 命名 persistence key；v3 = 不再持久化网页结构框
  const persistenceKey = project
    ? `vad-canvas-v3-${project.id}`
    : "vad-canvas-v3-empty";

  // ── C4: ImagePane 拖入候选图 → 转 page 内 image node ─────────────
  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    // 必须 preventDefault 才能触发 onDrop
    const hasVadAsset = e.dataTransfer.types.includes("application/x-vad-asset");
    const hasImageFile = Array.from(e.dataTransfer.items).some(
      (item) => item.kind === "file" && item.type.startsWith("image/")
    );
    if (hasVadAsset || hasImageFile) {
      e.preventDefault();
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

    const imageFile = Array.from(e.dataTransfer.files).find((file) =>
      file.type.startsWith("image/")
    );
    if (imageFile) {
      e.preventDefault();
      const reference = await fileToReferenceAsset(imageFile);
      const nextProject: ProjectFile = {
        ...proj,
        references: [...(proj.references ?? []), reference],
        updatedAt: new Date().toISOString(),
      };
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

    // 拖入素材：始终落到画布为独立 image-asset（不再挂到网页结构页）
    const asset = (proj.assets ?? []).find((a) => a.id === assetId);
    if (!asset) return;
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
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <Tldraw
        persistenceKey={persistenceKey}
        shapeUtils={SHAPE_UTILS}
        onMount={handleMount}
        hideUi
      >
        <CanvasToolbar />
        <SelectionFloatingBar onPrompt={onPrompt} onExportPage={onExportPage} />
        <CanvasMinimap />
        <CanvasFocusListener />
        <ZoomControls />
      </Tldraw>
    </div>
  );
}

/* ── 画布工具系统（替代 tldraw 原生 UI 的精简版） ───────────────── */

const CANVAS_TOOLS = [
  { id: "select", label: "选择 (V)", Icon: MousePointer2 },
  { id: "hand", label: "抓手 · 平移画布 (H)", Icon: Hand },
  { id: "frame", label: "画框 (F)", Icon: FrameIcon },
  { id: "text", label: "文本 (T)", Icon: TypeIcon },
  { id: "note", label: "便签 · 批注想法 (N)", Icon: StickyNote },
  { id: "draw", label: "画笔 · 自由标注 (D)", Icon: Pencil },
] as const;

function CanvasToolbar() {
  const editor = useEditor();
  const currentTool = useValue(
    "current tool",
    () => editor.getCurrentToolId(),
    [editor]
  );
  const canUndo = useValue("can undo", () => editor.getCanUndo(), [editor]);
  const canRedo = useValue("can redo", () => editor.getCanRedo(), [editor]);

  return (
    <div className="vad-canvas-toolbar absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 p-1.5">
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
        aria-label="重做"
        disabled={!canRedo}
        onClick={() => editor.redo()}
        className="vad-canvas-toolbar-btn grid size-9 place-items-center transition-colors duration-150 disabled:cursor-default disabled:opacity-35"
      >
        <Redo2 className="size-4" />
      </button>
    </div>
  );
}

function ZoomControls() {
  const editor = useEditor();
  const zoom = useValue("zoom level", () => editor.getZoomLevel(), [editor]);

  return (
    <div className="vad-canvas-zoom absolute bottom-6 right-4 z-10 flex items-center gap-0.5 p-1">
      <button
        type="button"
        data-tip="缩小"
        aria-label="缩小"
        onClick={() => editor.zoomOut(editor.getViewportScreenCenter(), { animation: { duration: 120 } })}
        className="vad-canvas-toolbar-btn grid size-8 place-items-center transition-colors duration-150"
      >
        <Minus className="size-3.5" />
      </button>
      <button
        type="button"
        data-tip="重置为 100%"
        onClick={() => editor.resetZoom(editor.getViewportScreenCenter(), { animation: { duration: 120 } })}
        className="vad-canvas-toolbar-btn h-8 min-w-12 px-1 text-center font-mono text-[11px] font-medium tabular-nums transition-colors duration-150"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        data-tip="放大"
        aria-label="放大"
        onClick={() => editor.zoomIn(editor.getViewportScreenCenter(), { animation: { duration: 120 } })}
        className="vad-canvas-toolbar-btn grid size-8 place-items-center transition-colors duration-150"
      >
        <Plus className="size-3.5" />
      </button>
      <button
        type="button"
        data-tip="缩放至全部内容"
        aria-label="缩放至全部内容"
        onClick={() => editor.zoomToFit({ animation: { duration: 180 } })}
        className="vad-canvas-toolbar-btn grid size-8 place-items-center transition-colors duration-150"
      >
        <Maximize className="size-3.5" />
      </button>
    </div>
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
    (project.assets ?? [])
      .filter((a) => a.status !== "discarded")
      .map((a) => a.id)
  );
  const referenceIds = new Set((project.references ?? []).map((r) => r.id));

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
      return false;
    })
    .map((s) => s.id);

  if (stale.length > 0) {
    editor.deleteShapes(stale);
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
    (a) => a.status !== "discarded"
  );

  const PARENT_GAP = 48;
  const placedMeta = new Map<string, { x: number; y: number; w: number }>();
  for (const [id, shape] of assetShapes) {
    placedMeta.set(id, {
      x: shape.x,
      y: shape.y,
      w: (shape as unknown as { props: { w: number } }).props.w,
    });
  }

  activeAssets.forEach((asset, index) => {
    const slot = board.assets[index];
    const existing = assetShapes.get(asset.id);
    let ax = force ? (slot?.x ?? 0) : (existing?.x ?? (slot?.x ?? 0));
    let ay = force ? (slot?.y ?? 0) : (existing?.y ?? (slot?.y ?? 0));

    // 新派生卡（变体/框选重绘）落在父素材右侧，便于对比
    if (!existing && !force && asset.parentAssetId) {
      const parent = placedMeta.get(asset.parentAssetId);
      if (parent) {
        ax = parent.x + parent.w + PARENT_GAP;
        ay = parent.y;
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

  (project.references ?? []).forEach((reference, index) => {
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

  if (options.zoomToFit) {
    requestAnimationFrame(() => {
      zoomToBoardPrimary(editor, project);
    });
  }
}

/** 初始视口聚焦生图/参考主视觉层，避免整页 mock 占满屏幕 */
function zoomToBoardPrimary(editor: Editor, project: ProjectFile) {
  const shapes = editor.getCurrentPageShapes();
  const assetIdSet = new Set(
    (project.assets ?? [])
      .filter((a) => a.status !== "discarded")
      .map((a) => a.id)
  );

  const primary = shapes.filter((s) => {
    const type = s.type as string;
    if (type === "image-asset") {
      const props = (s as unknown as { props: { assetId: string } }).props;
      return assetIdSet.has(props.assetId);
    }
    if (type === "reference-card") return true;
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
  snapshot: CanvasSnapshot | undefined
) {
  if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.shapes.length === 0) {
    return;
  }
  if (editor.getCurrentPageShapes().length > 0) {
    return;
  }
  const shapes = snapshot.shapes.filter((shape) => {
    const type = String((shape as { type?: string }).type ?? "");
    return (
      type !== "spec-card" &&
      type !== "handoff-card" &&
      type !== "canvas-page" &&
      type !== "flow-arrow"
    );
  });
  createCustomShapes(editor, shapes);
}

function saveCanvasSnapshot(
  editor: Editor,
  project: ProjectFile | null,
  lastSnapshotJsonRef: { current: string }
) {
  if (!project) return;
  const snapshot: CanvasSnapshot = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    shapes: editor
      .getCurrentPageShapes()
      .filter((shape) => {
        const type = String(shape.type);
        return (
          type !== "spec-card" &&
          type !== "handoff-card" &&
          type !== "canvas-page" &&
          type !== "flow-arrow"
        );
      })
      .map((shape) =>
        JSON.parse(JSON.stringify(shape)) as Record<string, unknown>
      ),
  };
  const snapshotJson = JSON.stringify(snapshot.shapes);
  if (snapshotJson === lastSnapshotJsonRef.current) return;
  lastSnapshotJsonRef.current = snapshotJson;
  useProjectStore.getState().upsert({
    ...project,
    updatedAt: snapshot.updatedAt,
    canvasSnapshot: snapshot,
  });
}

function isVadShapeType(type: string): boolean {
  return (
    type === "canvas-page" ||
    type === "image-asset" ||
    type === "reference-card" ||
    type === "flow-arrow" ||
    // 旧版残留：同步时识别并删除
    type === "spec-card" ||
    type === "handoff-card"
  );
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

async function fileToReferenceAsset(file: File): Promise<ReferenceAsset> {
  const src = await readFileAsDataUrl(file);
  const size = await readImageSize(src);
  return {
    id: nanoid(),
    label: file.name || "Uploaded reference",
    src,
    width: size.width,
    height: size.height,
    source: "upload",
    createdAt: new Date().toISOString(),
  };
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
