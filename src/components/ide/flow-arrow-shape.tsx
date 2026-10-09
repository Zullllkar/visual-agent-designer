"use client";
import { createShapeId, type RecordProps, type TLBaseShape } from "@/lib/tldraw-compat";

import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
} from "tldraw";
import { useCanvasChromePalette } from "@/lib/canvas/use-canvas-chrome";

export type FlowArrowShape = TLBaseShape<
  "flow-arrow",
  {
    w: number;
    h: number;
    flowId: string;
    fromPageId: string;
    toPageId: string;
    label: string;
  }
>;

export class FlowArrowShapeUtil extends ShapeUtil<FlowArrowShape> {
  static type = "flow-arrow" as any;

  static props: RecordProps<FlowArrowShape> = {
    w: T.number,
    h: T.number,
    flowId: T.string,
    fromPageId: T.string,
    toPageId: T.string,
    label: T.string,
  };

  getDefaultProps(): FlowArrowShape["props"] {
    return {
      w: 120,
      h: 32,
      flowId: "",
      fromPageId: "",
      toPageId: "",
      label: "Next",
    };
  }

  getGeometry(shape: FlowArrowShape): Rectangle2d {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: false,
    });
  }

  canResize = () => false;
  canEditInReadonly = () => false;
  hideRotateHandle = () => true;
  canBind = () => false;

  component(shape: FlowArrowShape) {
    return <FlowArrowShapeView shape={shape} />;
  }

  getIndicatorPath(shape: FlowArrowShape): Path2D | undefined {
    if (typeof Path2D === "undefined") return undefined;
    const p = new Path2D();
    p.rect(0, 0, shape.props.w, shape.props.h);
    return p;
  }
}

function FlowArrowShapeView({ shape }: { shape: FlowArrowShape }) {
  const c = useCanvasChromePalette();
  const w = Math.max(24, shape.props.w);
  const h = Math.max(24, shape.props.h);
  const midY = h / 2;
  const markerId = `flow-arrow-head-${shape.id}`;

  return (
    <HTMLContainer
      id={shape.id}
      style={{
        width: w,
        height: h,
        overflow: "visible",
        pointerEvents: "none",
      }}
    >
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <defs>
          <marker
            id={markerId}
            markerWidth="10"
            markerHeight="10"
            refX="8"
            refY="5"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={c.flowStroke} />
          </marker>
        </defs>
        <path
          d={`M 4 ${midY} C ${w * 0.35} ${midY}, ${w * 0.65} ${midY}, ${w - 10} ${midY}`}
          fill="none"
          stroke={c.flowStroke}
          strokeWidth="2"
          strokeLinecap="round"
          strokeOpacity={0.85}
          markerEnd={`url(#${markerId})`}
        />
        {shape.props.label ? (
          <text
            x={w / 2}
            y={Math.max(10, midY - 8)}
            textAnchor="middle"
            fontSize="10"
            fontWeight="600"
            fill={c.flowLabel}
            paintOrder="stroke"
            stroke={c.surface}
            strokeWidth="5"
            fontFamily="var(--font-sans, ui-sans-serif, system-ui, sans-serif)"
          >
            {shape.props.label}
          </text>
        ) : null}
      </svg>
    </HTMLContainer>
  );
}

export function makeFlowArrowShape(
  flowId: string,
  fromPageId: string,
  toPageId: string,
  label: string,
  x: number,
  y: number,
  w: number,
  h: number
) {
  return {
    id: createShapeId(),
    type: "flow-arrow" as const,
    x,
    y,
    props: {
      w,
      h,
      flowId,
      fromPageId,
      toPageId,
      label,
    },
  };
}
