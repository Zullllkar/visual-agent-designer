"use client";
import { createShapeId, type RecordProps, type TLBaseShape } from "@/lib/tldraw-compat";

/**
 * HandoffCard Shape — 设计交付画布卡片（Lovart 式交付物）
 * --------------------------------------------------------------
 * 在画布上展示交付包内容清单，一键触发 Handoff 导出弹窗，
 * 让"交付"成为画布上可见的最后一站，而不是藏在顶栏按钮里。
 *
 * @author：wangjunhua
 */

import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
} from "tldraw";
import { useProjectStore } from "@/store/project-store";
import { useCanvasUiStore } from "@/store/canvas-ui-store";
import { CARD_PAD, CARD_RADIUS } from "@/lib/canvas/canvas-chrome";
import { useCanvasChromePalette } from "@/lib/canvas/use-canvas-chrome";
import { CardBadge, roundedRectPath } from "./spec-card-shape";

export type HandoffCardShape = TLBaseShape<
  "handoff-card",
  {
    w: number;
    h: number;
    projectId: string;
  }
>;

export const HANDOFF_CARD_W = 300;
export const HANDOFF_CARD_H = 236;

export class HandoffCardShapeUtil extends ShapeUtil<HandoffCardShape> {
  static type = "handoff-card" as any;

  static props: RecordProps<HandoffCardShape> = {
    w: T.number,
    h: T.number,
    projectId: T.string,
  };

  getDefaultProps(): HandoffCardShape["props"] {
    return { w: HANDOFF_CARD_W, h: HANDOFF_CARD_H, projectId: "" };
  }

  getGeometry(shape: HandoffCardShape): Rectangle2d {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  canResize = () => false;
  canEditInReadonly = () => false;
  hideRotateHandle = () => true;
  canBind = () => false;

  component(shape: HandoffCardShape) {
    return <HandoffCardShapeView shape={shape} />;
  }

  getIndicatorPath(shape: HandoffCardShape): Path2D | undefined {
    return roundedRectPath(shape.props.w, shape.props.h);
  }
}

function HandoffCardShapeView({ shape }: { shape: HandoffCardShape }) {
  const c = useCanvasChromePalette();
  const project = useProjectStore(
    (s) => s.projects[shape.props.projectId] ?? null
  );
  const requestHandoff = useCanvasUiStore((s) => s.requestHandoff);

  const pageCount = project?.pages.length ?? 0;
  const assetCount = (project?.assets ?? []).filter(
    (a) => a.status !== "discarded"
  ).length;

  const items = [
    `页面结构 Canvas JSON（${pageCount} 页）`,
    `生图资产与 prompts（${assetCount} 张）`,
    "设计 token 与规范摘要",
    "coding agent 任务上下文",
  ];

  return (
    <HTMLContainer
      id={shape.id}
      style={{
        width: shape.props.w,
        height: shape.props.h,
        position: "relative",
        boxSizing: "border-box",
        padding: CARD_PAD + 10,
        borderRadius: CARD_RADIUS,
        background: c.surface,
        border: `1px solid ${c.border}`,
        boxShadow: c.cardShadow,
        pointerEvents: "all",
        overflow: "hidden",
        fontFamily: "var(--font-sans, ui-sans-serif, system-ui, sans-serif)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <CardBadge color={c.primary} fg={c.surface} label="设计交付" />

      <p
        style={{
          margin: "6px 0 0",
          fontSize: 12,
          fontWeight: 700,
          color: c.text,
        }}
      >
        Handoff 交付包
       </p>

      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {items.map((item) => (
          <li
            key={item}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              fontSize: 11,
              color: c.textMuted,
            }}
          >
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: 999,
                flexShrink: 0,
                display: "grid",
                placeItems: "center",
                background: c.status.used.bg,
                color: c.status.used.fg,
                fontSize: 9,
                fontWeight: 700,
              }}
            >
              </span>
            {item}
          </li>
        ))}
      </ul>

      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          requestHandoff();
        }}
        style={{
          marginTop: "auto",
          height: 34,
          borderRadius: 8,
          border: "none",
          background: c.primary,
          color: c.surface,
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        导出 Handoff 包
      </button>
    </HTMLContainer>
  );
}

export function makeHandoffCardShape(
  projectId: string,
  x: number,
  y: number
) {
  return {
    id: createShapeId(),
    type: "handoff-card" as const,
    x,
    y,
    props: {
      w: HANDOFF_CARD_W,
      h: HANDOFF_CARD_H,
      projectId,
    },
  };
}
