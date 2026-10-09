"use client";
import { createShapeId, type RecordProps, type TLBaseShape } from "@/lib/tldraw-compat";

/**
 * 画布血缘连线：父图 → 派生/拆出素材
 * @author：wangjunhua
 */

import { useLayoutEffect } from "react";
import {
  CubicBezier2d,
  HTMLContainer,
  ShapeUtil,
  T,
  Vec,
  useEditor,
  useValue,
  type Editor,
  type Geometry2d,
} from "tldraw";
import { useCanvasChromePalette } from "@/lib/canvas/use-canvas-chrome";
import { assetLinkDrawStyle } from "@/lib/canvas/asset-link-style";
import { isFamilyHighlighted } from "./family-board-shape";

/** 与 SVG 绘制一致的三次贝塞尔控制点（相对 shape 本地坐标） */
function assetLinkCurvePoints(x1: number, y1: number, x2: number, y2: number) {
  const dx = Math.abs(x2 - x1);
  return {
    start: new Vec(x1, y1),
    cp1: new Vec(x1 + dx * 0.4, y1),
    cp2: new Vec(x2 - dx * 0.4, y2),
    end: new Vec(x2, y2),
  };
}

export type AssetLinkShape = TLBaseShape<
  "asset-link",
  {
    w: number;
    h: number;
    fromAssetId: string;
    toAssetId: string;
    toNoteId: string;
    label: string;
    /** 相对 shape 原点的端点 */
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }
>;

export interface LinkEndpointBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function computeAssetLinkLayout(
  from: LinkEndpointBox,
  to: LinkEndpointBox
): {
  x: number;
  y: number;
  w: number;
  h: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
} {
  // 父右中 → 子左中（最常见）；若子在左侧则反向取边，减少穿卡
  const parentRight = from.x + from.w <= to.x + to.w * 0.5;
  const x1 = parentRight ? from.x + from.w : from.x;
  const y1 = from.y + from.h / 2;
  const x2 = parentRight ? to.x : to.x + to.w;
  const y2 = to.y + to.h / 2;
  const pad = 20;
  const minX = Math.min(x1, x2) - pad;
  const minY = Math.min(y1, y2) - pad;
  const maxX = Math.max(x1, x2) + pad;
  const maxY = Math.max(y1, y2) + pad;
  return {
    x: minX,
    y: minY,
    w: Math.max(32, maxX - minX),
    h: Math.max(32, maxY - minY),
    x1: x1 - minX,
    y1: y1 - minY,
    x2: x2 - minX,
    y2: y2 - minY,
  };
}

export function assetLinkShapeId(
  fromAssetId: string,
  toAssetId: string,
  toNoteId?: string
) {
  if (toNoteId) return createShapeId(`asset-link:${fromAssetId}:note:${toNoteId}`);
  return createShapeId(`asset-link:${fromAssetId}:${toAssetId}`);
}

export function makeAssetLinkShape(input: {
  fromAssetId: string;
  toAssetId?: string;
  toNoteId?: string;
  label: string;
  from: LinkEndpointBox;
  to: LinkEndpointBox;
}) {
  const toAssetId = input.toAssetId ?? "";
  const toNoteId = input.toNoteId ?? "";
  const layout = computeAssetLinkLayout(input.from, input.to);
  return {
    id: assetLinkShapeId(input.fromAssetId, toAssetId, toNoteId || undefined),
    type: "asset-link" as const,
    x: layout.x,
    y: layout.y,
    props: {
      w: layout.w,
      h: layout.h,
      fromAssetId: input.fromAssetId,
      toAssetId,
      toNoteId,
      label: input.label,
      x1: layout.x1,
      y1: layout.y1,
      x2: layout.x2,
      y2: layout.y2,
    },
  };
}

function findEndpointBox(
  editor: Editor,
  target: { assetId?: string; noteId?: string }
): LinkEndpointBox | null {
  for (const shape of editor.getCurrentPageShapes()) {
    const type = shape.type as string;
    if (target.noteId && type === "text-note") {
      const props = shape as unknown as {
        props: { noteId: string; w: number; h: number };
      };
      if (props.props.noteId !== target.noteId) continue;
      return { x: shape.x, y: shape.y, w: props.props.w, h: props.props.h };
    }
    if (target.assetId && type === "image-asset") {
      const props = shape as unknown as {
        props: { assetId: string; w: number; h: number };
      };
      if (props.props.assetId !== target.assetId) continue;
      return { x: shape.x, y: shape.y, w: props.props.w, h: props.props.h };
    }
  }
  return null;
}

export class AssetLinkShapeUtil extends ShapeUtil<AssetLinkShape> {
  static type = "asset-link" as any;

  static props: RecordProps<AssetLinkShape> = {
    w: T.number,
    h: T.number,
    fromAssetId: T.string,
    toAssetId: T.string,
    toNoteId: T.string.optional(),
    label: T.string,
    x1: T.number,
    y1: T.number,
    x2: T.number,
    y2: T.number,
  };

  getDefaultProps(): AssetLinkShape["props"] {
    return {
      w: 120,
      h: 40,
      fromAssetId: "",
      toAssetId: "",
      toNoteId: "",
      label: "",
      x1: 0,
      y1: 20,
      x2: 120,
      y2: 20,
    };
  }

  getGeometry(shape: AssetLinkShape): Geometry2d {
    const { x1, y1, x2, y2 } = shape.props;
    const { start, cp1, cp2, end } = assetLinkCurvePoints(x1, y1, x2, y2);
    // 曲线几何：点选落在线上，而不是整块包围盒
    return new CubicBezier2d({
      start,
      cp1,
      cp2,
      end,
    });
  }

  canResize = () => false;
  canEditInReadonly = () => false;
  hideRotateHandle = () => true;
  canBind = () => false;
  isAspectRatioLocked = () => false;
  canDuplicate = () => false;
  /** 连线只高亮路径，不出现整体蓝框 */
  hideSelectionBoundsBg = () => true;
  hideSelectionBoundsFg = () => true;

  component(shape: AssetLinkShape) {
    return <AssetLinkShapeView shape={shape} />;
  }

  getIndicatorPath(shape: AssetLinkShape): Path2D | undefined {
    if (typeof Path2D === "undefined") return undefined;
    const { x1, y1, x2, y2 } = shape.props;
    const { start, cp1, cp2, end } = assetLinkCurvePoints(x1, y1, x2, y2);
    const p = new Path2D();
    p.moveTo(start.x, start.y);
    p.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, end.x, end.y);
    return p;
  }
}

function AssetLinkShapeView({ shape }: { shape: AssetLinkShape }) {
  const editor = useEditor();
  const c = useCanvasChromePalette();
  const label = shape.props.label;

  // 订阅父/子图实时坐标：拖拽时每帧重算，连线跟着走
  const live = useValue(
    `asset-link-follow:${shape.props.fromAssetId}:${shape.props.toAssetId}:${shape.props.toNoteId ?? ""}`,
    () => {
      const from = findEndpointBox(editor, { assetId: shape.props.fromAssetId });
      const to = shape.props.toNoteId
        ? findEndpointBox(editor, { noteId: shape.props.toNoteId })
        : findEndpointBox(editor, { assetId: shape.props.toAssetId });
      if (!from || !to) return null;
      return computeAssetLinkLayout(from, to);
    },
    [editor, shape.props.fromAssetId, shape.props.toAssetId, shape.props.toNoteId]
  );

  useLayoutEffect(() => {
    if (!live) return;
    if (
      Math.abs(shape.x - live.x) < 0.5 &&
      Math.abs(shape.y - live.y) < 0.5 &&
      Math.abs(shape.props.w - live.w) < 0.5 &&
      Math.abs(shape.props.h - live.h) < 0.5 &&
      Math.abs(shape.props.x1 - live.x1) < 0.5 &&
      Math.abs(shape.props.y1 - live.y1) < 0.5 &&
      Math.abs(shape.props.x2 - live.x2) < 0.5 &&
      Math.abs(shape.props.y2 - live.y2) < 0.5
    ) {
      return;
    }
    editor.updateShapes([
      {
        id: shape.id,
        type: "asset-link" as any,
        x: live.x,
        y: live.y,
        props: {
          w: live.w,
          h: live.h,
          fromAssetId: shape.props.fromAssetId,
          toAssetId: shape.props.toAssetId,
          toNoteId: shape.props.toNoteId ?? "",
          label: shape.props.label,
          x1: live.x1,
          y1: live.y1,
          x2: live.x2,
          y2: live.y2,
        },
      },
    ]);
  }, [editor, live, shape]);

  const geom = live ?? {
    w: shape.props.w,
    h: shape.props.h,
    x1: shape.props.x1,
    y1: shape.props.y1,
    x2: shape.props.x2,
    y2: shape.props.y2,
  };
  const { w, h, x1, y1, x2, y2 } = geom;
  // 若 shape 原点尚未更新，先用位移把线画到正确页坐标
  const drawDx = live ? live.x - shape.x : 0;
  const drawDy = live ? live.y - shape.y : 0;

  const markerId = `asset-link-head-${shape.id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const highlighted = useValue(
    `asset-link-hi:${shape.props.fromAssetId}:${shape.props.toAssetId}`,
    () => isFamilyHighlighted(editor, [shape.props.fromAssetId, shape.props.toAssetId]),
    [editor, shape.props.fromAssetId, shape.props.toAssetId]
  );
  const dashed = Boolean(shape.props.toNoteId);
  const style = assetLinkDrawStyle(highlighted);
  const dx = Math.abs(x2 - x1);
  const c1x = x1 + dx * 0.4;
  const c2x = x2 - dx * 0.4;
  const path = `M ${x1} ${y1} C ${c1x} ${y1}, ${c2x} ${y2}, ${x2} ${y2}`;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;

  return (
    <HTMLContainer
      id={shape.id}
      className="vad-asset-link"
      style={{
        width: Math.max(24, w),
        height: Math.max(24, h),
        overflow: "visible",
        pointerEvents: "none",
        transform:
          drawDx || drawDy
            ? `translate(${drawDx}px, ${drawDy}px)`
            : undefined,
      }}
    >
      <svg
        width={Math.max(24, w)}
        height={Math.max(24, h)}
        viewBox={`0 0 ${Math.max(24, w)} ${Math.max(24, h)}`}
      >
        <defs>
          <marker
            id={markerId}
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M 0 0 L 8 4 L 0 8 z" fill={c.flowStroke} opacity={style.markerOpacity} />
          </marker>
        </defs>
        <path
          d={path}
          fill="none"
          stroke={c.flowStroke}
          strokeWidth={style.strokeWidth}
          strokeLinecap="round"
          strokeDasharray={dashed ? "6 7" : undefined}
          strokeOpacity={style.strokeOpacity}
          markerEnd={!dashed && style.showMarker ? `url(#${markerId})` : undefined}
        />
        {style.showLabel && label ? (
          <g>
            <rect
              x={midX - Math.min(36, label.length * 5 + 8) / 2}
              y={midY - 9}
              width={Math.min(72, label.length * 5 + 16)}
              height={16}
              rx={8}
              fill={c.surface}
              stroke={c.border}
              strokeWidth={1}
              opacity={0.92}
            />
            <text
              x={midX}
              y={midY + 3}
              textAnchor="middle"
              fontSize="9"
              fontWeight="600"
              fill={c.flowLabel}
              fontFamily="var(--font-sans, ui-sans-serif, system-ui, sans-serif)"
            >
              {label}
            </text>
          </g>
        ) : null}
      </svg>
    </HTMLContainer>
  );
}

export function linkLabelForAsset(asset: {
  source?: string;
  role?: string;
  materialSlotId?: string;
}): string {
  if (asset.source === "materialized") {
    return asset.role || asset.materialSlotId || "素材";
  }
  if (asset.source === "edited") return "变体";
  return "派生";
}
