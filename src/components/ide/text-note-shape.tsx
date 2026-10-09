"use client";
import { createShapeId, type RecordProps, type TLBaseShape } from "@/lib/tldraw-compat";

/**
 * 画布文本卡片：脚本 / 文案 / 规则 / 笔记
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AlignLeft, ListChecks, ScrollText, StickyNote, Trash2 } from "lucide-react";
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  useEditor,
  useValue,
} from "tldraw";
import { useProjectStore } from "@/store/project-store";
import { useCanvasChromePalette } from "@/lib/canvas/use-canvas-chrome";
import {
  CANVAS_NOTE_KINDS,
  TEXT_NOTE_DEFAULT_H,
  TEXT_NOTE_DEFAULT_W,
  deleteCanvasNote,
  noteKindLabel,
  upsertCanvasNote,
  type CanvasNoteKind,
} from "@/lib/canvas/canvas-notes";

const CARD_RADIUS = 14;

export type TextNoteShape = TLBaseShape<
  "text-note",
  {
    w: number;
    h: number;
    noteId: string;
    projectId: string;
  }
>;

export class TextNoteShapeUtil extends ShapeUtil<TextNoteShape> {
  static type = "text-note" as any;

  static props: RecordProps<TextNoteShape> = {
    w: T.number,
    h: T.number,
    noteId: T.string,
    projectId: T.string,
  };

  getDefaultProps(): TextNoteShape["props"] {
    return {
      w: TEXT_NOTE_DEFAULT_W,
      h: TEXT_NOTE_DEFAULT_H,
      noteId: "",
      projectId: "",
    };
  }

  getGeometry(shape: TextNoteShape): Rectangle2d {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  canResize = () => true;
  canDelete = () => true;
  canEditInReadonly = () => false;
  hideRotateHandle = () => true;
  canBind = () => false;

  component(shape: TextNoteShape) {
    return <TextNoteShapeView shape={shape} />;
  }

  getIndicatorPath(shape: TextNoteShape): Path2D | undefined {
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

const KIND_ICON = {
  script: ScrollText,
  copy: AlignLeft,
  rule: ListChecks,
  note: StickyNote,
} as const;

const KIND_PLACEHOLDER: Record<CanvasNoteKind, string> = {
  script: "写下旁白、对白或过场…",
  copy: "写下口号、按钮或品牌文案…",
  rule: "写下玩法、约束或保持项…",
  note: "写下备注…",
};

function TextNoteShapeView({ shape }: { shape: TextNoteShape }) {
  const editor = useEditor();
  const c = useCanvasChromePalette();
  const upsertProject = useProjectStore((s) => s.upsert);
  const note = useProjectStore((s) =>
    (s.projects[shape.props.projectId]?.canvasNotes ?? []).find(
      (item) => item.id === shape.props.noteId
    )
  );
  const isSelected = useValue(
    `text-note selected:${shape.id}`,
    () => editor.getSelectedShapeIds().includes(shape.id),
    [editor, shape.id]
  );

  const kind: CanvasNoteKind = note?.kind ?? "note";
  const [title, setTitle] = useState(note?.title ?? noteKindLabel(kind));
  const [body, setBody] = useState(note?.body ?? "");
  const titleSynced = useRef(note?.title);
  const bodySynced = useRef(note?.body);

  useEffect(() => {
    if (note?.title !== titleSynced.current) {
      titleSynced.current = note?.title;
      setTitle(note?.title ?? noteKindLabel(kind));
    }
    if (note?.body !== bodySynced.current) {
      bodySynced.current = note?.body;
      setBody(note?.body ?? "");
    }
  }, [kind, note?.body, note?.title]);

  const persist = useCallback(
    (patch: { title?: string; body?: string; kind?: CanvasNoteKind }) => {
      const project = useProjectStore.getState().projects[shape.props.projectId];
      if (!project || !shape.props.noteId) return;
      upsertProject(
        upsertCanvasNote(project, {
          id: shape.props.noteId,
          kind: patch.kind ?? kind,
          title: patch.title ?? title,
          body: patch.body ?? body,
        })
      );
    },
    [body, kind, shape.props.noteId, shape.props.projectId, title, upsertProject]
  );

  const remove = useCallback(() => {
    const project = useProjectStore.getState().projects[shape.props.projectId];
    if (project && shape.props.noteId) {
      upsertProject(deleteCanvasNote(project, shape.props.noteId));
    }
    editor.deleteShapes([shape.id]);
    editor.selectNone();
  }, [editor, shape.id, shape.props.noteId, shape.props.projectId, upsertProject]);

  const KindIcon = KIND_ICON[kind];

  return (
    <HTMLContainer
      id={shape.id}
      className={
        "vad-text-note" + (isSelected ? " vad-text-note--selected" : "")
      }
      style={{
        width: shape.props.w,
        height: shape.props.h,
        boxSizing: "border-box",
        borderRadius: CARD_RADIUS,
        background: c.surface,
        border: `1px solid ${isSelected ? c.primary : c.border}`,
        boxShadow: isSelected ? c.cardShadowHover : c.cardShadow,
        pointerEvents: "all",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        padding: 12,
        color: c.text,
      }}
    >
      <div className="vad-text-note-head">
        <span className="vad-text-note-kind" style={{ color: c.textMuted }}>
          <KindIcon size={13} strokeWidth={1.75} aria-hidden />
          {noteKindLabel(kind)}
        </span>
        {isSelected ? (
          <button
            type="button"
            className="vad-text-note-remove"
            aria-label="删除卡片"
            onPointerDown={(event) => {
              event.stopPropagation();
              event.preventDefault();
              editor.markEventAsHandled(event);
            }}
            onPointerUp={(event) => {
              event.stopPropagation();
              event.preventDefault();
              editor.markEventAsHandled(event);
              remove();
            }}
          >
            <Trash2 size={12} />
          </button>
        ) : null}
      </div>
      {isSelected ? (
        <div
          className="vad-text-note-kinds"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {CANVAS_NOTE_KINDS.map((item) => (
            <button
              key={item}
              type="button"
              className={
                "vad-text-note-chip" +
                (item === kind ? " vad-text-note-chip--on" : "")
              }
              onClick={(event) => {
                event.stopPropagation();
                const nextTitle =
                  title === noteKindLabel(kind) ? noteKindLabel(item) : title;
                persist({ kind: item, title: nextTitle });
              }}
            >
              {noteKindLabel(item)}
            </button>
          ))}
        </div>
      ) : null}
      {isSelected ? (
        <input
          className="vad-text-note-title"
          value={title}
          placeholder={noteKindLabel(kind)}
          onPointerDown={(event) => event.stopPropagation()}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => persist({ title })}
        />
      ) : (
        <p className="vad-text-note-title-static">{title || noteKindLabel(kind)}</p>
      )}
      {isSelected ? (
        <textarea
          className="vad-text-note-body"
          value={body}
          placeholder={KIND_PLACEHOLDER[kind]}
          onPointerDown={(event) => event.stopPropagation()}
          onChange={(event) => setBody(event.target.value)}
          onBlur={() => persist({ body })}
        />
      ) : (
        <p className="vad-text-note-body-static">
          {body.trim() || KIND_PLACEHOLDER[kind]}
        </p>
      )}
    </HTMLContainer>
  );
}

export function makeTextNoteShape(input: {
  noteId: string;
  projectId: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
}) {
  return {
    id: createShapeId(`text-note:${input.noteId}`),
    type: "text-note" as const,
    x: input.x,
    y: input.y,
    props: {
      w: input.w ?? TEXT_NOTE_DEFAULT_W,
      h: input.h ?? TEXT_NOTE_DEFAULT_H,
      noteId: input.noteId,
      projectId: input.projectId,
    },
  };
}
