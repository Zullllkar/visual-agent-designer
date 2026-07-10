"use client";

/**
 * SpecCard Shape — 设计规范画布卡片（Lovart 式色彩/字体规范）
 * --------------------------------------------------------------
 * 把 project.designContext（色彩 token、字体、情绪关键词）渲染为
 * 画布一等公民卡片，与生图、结构稿并排，让画布呈现完整设计交付物。
 *
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
import { CARD_PAD, CARD_RADIUS } from "@/lib/canvas/canvas-chrome";
import { useCanvasChromePalette } from "@/lib/canvas/use-canvas-chrome";
import type { ProjectFile } from "@/lib/project/schema";

export type SpecCardShape = TLBaseShape<
  "spec-card",
  {
    w: number;
    h: number;
    projectId: string;
  }
>;

// @ts-expect-error TLShape union does not include custom shapes by design
export class SpecCardShapeUtil extends ShapeUtil<SpecCardShape> {
  static override type = "spec-card" as const;

  static override props: RecordProps<SpecCardShape> = {
    w: T.number,
    h: T.number,
    projectId: T.string,
  };

  override getDefaultProps(): SpecCardShape["props"] {
    return { w: SPEC_CARD_W, h: 320, projectId: "" };
  }

  override getGeometry(shape: SpecCardShape): Rectangle2d {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override canResize = () => false;
  override canEditInReadonly = () => false;
  override hideRotateHandle = () => true;
  override canBind = () => false;

  override component(shape: SpecCardShape) {
    return <SpecCardShapeView shape={shape} />;
  }

  override getIndicatorPath(shape: SpecCardShape): Path2D | undefined {
    return roundedRectPath(shape.props.w, shape.props.h);
  }
}

export function roundedRectPath(w: number, h: number): Path2D | undefined {
  if (typeof Path2D === "undefined") return undefined;
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

function SpecCardShapeView({ shape }: { shape: SpecCardShape }) {
  const c = useCanvasChromePalette();
  const project = useProjectStore(
    (s) => s.projects[shape.props.projectId] ?? null
  );
  const ctx = project?.designContext;
  const direction = project?.designDirection;

  const colors = ctx?.colorTokens?.slice(0, 6) ?? [];
  const heading = ctx?.typography?.heading;
  const body = ctx?.typography?.body;
  const moods = (ctx?.moodKeywords?.length
    ? ctx.moodKeywords
    : direction?.moodKeywords ?? []
  ).slice(0, 5);
  const summary = direction?.summary ?? ctx?.brandVoice ?? "";

  const sectionTitle: React.CSSProperties = {
    margin: "0 0 6px",
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: "0.08em",
    color: c.textMuted,
  };

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
        gap: 12,
      }}
    >
      <CardBadge color={c.primary} fg={c.surface} label="设计规范" />

      {summary ? (
        <p
          style={{
            margin: "4px 0 0",
            fontSize: 11,
            lineHeight: 1.5,
            color: c.caption,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {summary}
        </p>
      ) : null}

      {colors.length > 0 ? (
        <div>
          <p style={sectionTitle}>色彩</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {colors.map((token) => (
              <div
                key={token.name}
                style={{ display: "flex", alignItems: "center", gap: 8 }}
              >
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    background: token.value,
                    border: `1px solid ${c.border}`,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: c.text,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: 110,
                  }}
                >
                  {token.name}
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 10,
                    fontFamily: "var(--font-mono, monospace)",
                    color: c.textMuted,
                  }}
                >
                  {token.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {heading || body ? (
        <div>
          <p style={sectionTitle}>字体</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {heading ? (
              <p
                style={{
                  margin: 0,
                  fontSize: 15,
                  fontWeight: 700,
                  color: c.text,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {heading}
              </p>
            ) : null}
            {body ? (
              <p
                style={{
                  margin: 0,
                  fontSize: 11,
                  color: c.textMuted,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                正文 · {body}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {moods.length > 0 ? (
        <div style={{ marginTop: "auto" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {moods.map((mood) => (
              <span
                key={mood}
                style={{
                  padding: "3px 9px",
                  borderRadius: 999,
                  fontSize: 10,
                  fontWeight: 600,
                  background: c.status.generating.bg,
                  color: c.status.generating.fg,
                  border: `1px solid ${c.status.generating.border}`,
                }}
              >
                {mood}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </HTMLContainer>
  );
}

export function CardBadge({
  color,
  fg,
  label,
}: {
  color: string;
  fg: string;
  label: string;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: -10,
        left: 12,
        zIndex: 2,
        padding: "2px 10px",
        borderRadius: 999,
        background: color,
        color: fg,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.1em",
        boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
      }}
    >
      {label}
    </div>
  );
}

export const SPEC_CARD_W = 300;

/** 按项目数据估算卡片高度（避免内容溢出或大片留白） */
export function specCardHeight(project: ProjectFile): number {
  const ctx = project.designContext;
  const colorRows = Math.min(6, ctx?.colorTokens?.length ?? 0);
  const hasType = Boolean(ctx?.typography?.heading || ctx?.typography?.body);
  const moodCount = (
    ctx?.moodKeywords?.length
      ? ctx.moodKeywords
      : project.designDirection?.moodKeywords ?? []
  ).length;
  const hasSummary = Boolean(
    project.designDirection?.summary ?? ctx?.brandVoice
  );

  let h = 48; // 上下 padding + badge 空间
  if (hasSummary) h += 40;
  if (colorRows > 0) h += 22 + colorRows * 27;
  if (hasType) h += 22 + 44;
  if (moodCount > 0) h += 36;
  return Math.max(160, h);
}

export function hasSpecContent(project: ProjectFile): boolean {
  return Boolean(project.designContext || project.designDirection);
}

export function makeSpecCardShape(
  project: ProjectFile,
  x: number,
  y: number
) {
  return {
    id: createShapeId(),
    type: "spec-card" as const,
    x,
    y,
    props: {
      w: SPEC_CARD_W,
      h: specCardHeight(project),
      projectId: project.id,
    },
  };
}
