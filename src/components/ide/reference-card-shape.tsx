"use client";
import { createShapeId, type RecordProps, type TLBaseShape } from "@/lib/tldraw-compat";

/**
 * ReferenceCard Shape — Lovart 式直出参考图
 * @author：wangjunhua
 */

import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
} from "tldraw";
import { useProjectStore } from "@/store/project-store";
import { useCanvasChromePalette } from "@/lib/canvas/use-canvas-chrome";

const PHOTO_RADIUS = 12;

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

export class ReferenceCardShapeUtil extends ShapeUtil<ReferenceCardShape> {
  static type = "reference-card" as any;

  static props: RecordProps<ReferenceCardShape> = {
    w: T.number,
    h: T.number,
    referenceId: T.string,
    projectId: T.string,
    label: T.string,
    source: T.string,
  };

  getDefaultProps(): ReferenceCardShape["props"] {
    return {
      w: 260,
      h: 180,
      referenceId: "",
      projectId: "",
      label: "Reference",
      source: "upload",
    };
  }

  getGeometry(shape: ReferenceCardShape): Rectangle2d {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  canResize = () => true;
  canEditInReadonly = () => false;
  hideRotateHandle = () => true;
  canBind = () => false;

  component(shape: ReferenceCardShape) {
    return <ReferenceCardShapeView shape={shape} />;
  }

  getIndicatorPath(shape: ReferenceCardShape): Path2D | undefined {
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

function ReferenceCardShapeView({ shape }: { shape: ReferenceCardShape }) {
  const c = useCanvasChromePalette();
  const reference = useProjectStore((s) => {
    const p = s.projects[shape.props.projectId];
    return p?.references?.find((r) => r.id === shape.props.referenceId);
  });
  const src = reference?.src;
  const label = reference?.label ?? shape.props.label;

  return (
    <HTMLContainer
      id={shape.id}
      className="vad-artwork-photo"
      style={{
        width: shape.props.w,
        height: shape.props.h,
        position: "relative",
        boxSizing: "border-box",
        padding: 0,
        borderRadius: PHOTO_RADIUS,
        overflow: "hidden",
        background: c.surfaceMuted,
        border: "none",
        boxShadow: c.cardShadow,
        pointerEvents: "all",
      }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={label}
          draggable={false}
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
            display: "grid",
            placeItems: "center",
            color: c.textMuted,
            fontSize: 11,
          }}
        >
          参考图缺失
        </div>
      )}
      <div
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          padding: "2px 8px",
          borderRadius: 999,
          background: "rgba(15,15,18,0.62)",
          color: "#fff",
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.06em",
          backdropFilter: "blur(6px)",
          pointerEvents: "none",
        }}
      >
        参考
      </div>
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
  return {
    id: createShapeId(),
    type: "reference-card" as const,
    x,
    y,
    props: {
      w: Math.round(dw),
      h: Math.round(dh),
      referenceId,
      projectId,
      label,
      source,
    },
  };
}
