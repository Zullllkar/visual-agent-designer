"use client";
import { createShapeId, type RecordProps, type TLBaseShape } from "@/lib/tldraw-compat";

/**
 * ImageAsset Shape — Lovart 式直出图（图即 shape，无垫衬画框）
 * 支持框选 Mark 重绘
 * @author：wangjunhua
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Trash2, Image as ImageIcon } from "lucide-react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  Rectangle2d,
  T,
  resizeBox,
  useEditor,
  useValue,
  type Geometry2d,
  type TLResizeInfo,
} from "tldraw";
import { useProjectStore } from "@/store/project-store";
import { useCanvasSelectionStore } from "@/store/canvas-selection-store";
import { useCanvasUiStore } from "@/store/canvas-ui-store";
import {
  isValidMarkRegion,
  normalizeRegion,
  useAssetMarkStore,
  type MarkRegion,
} from "@/store/asset-mark-store";
import { displaySizeForImageAsset } from "@/lib/canvas/board-layout";
import { shouldApplyNaturalImageSize } from "@/lib/canvas/generating-placeholder";
import { isEmptySpawnSlot, shouldShowSpawnSlotLoading } from "@/lib/canvas/spawn-child-asset";
import { useCanvasChromePalette } from "@/lib/canvas/use-canvas-chrome";
import { discardAssetsInProject } from "@/lib/project/discard-assets";
import { GeneratingArtworkFace } from "@/components/generating-artwork-face";
import { ImplementationBadge } from "./implementation-badge";

/** Lovart 式：图即 shape，轻圆角，无垫衬画框 */
const PHOTO_RADIUS = 12;

export type ImageAssetShape = TLBaseShape<
  "image-asset",
  {
    w: number;
    h: number;
    assetId: string;
    projectId: string;
    promptSnippet: string;
    status: string;
  }
>;

const STATUS_LABEL: Record<string, string> = {
  generating: "生成中",
  candidate: "候选",
  starred: "收藏",
  used: "已用",
  discarded: "废弃",
  failed: "失败",
  cancelled: "已取消",
};

export class ImageAssetShapeUtil extends BaseBoxShapeUtil<ImageAssetShape> {
  static type = "image-asset" as any;

  static props: RecordProps<ImageAssetShape> = {
    w: T.number,
    h: T.number,
    assetId: T.string,
    projectId: T.string,
    promptSnippet: T.string,
    status: T.string,
  };

  getDefaultProps(): ImageAssetShape["props"] {
    return {
      w: 200,
      h: 200,
      assetId: "",
      projectId: "",
      promptSnippet: "",
      status: "candidate",
    };
  }

  getGeometry(shape: ImageAssetShape): Geometry2d {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  canResize = () => true;
  isAspectRatioLocked = () => true;
  canEditInReadonly = () => false;
  hideRotateHandle = () => true;
  canBind = () => false;
  canDuplicate = () => false;
  canDelete = () => true;

  onResize(shape: ImageAssetShape, info: TLResizeInfo<ImageAssetShape>) {
    return resizeBox(shape, info);
  }

  // override onDoubleClick: custom double-click behavior for the asset shape
  onDoubleClick(shape: ImageAssetShape) {
    this.editor.select(shape.id);
    this.editor.zoomToSelection({ animation: { duration: 220 } });
  }

  component(shape: ImageAssetShape) {
    return <ImageAssetShapeView shape={shape} />;
  }

  getIndicatorPath(shape: ImageAssetShape): Path2D | undefined {
    if (typeof Path2D === "undefined") return undefined;
    const r = PHOTO_RADIUS;
    const w = shape.props.w;
    const h = shape.props.h;
    const p = new Path2D();
    p.moveTo(r, 0);
    p.lineTo(w - r, 0);
    p.quadraticCurveTo(w, 0, w, r);
    p.lineTo(w, h - r);
    p.quadraticCurveTo(w, h, w - r, h);
    p.lineTo(r, h);
    p.quadraticCurveTo(0, h, 0, h - r);
    p.lineTo(0, r);
    p.quadraticCurveTo(0, 0, r, 0);
    p.closePath();
    return p;
  }
}

function ImageAssetShapeView({ shape }: { shape: ImageAssetShape }) {
  const editor = useEditor();
  const c = useCanvasChromePalette();
  const upsertProject = useProjectStore((s) => s.upsert);
  const asset = useProjectStore((s) => {
    const p = s.projects[shape.props.projectId];
    return p?.assets?.find((a) => a.id === shape.props.assetId);
  });
  const markMode = useAssetMarkStore((s) => s.mode);
  const markAssetId = useAssetMarkStore((s) => s.assetId);
  const draft = useAssetMarkStore((s) => s.draft);
  const region = useAssetMarkStore((s) => s.region);
  const setDraft = useAssetMarkStore((s) => s.setDraft);
  const commitRegion = useAssetMarkStore((s) => s.commitRegion);

  const isMarkTarget =
    (markMode === "marking" || markMode === "instruct") &&
    markAssetId === shape.props.assetId;
  const isMarking = markMode === "marking" && markAssetId === shape.props.assetId;

  const dragOrigin = useRef<{ x: number; y: number } | null>(null);
  const mediaRef = useRef<HTMLDivElement | null>(null);

  const selection = useCanvasSelectionStore((s) => s.selection);
  const isDimmed =
    selection?.kind === "asset" &&
    Boolean(selection.assetId) &&
    selection.assetId !== shape.props.assetId &&
    !(selection.assetIds ?? []).includes(shape.props.assetId);

  const isSelected = useValue(
    "image-asset selected",
    () => editor.getSelectedShapeIds().includes(shape.id),
    [editor, shape.id]
  );

  const src = asset?.src;
  const parentSrc = useProjectStore((s) => {
    const parentId = asset?.parentAssetId;
    if (!parentId) return undefined;
    const parent = s.projects[shape.props.projectId]?.assets?.find(
      (item) => item.id === parentId
    );
    const next = parent?.src;
    if (!next || next.startsWith("data:image/svg+xml")) return undefined;
    return next;
  });
  const statusKey = asset?.status ?? shape.props.status ?? "candidate";
  const isGenerating = statusKey === "generating";
  const isFailed = statusKey === "failed" || statusKey === "cancelled";
  const isEmptySlot = asset ? isEmptySpawnSlot(asset) : !src;
  const agentRunBusy = useCanvasUiStore((s) => s.agentRunBusy);
  const imageJobBusy = useCanvasUiStore((s) => s.imageJobBusy);
  const relatedAssets = useProjectStore(
    (s) => s.projects[shape.props.projectId]?.assets ?? []
  );
  const showLoading =
    isGenerating ||
    shouldShowSpawnSlotLoading({
      asset,
      assets: relatedAssets,
      agentRunBusy,
      imageJobBusy,
    });
  const canRemovePlaceholder = isFailed || showLoading || isEmptySlot;
  const showStatusChip = showLoading || isFailed;
  const statusStyle =
    c.status[
      (showLoading ? "generating" : statusKey) as keyof typeof c.status
    ] ?? c.status.candidate;

  const wasGeneratingRef = useRef(showLoading);
  const [justRevealed, setJustRevealed] = useState(false);
  const fittedNaturalKeyRef = useRef<string | null>(null);

  useEffect(() => {
    // src 变化时允许重新按真实像素校正
    fittedNaturalKeyRef.current = null;
  }, [src]);

  useEffect(() => {
    if (wasGeneratingRef.current && !showLoading && Boolean(src) && !isFailed) {
      setJustRevealed(true);
      const t = window.setTimeout(() => setJustRevealed(false), 720);
      wasGeneratingRef.current = showLoading;
      return () => window.clearTimeout(t);
    }
    wasGeneratingRef.current = showLoading;
  }, [showLoading, isFailed, src]);

  const fitShapeToNaturalSize = useCallback(
    (naturalW: number, naturalH: number) => {
      if (
        !shouldApplyNaturalImageSize({
          src,
          naturalWidth: naturalW,
          naturalHeight: naturalH,
          currentWidth: asset?.width,
          currentHeight: asset?.height,
        }) ||
        !src
      ) {
        return;
      }
      const key = `${shape.id}:${src.slice(0, 64)}:${naturalW}x${naturalH}`;
      if (fittedNaturalKeyRef.current === key) return;

      const { w, h } = displaySizeForImageAsset(naturalW, naturalH);
      const curW = shape.props.w;
      const curH = shape.props.h;
      const aspectOff =
        Math.abs(curW / Math.max(1, curH) - w / Math.max(1, h)) > 0.03;
      const sizeOff = Math.abs(curW - w) > 6 || Math.abs(curH - h) > 6;
      if (!aspectOff && !sizeOff) {
        fittedNaturalKeyRef.current = key;
        return;
      }

      fittedNaturalKeyRef.current = key;
    editor.updateShapes([
        {
          id: shape.id,
          type: "image-asset" as any,
          props: { w, h },
        },
      ]);

      // 纠正资产元数据，避免下次 sync 又用「请求尺寸」把比例改歪
      const project =
        useProjectStore.getState().projects[shape.props.projectId];
      const assetId = asset?.id ?? shape.props.assetId;
      if (
        project &&
        assetId &&
        (asset?.width !== naturalW || asset?.height !== naturalH)
      ) {
        upsertProject({
          ...project,
          assets: (project.assets ?? []).map((a) =>
            a.id === assetId
              ? { ...a, width: naturalW, height: naturalH }
              : a
          ),
          updatedAt: new Date().toISOString(),
        });
      }
    },
    [
      asset?.height,
      asset?.id,
      asset?.width,
      editor,
      shape.id,
      shape.props.assetId,
      shape.props.h,
      shape.props.projectId,
      shape.props.w,
      src,
      upsertProject,
    ]
  );

  const toNorm = useCallback((clientX: number, clientY: number) => {
    const el = mediaRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
    };
  }, []);

  const onPointerDown = (e: ReactPointerEvent) => {
    if (!isMarking) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = toNorm(e.clientX, e.clientY);
    dragOrigin.current = p;
    setDraft({ x: p.x, y: p.y, w: 0, h: 0 });
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!isMarking || !dragOrigin.current) return;
    e.stopPropagation();
    const p = toNorm(e.clientX, e.clientY);
    setDraft(
      normalizeRegion(dragOrigin.current.x, dragOrigin.current.y, p.x, p.y)
    );
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    if (!isMarking || !dragOrigin.current) return;
    e.stopPropagation();
    const p = toNorm(e.clientX, e.clientY);
    const next = normalizeRegion(
      dragOrigin.current.x,
      dragOrigin.current.y,
      p.x,
      p.y
    );
    dragOrigin.current = null;
    if (isValidMarkRegion(next)) {
      commitRegion(next);
    } else {
      setDraft(null);
    }
  };

  const visibleRegion: MarkRegion | null =
    draft ?? (isMarkTarget ? region : null);

  const removeAsset = useCallback(() => {
    const assetId = asset?.id ?? shape.props.assetId;
    if (!assetId) return;
    const project = useProjectStore.getState().projects[shape.props.projectId];
    if (project) {
      // 必须标记 discarded，不能 filter 删除——upsert 会把缺失 id 合并回来
      upsertProject(discardAssetsInProject(project, [assetId]));
    }
    if (markAssetId === assetId) {
      useAssetMarkStore.getState().cancel();
    }
    editor.selectNone();
    useCanvasSelectionStore.getState().clear();
    editor.deleteShapes([shape.id]);
  }, [
    asset?.id,
    editor,
    markAssetId,
    shape.id,
    shape.props.assetId,
    shape.props.projectId,
    upsertProject,
  ]);

  return (
    <HTMLContainer
      id={shape.id}
      className={
        "vad-artwork-photo" +
        (isSelected ? " vad-artwork-photo--selected" : "") +
        (isFailed ? " vad-artwork-photo--failed" : "") +
        (justRevealed ? " vad-artwork-photo--reveal" : "") +
        (isMarkTarget ? " vad-artwork-photo--mark" : "") +
        (isDimmed ? " vad-artwork-photo--dimmed" : "") +
        (isEmptySlot ? " vad-artwork-photo--empty" : "")
      }
      style={{
        width: shape.props.w,
        height: shape.props.h,
        position: "relative",
        boxSizing: "border-box",
        padding: 0,
        borderRadius: PHOTO_RADIUS,
        overflow: "visible",
        background: c.surfaceMuted,
        border: isEmptySlot && !showLoading ? `1.5px dashed ${c.border}` : "none",
        boxShadow: isMarkTarget
          ? `0 0 0 2px #EF4444, ${c.cardShadow}`
          : isSelected
            ? `0 0 0 2px ${c.primary}, ${c.cardShadowHover}`
            : isEmptySlot
              ? "none"
              : c.cardShadow,
        pointerEvents: "none",
        opacity: isFailed ? 0.78 : 1,
      }}
    >
      <div
        ref={mediaRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          dragOrigin.current = null;
        }}
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          overflow: "hidden",
          borderRadius: PHOTO_RADIUS,
          cursor: isMarking ? "crosshair" : undefined,
          touchAction: isMarking ? "none" : undefined,
          pointerEvents: isMarking ? "all" : "none",
        }}
      >
        {showLoading ? (
          <GeneratingArtworkFace ghostSrc={parentSrc} />
        ) : src ? (
          <img
            src={src}
            alt={shape.props.promptSnippet}
            draggable={false}
            onLoad={(e) => {
              fitShapeToNaturalSize(
                e.currentTarget.naturalWidth,
                e.currentTarget.naturalHeight
              );
            }}
            ref={(node) => {
              if (node?.complete && node.naturalWidth > 0) {
                fitShapeToNaturalSize(node.naturalWidth, node.naturalHeight);
              }
            }}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              display: "block",
              pointerEvents: "none",
            }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              color: c.textMuted,
              fontSize: 11,
              letterSpacing: "0.02em",
              textAlign: "center",
              padding: 16,
              boxSizing: "border-box",
            }}
          >
            {statusKey === "failed" ? (
              "生成失败"
            ) : statusKey === "cancelled" ? (
              "已取消"
            ) : isEmptySlot ? (
              <>
                <span
                  style={{
                    display: "grid",
                    placeItems: "center",
                    width: 52,
                    height: 52,
                    borderRadius: 16,
                    background: c.surface,
                    border: `1px solid ${c.border}`,
                    color: c.textMuted,
                    boxShadow: c.cardShadow,
                  }}
                >
                  <ImageIcon size={24} strokeWidth={1.5} aria-hidden />
                </span>
                <span style={{ fontWeight: 600, color: c.text, fontSize: 12 }}>
                  图片
                </span>
                <span style={{ fontSize: 10, color: c.textMuted, maxWidth: 140 }}>
                  在右侧描述后生成
                </span>
              </>
            ) : (
              "暂无预览"
            )}
          </div>
        )}
        {isFailed && src ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(15,15,18,0.45)",
              display: "grid",
              placeItems: "center",
              color: "#fff",
              fontSize: 11,
              fontWeight: 600,
              pointerEvents: "none",
            }}
          >
            {statusKey === "cancelled" ? "已取消" : "生成失败"}
          </div>
        ) : null}
        {canRemovePlaceholder ? (
          <button
            type="button"
            className="vad-artwork-photo-remove"
            onPointerDown={(event) => {
              event.stopPropagation();
              event.preventDefault();
              editor.markEventAsHandled(event);
            }}
            onPointerUp={(event) => {
              event.stopPropagation();
              event.preventDefault();
              editor.markEventAsHandled(event);
              removeAsset();
            }}
            style={{
              position: "absolute",
              right: 8,
              top: 8,
              display: "grid",
              width: 24,
              height: 24,
              placeItems: "center",
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.35)",
              background: "rgba(15,15,18,0.72)",
              color: "#FECACA",
              cursor: "pointer",
              pointerEvents: "auto",
            }}
            aria-label="移除占位"
            title="移除"
          >
            <Trash2 size={12} />
          </button>
        ) : null}
        {isMarking ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0,0,0,0.28)",
              pointerEvents: "none",
            }}
          />
        ) : null}
        {visibleRegion && isValidMarkRegion(visibleRegion) ? (
          <div
            style={{
              position: "absolute",
              left: `${visibleRegion.x * 100}%`,
              top: `${visibleRegion.y * 100}%`,
              width: `${visibleRegion.w * 100}%`,
              height: `${visibleRegion.h * 100}%`,
              border: "2px solid #EF4444",
              background: "rgba(239,68,68,0.18)",
              boxShadow: "0 0 0 1px rgba(252,165,165,0.8) inset",
              pointerEvents: "none",
            }}
          />
        ) : null}
        {isMarking ? (
          <div
            style={{
              position: "absolute",
              left: 8,
              bottom: 8,
              padding: "3px 8px",
              borderRadius: 6,
              background: "rgba(15,15,18,0.72)",
              color: "#fff",
              fontSize: 10,
              fontWeight: 600,
              pointerEvents: "none",
            }}
          >
            拖拽框选要重绘的区域
          </div>
        ) : null}
        {showStatusChip ? (
          <div
            style={{
              position: "absolute",
              top: 8,
              left: 8,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "3px 8px",
              borderRadius: 999,
              background: statusStyle.bg,
              color: statusStyle.fg,
              border: `1px solid ${statusStyle.border}`,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.04em",
              backdropFilter: "blur(8px)",
            }}
          >
            {showLoading
              ? STATUS_LABEL.generating
              : (STATUS_LABEL[statusKey] ?? statusKey)}
          </div>
        ) : null}
        {!showLoading && !isFailed && asset?.source !== "materialized" ? (
          <ImplementationBadge projectId={shape.props.projectId} assetId={shape.props.assetId} />
        ) : null}
      </div>
    </HTMLContainer>
  );
}

export function makeImageAssetShape(
  assetId: string,
  projectId: string,
  prompt: string,
  status: string,
  width: number,
  height: number,
  x: number,
  y: number
) {
  const { w: dw, h: dh } = displaySizeForImageAsset(width, height);
  return {
    id: createShapeId(),
    type: "image-asset" as const,
    x,
    y,
    props: {
      w: Math.round(dw),
      h: Math.round(dh),
      assetId,
      projectId,
      promptSnippet: prompt.slice(0, 60),
      status,
    },
  };
}
