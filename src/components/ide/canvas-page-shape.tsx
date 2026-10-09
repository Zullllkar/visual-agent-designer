"use client";
import { createShapeId, type RecordProps, type TLBaseShape } from "@/lib/tldraw-compat";

/**
 * CanvasPage Shape (B2)
 * --------------------------------------------------------------
 * 每个 ProjectFile.page 在 tldraw 画布上对应一个 CanvasPageShape：
 *   - 矩形容器，带 page width × height
 *   - 内容用现有的 CanvasSvg 组件渲染（DOM SVG，缩放无失真）
 *   - 顶上有一条 page name 标签
 *
 * 序列化策略：把整个 CanvasPage JSON 字符串塞到 props.serializedPage 里。
 * tldraw 的 props 必须是可序列化的（store 用 IndexedDB 持久化），所以
 * 不能直接放 object。
 */

import { useState } from "react";
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
} from "tldraw";
import { CanvasSvg } from "@/lib/canvas/svg-renderer";
import type { CanvasNode, CanvasPage } from "@/lib/canvas/schema";
import { displaySizeForPageThumb } from "@/lib/canvas/board-layout";
import { CARD_INNER_RADIUS, CARD_RADIUS } from "@/lib/canvas/canvas-chrome";
import { useCanvasChromePalette } from "@/lib/canvas/use-canvas-chrome";
import { useCanvasSelectionStore } from "@/store/canvas-selection-store";

export type CanvasPageShape = TLBaseShape<
  "canvas-page",
  {
    w: number;
    h: number;
    /** 业务层的 pageId（不是 tldraw shape id） */
    pageId: string;
    projectId: string;
    /** CanvasPage JSON 序列化结果 */
    serializedPage: string;
  }
>;

// tldraw 5.x 的 ShapeUtil generic 约束是 `Shape extends TLShape`；当前类型
// 环境可正常接收这里的自定义 shape，不再需要 ts-expect-error。
export class CanvasPageShapeUtil extends ShapeUtil<CanvasPageShape> {
  static type = "canvas-page" as any;

  static props: RecordProps<CanvasPageShape> = {
    w: T.number,
    h: T.number,
    pageId: T.string,
    projectId: T.string,
    serializedPage: T.string,
  };

  getDefaultProps(): CanvasPageShape["props"] {
    return {
      w: 390,
      h: 844,
      pageId: "",
      projectId: "",
      serializedPage: "{}",
    };
  }

  /** 命中区域与画布占位一致（缩略图尺寸，非原始页面像素） */
  private getActualDimensions(shape: CanvasPageShape) {
    return { w: shape.props.w, h: shape.props.h };
  }

  /** 几何：一个矩形（填充=true 让点击命中整个内部） */
  getGeometry(shape: CanvasPageShape): Rectangle2d {
    const { w, h } = this.getActualDimensions(shape);
    return new Rectangle2d({
      width: w,
      height: h,
      isFilled: true,
    });
  }

  // 选择 / 可编辑性控制（只读展示为主，允许拖拽）
  canResize = () => false;
  canEditInReadonly = () => false;
  hideRotateHandle = () => true;
  canBind = () => false;

  component(shape: CanvasPageShape) {
    return <CanvasPageShapeComponent shape={shape} />;
  }

  /**
   * tldraw 5.x 抽象方法：返回原生 Path2D 作为选中指示。
   * 检查 typeof Path2D 防止 SSR / 服务端意外调用（本 shape util
   * 只在 client 使用，但加条防御不亏）。
   */
  getIndicatorPath(shape: CanvasPageShape): Path2D | undefined {
    if (typeof Path2D === "undefined") return undefined;
    const { w, h } = this.getActualDimensions(shape);
    const r = CARD_RADIUS;
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

/**
 * 生成一个可以传给 `editor.createShapes()` 的 partial。
 * createShapes 的参数类型是基于 TLShape union，自定义 shape 在调用点
 * 需要一次 `unknown` cast。
 */
const PAGE_CHROME_H = 28;

export function makeCanvasPageShape(
  page: CanvasPage,
  projectId: string,
  x: number,
  y: number
) {
  const thumb = displaySizeForPageThumb(page);
  return {
    id: createShapeId(),
    type: "canvas-page" as const,
    x,
    y,
    props: {
      w: thumb.w,
      h: thumb.h + PAGE_CHROME_H,
      pageId: page.id,
      projectId,
      serializedPage: JSON.stringify(page),
    },
  };
}

function getNodeLabel(node: CanvasNode): string {
  if (node.type === "text") return node.content.slice(0, 32);
  if (node.type === "button") return node.label.slice(0, 32);
  if (node.type === "card") return (node.title ?? node.body ?? "card").slice(0, 32);
  if (node.type === "image") return (node.alt ?? "image").slice(0, 32);
  return node.type;
}

function CanvasPageShapeComponent({ shape }: { shape: CanvasPageShape }) {
  const c = useCanvasChromePalette();
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  let page: CanvasPage | null = null;
  try {
    page = JSON.parse(shape.props.serializedPage) as CanvasPage;
  } catch {
    page = null;
  }

  const displayW = shape.props.w;
  const displayH = shape.props.h;
  const chromeH = PAGE_CHROME_H;
  const bodyH = Math.max(0, displayH - chromeH);
  const scale =
    page && page.width > 0 ? displayW / page.width : 1;
  const scaledPageH = page ? page.height * scale : bodyH;

  return (
    <HTMLContainer
      id={shape.id}
      style={{
        width: displayW,
        height: displayH,
        position: "relative",
        borderRadius: CARD_RADIUS,
        border: `1px solid ${c.border}`,
        boxShadow: c.cardShadow,
        overflow: "hidden",
        pointerEvents: "all",
        background: c.surface,
        fontFamily: "var(--font-sans, ui-sans-serif, system-ui, sans-serif)",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: -26,
          left: 0,
          right: 0,
          display: "flex",
          alignItems: "center",
          gap: 6,
          pointerEvents: "none",
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: c.primaryMuted,
          }}
        >
          结构稿
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: c.text,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {page?.name ?? "页面"}
        </span>
      </div>
      <div
        style={{
          height: chromeH,
          display: "flex",
          alignItems: "center",
          gap: 5,
          padding: "0 12px",
          borderBottom: `1px solid ${c.border}`,
          background: `linear-gradient(180deg, ${c.surfaceMuted}, ${c.surface})`,
        }}
      >
        {["#e8c4c4", "#e8dcc4", "#c4dcc4"].map((dot) => (
          <span
            key={dot}
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: dot,
              opacity: 0.85,
            }}
          />
        ))}
        <span
          style={{
            marginLeft: 6,
            flex: 1,
            height: 14,
            borderRadius: 6,
            background: c.surfaceMuted,
            border: `1px solid ${c.border}`,
          }}
        />
      </div>
      <div
        style={{
          height: bodyH,
          overflow: "hidden",
          background: "#fff",
          borderRadius: `0 0 ${CARD_INNER_RADIUS}px ${CARD_INNER_RADIUS}px`,
        }}
      >
        {page ? (
          <div
            style={{
              width: page.width,
              height: page.height,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          >
            <CanvasSvg
              page={page}
              selectedNodeId={selectedNodeId}
              onNodeSelect={(node) => {
                setSelectedNodeId(node.id);
                useCanvasSelectionStore.getState().set({
                  projectId: shape.props.projectId,
                  kind: "page",
                  pageId: shape.props.pageId,
                  pageName: page?.name ?? "页面",
                  nodeId: node.id,
                  nodeLabel: getNodeLabel(node),
                });
              }}
            />
          </div>
        ) : (
          <div
            style={{
              padding: 16,
              color: c.textMuted,
              fontSize: 12,
            }}
          >
            （无效页面数据）
          </div>
        )}
      </div>
      {page && scaledPageH < bodyH ? (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: bodyH - scaledPageH,
            background: c.surfaceMuted,
          }}
        />
      ) : null}
    </HTMLContainer>
  );
}
