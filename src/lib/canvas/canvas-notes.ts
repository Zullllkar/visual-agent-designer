/**
 * 画布文本卡片 + 「引用该节点生成」
 * 脚本 / 文案 / 规则落在无限画布上，并从图片节点拉出派生。
 */

import { nanoid } from "nanoid";
import type { ImageAsset } from "@/lib/project/assets-schema";
import type { CanvasNote, ProjectFile } from "@/lib/project/schema";
import { canSpawnChildFrom, spawnChildAsset } from "./spawn-child-asset";

export type { CanvasNote };
export const CANVAS_NOTE_KINDS = ["script", "copy", "rule", "note"] as const;
export type CanvasNoteKind = (typeof CANVAS_NOTE_KINDS)[number];

export type CiteSpawnGroup = "text" | "image";

export interface CiteSpawnItem {
  id: "script" | "copy" | "rule" | "image";
  group: CiteSpawnGroup;
  label: string;
  hint: string;
}

export const CITE_SPAWN_ITEMS: CiteSpawnItem[] = [
  { id: "script", group: "text", label: "脚本", hint: "旁白、对白、过场脚本" },
  { id: "copy", group: "text", label: "文案", hint: "广告词、品牌文案、按钮字" },
  { id: "rule", group: "text", label: "规则", hint: "玩法、约束、保持项" },
  { id: "image", group: "image", label: "图片生成", hint: "基于该图继续生成" },
];

export const TEXT_NOTE_DEFAULT_W = 280;
export const TEXT_NOTE_DEFAULT_H = 220;
export const CITE_NODE_GAP = 48;
export const CITE_NODE_STACK = 24;

const KIND_LABEL: Record<CanvasNoteKind, string> = {
  script: "脚本",
  copy: "文案",
  rule: "规则",
  note: "笔记",
};

export function noteKindLabel(kind: CanvasNoteKind): string {
  return KIND_LABEL[kind];
}

export function defaultTitleForKind(kind: CanvasNoteKind): string {
  return KIND_LABEL[kind];
}

export function isCanvasNoteKind(value: string): value is CanvasNoteKind {
  return (CANVAS_NOTE_KINDS as readonly string[]).includes(value);
}

export function canCiteFromAsset(asset: ImageAsset | null | undefined): boolean {
  return canSpawnChildFrom(asset);
}

export function placeCitedNode(
  parent: { x: number; y: number; w: number; h: number },
  siblingIndex: number,
  cardH = TEXT_NOTE_DEFAULT_H
): { x: number; y: number } {
  return {
    x: parent.x + parent.w + CITE_NODE_GAP,
    y: parent.y + siblingIndex * (cardH + CITE_NODE_STACK),
  };
}

export const CITE_PORT_GAP = 28;
export const CITE_DRAG_THRESHOLD = 8;

/** 选中框右侧中点外侧，躲开缩放手柄后再放 + */
export function citePortScreenPosition(box: {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}): { left: number; top: number } {
  return {
    left: box.maxX + CITE_PORT_GAP,
    top: (box.minY + box.maxY) / 2,
  };
}

export function isCiteDragGesture(
  start: { x: number; y: number },
  current: { x: number; y: number },
  threshold = CITE_DRAG_THRESHOLD
): boolean {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  return dx * dx + dy * dy >= threshold * threshold;
}

export function citeDropPagePosition(
  drop: { x: number; y: number },
  cardH = TEXT_NOTE_DEFAULT_H
): { x: number; y: number } {
  return { x: drop.x, y: drop.y - cardH / 2 };
}

function citedSiblingCount(project: ProjectFile, parentAssetId: string): number {
  const childImages = (project.assets ?? []).filter(
    (asset) => asset.parentAssetId === parentAssetId
  ).length;
  const childNotes = (project.canvasNotes ?? []).filter(
    (note) => note.parentAssetId === parentAssetId
  ).length;
  return childImages + childNotes;
}

export function spawnCitedTextNote(
  project: ProjectFile,
  parentAssetId: string,
  options: {
    kind: Exclude<CanvasNoteKind, "note"> | CanvasNoteKind;
    id?: string;
    now?: string;
    title?: string;
    body?: string;
    parentBox?: { x: number; y: number; w: number; h: number };
    dropAt?: { x: number; y: number };
  }
): { project: ProjectFile; note: CanvasNote } | null {
  const parent = (project.assets ?? []).find((asset) => asset.id === parentAssetId);
  if (!canCiteFromAsset(parent)) return null;

  const now = options.now ?? new Date().toISOString();
  const kind: CanvasNoteKind = options.kind;
  const pos = options.dropAt
    ? citeDropPagePosition(options.dropAt)
    : options.parentBox
      ? placeCitedNode(options.parentBox, citedSiblingCount(project, parentAssetId))
      : undefined;
  const note: CanvasNote = {
    id: options.id ?? nanoid(10),
    kind,
    title: options.title?.trim() || defaultTitleForKind(kind),
    body: options.body ?? "",
    parentAssetId,
    createdAt: now,
    updatedAt: now,
    w: TEXT_NOTE_DEFAULT_W,
    h: TEXT_NOTE_DEFAULT_H,
    ...(pos ? { x: pos.x, y: pos.y } : {}),
  };

  return {
    note,
    project: {
      ...project,
      canvasNotes: [...(project.canvasNotes ?? []), note],
      updatedAt: now,
    },
  };
}

export function spawnCitedImage(
  project: ProjectFile,
  parentAssetId: string,
  options?: { id?: string; now?: string }
) {
  return spawnChildAsset(project, parentAssetId, options);
}

export function spawnStandaloneNote(
  project: ProjectFile,
  options?: {
    kind?: CanvasNoteKind;
    id?: string;
    now?: string;
    title?: string;
    body?: string;
    x?: number;
    y?: number;
  }
): { project: ProjectFile; note: CanvasNote } {
  const now = options?.now ?? new Date().toISOString();
  const kind = options?.kind ?? "note";
  const note: CanvasNote = {
    id: options?.id ?? nanoid(10),
    kind,
    title: options?.title?.trim() || defaultTitleForKind(kind),
    body: options?.body ?? "",
    createdAt: now,
    updatedAt: now,
    w: TEXT_NOTE_DEFAULT_W,
    h: TEXT_NOTE_DEFAULT_H,
    ...(typeof options?.x === "number" ? { x: options.x } : {}),
    ...(typeof options?.y === "number" ? { y: options.y } : {}),
  };
  return {
    note,
    project: {
      ...project,
      canvasNotes: [...(project.canvasNotes ?? []), note],
      updatedAt: now,
    },
  };
}

export function upsertCanvasNote(
  project: ProjectFile,
  patch: {
    id: string;
    kind?: CanvasNoteKind;
    title?: string;
    body?: string;
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    parentAssetId?: string;
    now?: string;
  }
): ProjectFile {
  const now = patch.now ?? new Date().toISOString();
  const notes = [...(project.canvasNotes ?? [])];
  const index = notes.findIndex((note) => note.id === patch.id);
  if (index === -1) {
    const kind = patch.kind ?? "note";
    notes.push({
      id: patch.id,
      kind,
      title: patch.title?.trim() || defaultTitleForKind(kind),
      body: patch.body ?? "",
      createdAt: now,
      updatedAt: now,
      parentAssetId: patch.parentAssetId,
      x: patch.x,
      y: patch.y,
      w: patch.w ?? TEXT_NOTE_DEFAULT_W,
      h: patch.h ?? TEXT_NOTE_DEFAULT_H,
    });
  } else {
    const prev = notes[index]!;
    notes[index] = {
      ...prev,
      kind: patch.kind ?? prev.kind,
      title:
        patch.title !== undefined
          ? patch.title.trim() || defaultTitleForKind(patch.kind ?? prev.kind)
          : prev.title,
      body: patch.body !== undefined ? patch.body : prev.body,
      x: patch.x ?? prev.x,
      y: patch.y ?? prev.y,
      w: patch.w ?? prev.w,
      h: patch.h ?? prev.h,
      parentAssetId: patch.parentAssetId ?? prev.parentAssetId,
      updatedAt: now,
    };
  }
  return { ...project, canvasNotes: notes, updatedAt: now };
}

export function deleteCanvasNote(project: ProjectFile, noteId: string, now?: string): ProjectFile {
  return {
    ...project,
    canvasNotes: (project.canvasNotes ?? []).filter((note) => note.id !== noteId),
    updatedAt: now ?? new Date().toISOString(),
  };
}

export function persistCanvasNoteLayout(
  notes: ProjectFile["canvasNotes"],
  shapes: Array<{
    type: string;
    x: number;
    y: number;
    props: { noteId?: string; w?: number; h?: number };
  }>
): ProjectFile["canvasNotes"] {
  if (!notes?.length) return notes;
  const byId = new Map(
    shapes
      .filter((shape) => shape.type === "text-note" && shape.props.noteId)
      .map((shape) => [shape.props.noteId!, shape])
  );
  return notes.flatMap((note) => {
    const shape = byId.get(note.id);
    if (!shape) return [];
    return [
      {
        ...note,
        x: shape.x,
        y: shape.y,
        w: shape.props.w ?? note.w,
        h: shape.props.h ?? note.h,
      },
    ];
  });
}

export function composerPromptForCite(input: {
  kind: CanvasNoteKind;
  noteId: string;
  sourcePrompt?: string;
}): string {
  const label = noteKindLabel(input.kind);
  const about = input.sourcePrompt?.trim()
    ? `参考图主题：${input.sourcePrompt.trim()}。`
    : "根据参考图。";
  return `${about}请写一份${label}，直接写到画布上这张卡片里（${input.noteId}），不要只停在对话。`;
}

export function summarizeCanvasNotes(notes: CanvasNote[] | undefined): {
  total: number;
  byKind: Record<CanvasNoteKind, number>;
} {
  const list = notes ?? [];
  const byKind: Record<CanvasNoteKind, number> = {
    script: 0,
    copy: 0,
    rule: 0,
    note: 0,
  };
  for (const note of list) {
    byKind[note.kind] += 1;
  }
  return { total: list.length, byKind };
}
