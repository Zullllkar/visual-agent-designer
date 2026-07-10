"use client";

/**
 * ReferenceCard Shape — 参考图画布卡片
 * @author：wangjunhua
 */

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
  CARD_INNER_RADIUS,
  CARD_PAD,
  CARD_RADIUS,
} from "@/lib/canvas/canvas-chrome";
import { useCanvasChromePalette } from "@/lib/canvas/use-canvas-chrome";

export type ReferenceCardShape = TLBaseShape<
  "reference-card",
  {
    w: number;
    h: number;
    referenceId: string;
    projectId: string;
    label: string;
    source: string;
  }
>;

// @ts-expect-error TLShape union does not include custom shapes by design
export class ReferenceCardShapeUtil extends ShapeUtil<ReferenceCardShape> {
  static override type = "reference-card" as const;

  static override props: RecordProps<ReferenceCardShape> = {
    w: T.number,
    h: T.number,
    referenceId: T.string,
    projectId: T.string,
    label: T.string,
    source: T.string,
  };

  override getDefaultProps(): ReferenceCardShape["props"] {
    return {
      w: 260,
      h: 180,
      referenceId: "",
      projectId: "",
      label: "Reference",
      source: "upload",
    };
  }

  override getGeometry(shape: ReferenceCardShape): Rectangle2d {
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

  override component(shape: ReferenceCardShape) {
    return <ReferenceCardShapeView shape={shape} />;
  }

  override getIndicatorPath(shape: ReferenceCardShape): Path2D | undefined {
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

function ReferenceCardShapeView({ shape }: { shape: ReferenceCardShape }) {
  const c = useCanvasChromePalette();
  const reference = useProjectStore((s) => {
    const p = s.projects[shape.props.projectId];
    return p?.references?.find((r) => r.id === shape.props.referenceId);
  });
  const src = reference?.src;
  const label = reference?.label ?? shape.props.label;
  const innerW = shape.props.w - CARD_PAD * 2;
  const innerH = shape.props.h - CARD_PAD * 2 - 26;

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
        border: `1px dashed ${c.borderStrong}`,
        boxShadow: c.cardShadow,
        pointerEvents: "all",
        fontFamily: "var(--font-sans, ui-sans-serif, system-ui, sans-serif)",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: -10,
          left: 12,
          zIndex: 2,
          padding: "2px 10px",
          borderRadius: 999,
          background: c.primary,
          color: c.surface,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
        }}
      >
        参考
      </div>
      <div
        style={{
          width: innerW,
          height: Math.max(40, innerH),
          borderRadius: CARD_INNER_RADIUS,
          overflow: "hidden",
          background: c.surfaceMuted,
        }}
      >
        {src ? (
          <img
            src={src}
            alt={label}
            draggable={false}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "grid",
              placeItems: "center",
              color: c.textMuted,
              fontSize: 11,
            }}
          >
            参考图缺失
          </div>
        )}
      </div>
      <p
        style={{
          margin: "6px 2px 0",
          fontSize: 10,
          lineHeight: 1.35,
          color: c.caption,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontWeight: 500,
        }}
      >
        {label}
      </p>
    </HTMLContainer>
  );
}

export function makeReferenceCardShape(
  referenceId: string,
  projectId: string,
  label: string,
  source: string,
  width: number,
  height: number,
  x: number,
  y: number
) {
  const DISPLAY_MAX_W = 280;
  const DISPLAY_MAX_H = 200;
  const aspect = width / Math.max(1, height);
  let dw = Math.min(DISPLAY_MAX_W, width);
  let dh = dw / aspect;
  if (dh > DISPLAY_MAX_H) {
    dh = DISPLAY_MAX_H;
    dw = dh * aspect;
  }
  const captionH = 26;
  return {
    id: createShapeId(),
    type: "reference-card" as const,
    x,
    y,
    props: {
      w: Math.round(dw + CARD_PAD * 2),
      h: Math.round(dh + CARD_PAD * 2 + captionH),
      referenceId,
      projectId,
      label: label.slice(0, 80),
      source,
    },
  };
}
