"use client";

/**
 * ImageAsset Shape — 画布生图卡片（Lovart 式画框）
 * 支持框选 Mark 重绘
 * @author：wangjunhua
 */

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  createShapeId,
  type RecordProps,
  type TLBaseShape,
} from "tldraw";
import { useProjectStore } from "@/store/project-store";
import {
  isValidMarkRegion,
  normalizeRegion,
  useAssetMarkStore,
  type MarkRegion,
} from "@/store/asset-mark-store";
import { displaySizeForImageAsset } from "@/lib/canvas/board-layout";
import {
  CARD_INNER_RADIUS,
  CARD_PAD,
  CARD_RADIUS,
} from "@/lib/canvas/canvas-chrome";
import { useCanvasChromePalette } from "@/lib/canvas/use-canvas-chrome";

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
};

// @ts-expect-error TLShape union does not include custom shapes by design
export class ImageAssetShapeUtil extends ShapeUtil<ImageAssetShape> {
  static override type = "image-asset" as const;

  static override props: RecordProps<ImageAssetShape> = {
    w: T.number,
    h: T.number,
    assetId: T.string,
    projectId: T.string,
    promptSnippet: T.string,
    status: T.string,
  };

  override getDefaultProps(): ImageAssetShape["props"] {
    return {
      w: 200,
      h: 200,
      assetId: "",
      projectId: "",
      promptSnippet: "",
      status: "candidate",
    };
  }

  override getGeometry(shape: ImageAssetShape): Rectangle2d {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override canResize = () => true;
  override canEditInReadonly = () => false;
  override hideRotateHandle = () => true;
  override canBind = () => false;

  override component(shape: ImageAssetShape) {
    return <ImageAssetShapeView shape={shape} />;
  }

  override getIndicatorPath(shape: ImageAssetShape): Path2D | undefined {
    if (typeof Path2D === "undefined") return undefined;
    const r = CARD_RADIUS;
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
  const c = useCanvasChromePalette();
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

  const src = asset?.src;
  const statusKey = asset?.status ?? shape.props.status ?? "candidate";
  const isGenerating = statusKey === "generating";
  const statusStyle =
    c.status[statusKey as keyof typeof c.status] ?? c.status.candidate;
  const innerW = shape.props.w - CARD_PAD * 2;
  const innerH = shape.props.h - CARD_PAD * 2 - 28;

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

  return (
    <HTMLContainer
      id={shape.id}
      style={{
        width: shape.props.w,
        height: shape.props.h,
        position: "relative",
        boxSizing: "border-box",
        padding: CARD_PAD,
        borderRadius: CARD_RADIUS,
        background: `linear-gradient(165deg, ${c.surface} 0%, ${c.surfaceMuted} 100%)`,
        border: `1px solid ${isMarkTarget ? "#EF4444" : c.border}`,
        boxShadow: isMarkTarget
          ? `0 0 0 2px rgba(239,68,68,0.25), ${c.cardShadow}`
          : c.cardShadow,
        pointerEvents: "all",
        fontFamily: "var(--font-sans, ui-sans-serif, system-ui, sans-serif)",
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
          width: innerW,
          height: Math.max(48, innerH),
          borderRadius: CARD_INNER_RADIUS,
          overflow: "hidden",
          background: c.surfaceMuted,
          boxShadow: c.matInset,
          cursor: isMarking ? "crosshair" : undefined,
          touchAction: isMarking ? "none" : undefined,
        }}
      >
        {src && !isGenerating ? (
          <img
            src={src}
            alt={shape.props.promptSnippet}
            draggable={false}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
              pointerEvents: "none",
            }}
          />
        ) : isGenerating && src ? (
          <img
            src={src}
            alt=""
            draggable={false}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
              opacity: 0.92,
              pointerEvents: "none",
            }}
          />
        ) : isGenerating ? (
          <div
            className="vad-shimmer"
            style={{
              width: "100%",
              height: "100%",
              display: "grid",
              placeItems: "center",
              color: c.textMuted,
              fontSize: 11,
            }}
          >
            生成中…
          </div>
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "grid",
              placeItems: "center",
              color: c.textMuted,
              fontSize: 11,
              letterSpacing: "0.02em",
            }}
          >
            暂无预览
          </div>
        )}
        {isGenerating ? (
          <div
            className="vad-shimmer-overlay"
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
            }}
          />
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
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            backdropFilter: "blur(8px)",
          }}
        >
          {STATUS_LABEL[statusKey] ?? statusKey}
        </div>
      </div>
      <p
        style={{
          margin: "8px 2px 0",
          padding: 0,
          fontSize: 10,
          lineHeight: 1.35,
          color: c.caption,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontWeight: 500,
        }}
      >
        {shape.props.promptSnippet || "视觉稿"}
      </p>
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
  const { w: dw, h: dh } = displaySizeForImageAsset(width, height, 268);
  const captionH = 28;
  const totalH = dh + CARD_PAD * 2 + captionH;
  return {
    id: createShapeId(),
    type: "image-asset" as const,
    x,
    y,
    props: {
      w: Math.round(dw + CARD_PAD * 2),
      h: Math.round(totalH),
      assetId,
      projectId,
      promptSnippet: prompt.slice(0, 60),
      status,
    },
  };
}
