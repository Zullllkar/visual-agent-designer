"use client";

/**
 * Tabnow 式引用菜单：从选中图片右侧的 + 拖出，选择脚本 / 文案 / 规则，或继续生成图片。
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlignLeft, Image as ImageIcon, ListChecks, Plus, ScrollText, X } from "lucide-react";
import { useEditor, useValue } from "tldraw";
import { useCanvasUiStore } from "@/store/canvas-ui-store";
import { useProjectStore } from "@/store/project-store";
import { useAssetMarkStore } from "@/store/asset-mark-store";
import {
  CITE_SPAWN_ITEMS,
  canCiteFromAsset,
  citeDropPagePosition,
  citePortScreenPosition,
  composerPromptForCite,
  isCiteDragGesture,
  spawnCitedImage,
  spawnCitedTextNote,
  type CiteSpawnItem,
} from "@/lib/canvas/canvas-notes";
import type { ReferenceAsset } from "@/lib/project/assets-schema";

const ICONS: Record<CiteSpawnItem["id"], typeof ScrollText> = {
  script: ScrollText,
  copy: AlignLeft,
  rule: ListChecks,
  image: ImageIcon,
};

type PullState = {
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  dragging: boolean;
};

export function CiteSpawnMenu() {
  const menu = useCanvasUiStore((s) => s.citeMenu);
  const closeCiteMenu = useCanvasUiStore((s) => s.closeCiteMenu);

  useEffect(() => {
    if (!menu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeCiteMenu();
    };
    const onPointerDown = (event: PointerEvent) => {
      const el = event.target as Element | null;
      if (el?.closest?.(".vad-cite-menu, .vad-cite-port, .vad-cite-drag-layer")) {
        return;
      }
      closeCiteMenu();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [menu, closeCiteMenu]);

  if (!menu || typeof document === "undefined") return null;

  const anchorX = menu.toClientX ?? menu.fromClientX + 72;
  const anchorY = menu.toClientY ?? menu.fromClientY;
  const menuLeft = Math.min(anchorX, window.innerWidth - 300);
  const menuTop = Math.min(Math.max(24, anchorY - 80), window.innerHeight - 360);
  const attachX = menuLeft;
  const attachY = menuTop + 28;

  return createPortal(
    <div className="vad-cite-layer">
      <svg className="vad-cite-curve" aria-hidden>
        <path
          d={`M ${menu.fromClientX} ${menu.fromClientY} C ${menu.fromClientX + 48} ${menu.fromClientY}, ${attachX - 36} ${attachY}, ${attachX} ${attachY}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="5 6"
          strokeLinecap="round"
        />
      </svg>
      <div
        className="vad-cite-menu"
        role="dialog"
        aria-label="引用该图生成"
        style={{ left: menuLeft, top: menuTop }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="vad-cite-menu-head">
          <span>引用该图生成</span>
          <button type="button" aria-label="关闭" onClick={() => closeCiteMenu()}>
            <X size={14} strokeWidth={1.75} />
          </button>
        </header>
        <ul className="vad-cite-menu-list">
          {CITE_SPAWN_ITEMS.map((item) => {
            const Icon = ICONS[item.id];
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="vad-cite-menu-item"
                  onClick={() => {
                    applyCiteChoice(menu, item);
                    closeCiteMenu();
                  }}
                >
                  <span className="vad-cite-menu-icon" aria-hidden>
                    <Icon size={16} strokeWidth={1.7} />
                  </span>
                  <span className="vad-cite-menu-copy">
                    <strong>{item.label}</strong>
                    <em>{item.hint}</em>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>,
    document.body
  );
}

function applyCiteChoice(
  menu: {
    projectId: string;
    assetId: string;
    parentBox?: { x: number; y: number; w: number; h: number };
    dropAt?: { x: number; y: number };
  },
  item: CiteSpawnItem
) {
  const project = useProjectStore.getState().projects[menu.projectId];
  const parent = (project?.assets ?? []).find((asset) => asset.id === menu.assetId);
  if (!project || !parent) return;

  const offerRef = () => {
    const ref: ReferenceAsset = {
      id: `from-asset-${parent.id}`,
      label: (parent.prompt || "参考图").slice(0, 40),
      src: parent.src,
      width: parent.width || 1024,
      height: parent.height || 1024,
      source: "upload",
      createdAt: new Date().toISOString(),
      notes: `from-asset:${parent.id}`,
    };
    useCanvasUiStore.getState().offerComposerRef(ref);
  };

  if (item.id === "image") {
    if (menu.dropAt) {
      useCanvasUiStore.getState().offerSpawnPoint(citeDropPagePosition(menu.dropAt));
    }
    const result = spawnCitedImage(project, parent.id);
    if (!result) return;
    useProjectStore.getState().upsert(result.project);
    offerRef();
    window.setTimeout(() => {
      useCanvasUiStore.getState().requestFocusAsset(result.child.id);
    }, 180);
    return;
  }

  const spawned = spawnCitedTextNote(project, parent.id, {
    kind: item.id,
    parentBox: menu.parentBox,
    dropAt: menu.dropAt,
  });
  if (!spawned) return;
  useProjectStore.getState().upsert(spawned.project);
  offerRef();
  useCanvasUiStore.getState().offerComposerDraft(
    composerPromptForCite({
      kind: item.id,
      noteId: spawned.note.id,
      sourcePrompt: parent.prompt,
    })
  );
  window.setTimeout(() => {
    useCanvasUiStore.getState().requestFocusNote(spawned.note.id);
  }, 180);
}

export function CitePortOverlay() {
  const editor = useEditor();
  const markMode = useAssetMarkStore((s) => s.mode);
  const markAssetId = useAssetMarkStore((s) => s.assetId);
  const pullRef = useRef<PullState | null>(null);
  const [pull, setPull] = useState<PullState | null>(null);

  const layout = useValue(
    "cite-port-layout",
    () => {
      const selected = editor.getSelectedShapes();
      const image = selected.find((shape) => (shape.type as string) === "image-asset");
      if (selected.length !== 1 || !image) return null;
      const sel = editor.getSelectionScreenBounds();
      const viewport = editor.getViewportScreenBounds();
      if (!sel || !viewport) return null;
      const pos = citePortScreenPosition({
        minX: sel.x - viewport.x,
        minY: sel.y - viewport.y,
        maxX: sel.x - viewport.x + sel.w,
        maxY: sel.y - viewport.y + sel.h,
      });
      return {
        shape: image,
        left: pos.left,
        top: pos.top,
      };
    },
    [editor]
  );

  const props = layout
    ? (layout.shape as unknown as {
        props: { assetId: string; projectId: string; w: number; h: number };
        x: number;
        y: number;
      })
    : null;
  const asset = useProjectStore((s) => {
    if (!props) return null;
    return (
      s.projects[props.props.projectId]?.assets?.find(
        (item) => item.id === props.props.assetId
      ) ?? null
    );
  });

  const openFromPull = (state: PullState) => {
    if (!layout || !props || !asset) return;
    const dragged = isCiteDragGesture(
      { x: state.startX, y: state.startY },
      { x: state.x, y: state.y }
    );
    const dropAt = dragged
      ? editor.screenToPage({ x: state.x, y: state.y })
      : undefined;
    useCanvasUiStore.getState().openCiteMenu({
      projectId: props.props.projectId,
      assetId: asset.id,
      fromClientX: state.fromX,
      fromClientY: state.fromY,
      toClientX: dragged ? state.x : undefined,
      toClientY: dragged ? state.y : undefined,
      dropAt: dropAt ? { x: dropAt.x, y: dropAt.y } : undefined,
      parentBox: {
        x: layout.shape.x,
        y: layout.shape.y,
        w: props.props.w,
        h: props.props.h,
      },
    });
  };

  if (!layout || !props || !asset || !canCiteFromAsset(asset)) return null;
  if (
    (markMode === "marking" || markMode === "instruct") &&
    markAssetId === asset.id
  ) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        className="vad-cite-port pointer-events-auto absolute z-20"
        aria-label="引用该图生成"
        title="点击或拖到画布，引用该图生成内容"
        style={{ left: layout.left, top: layout.top }}
        onPointerDown={(event) => {
          event.stopPropagation();
          event.preventDefault();
          editor.markEventAsHandled(event);
          event.currentTarget.setPointerCapture(event.pointerId);
          const rect = event.currentTarget.getBoundingClientRect();
          const next: PullState = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            x: event.clientX,
            y: event.clientY,
            fromX: rect.left + rect.width / 2,
            fromY: rect.top + rect.height / 2,
            dragging: false,
          };
          pullRef.current = next;
          setPull(next);
        }}
        onPointerMove={(event) => {
          const current = pullRef.current;
          if (!current || current.pointerId !== event.pointerId) return;
          event.stopPropagation();
          editor.markEventAsHandled(event);
          const next: PullState = {
            ...current,
            x: event.clientX,
            y: event.clientY,
            dragging: isCiteDragGesture(
              { x: current.startX, y: current.startY },
              { x: event.clientX, y: event.clientY }
            ),
          };
          pullRef.current = next;
          setPull(next);
        }}
        onPointerUp={(event) => {
          const current = pullRef.current;
          if (!current || current.pointerId !== event.pointerId) return;
          event.stopPropagation();
          event.preventDefault();
          editor.markEventAsHandled(event);
          event.currentTarget.releasePointerCapture(event.pointerId);
          const next: PullState = {
            ...current,
            x: event.clientX,
            y: event.clientY,
            dragging: isCiteDragGesture(
              { x: current.startX, y: current.startY },
              { x: event.clientX, y: event.clientY }
            ),
          };
          pullRef.current = null;
          setPull(null);
          openFromPull(next);
        }}
        onPointerCancel={() => {
          pullRef.current = null;
          setPull(null);
        }}
      >
        <Plus size={12} strokeWidth={2.25} aria-hidden />
      </button>
      {pull?.dragging && typeof document !== "undefined"
        ? createPortal(
            <div className="vad-cite-drag-layer" aria-hidden>
              <svg className="vad-cite-curve">
                <path
                  d={`M ${pull.fromX} ${pull.fromY} C ${pull.fromX + 48} ${pull.fromY}, ${pull.x - 36} ${pull.y}, ${pull.x} ${pull.y}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeDasharray="5 6"
                  strokeLinecap="round"
                />
              </svg>
              <div
                className="vad-cite-drag-ghost"
                style={{ left: pull.x, top: pull.y }}
              />
            </div>,
            document.body
          )
        : null}
    </>
  );
}
