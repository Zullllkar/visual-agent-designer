"use client";

/**
 * 画布小地图 — 轻量 viewport 导航（tldraw 5 无内置 Minimap 时的替代）
 * @author：wangjunhua
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useEditor, useValue } from "tldraw";

const MAP_W = 120;
const MAP_H = 80;
const PAD = 24;

export function CanvasMinimap() {
  const editor = useEditor();
  const mapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  const snapshot = useValue(
    "minimap snapshot",
    () => {
      const content = editor.getCurrentPageBounds();
      const viewport = editor.getViewportPageBounds();
      const shapes = editor.getCurrentPageShapes().filter((s) =>
        ["image-asset", "reference-card"].includes(s.type as string)
      );
      return { content, viewport, shapeCount: shapes.length };
    },
    [editor]
  );

  const { content, viewport, shapeCount } = snapshot;

  const layout = useMemo(() => {
    if (!content || shapeCount === 0) return null;
    const worldW = content.w + PAD * 2;
    const worldH = content.h + PAD * 2;
    const scale = Math.min(MAP_W / worldW, MAP_H / worldH);
    const ox = -content.x + PAD;
    const oy = -content.y + PAD;
    return { scale, ox, oy };
  }, [content, shapeCount]);

  const toMap = useCallback(
    (x: number, y: number, w: number, h: number) => {
      if (!layout) return { left: 0, top: 0, width: 2, height: 2 };
      return {
        left: (x + layout.ox) * layout.scale,
        top: (y + layout.oy) * layout.scale,
        width: Math.max(2, w * layout.scale),
        height: Math.max(2, h * layout.scale),
      };
    },
    [layout]
  );

  const vpRect = useMemo(() => {
    if (!viewport) return { left: 0, top: 0, width: 0, height: 0 };
    return toMap(viewport.x, viewport.y, viewport.w, viewport.h);
  }, [toMap, viewport]);

  const pagePointFromEvent = useCallback(
    (clientX: number, clientY: number) => {
      if (!layout) return null;
      const el = mapRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const mx = clientX - rect.left;
      const my = clientY - rect.top;
      return {
        mx,
        my,
        pageX: mx / layout.scale - layout.ox,
        pageY: my / layout.scale - layout.oy,
      };
    },
    [layout]
  );

  const isInsideViewport = useCallback(
    (mx: number, my: number) =>
      mx >= vpRect.left &&
      mx <= vpRect.left + vpRect.width &&
      my >= vpRect.top &&
      my <= vpRect.top + vpRect.height,
    [vpRect]
  );

  const panToPagePoint = useCallback(
    (pageX: number, pageY: number, animate: boolean) => {
      editor.centerOnPoint(
        { x: pageX, y: pageY },
        animate ? { animation: { duration: 180 } } : undefined
      );
    },
    [editor]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const pt = pagePointFromEvent(e.clientX, e.clientY);
      if (!pt) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const onVp = isInsideViewport(pt.mx, pt.my);
      dragRef.current = onVp;
      setDragging(onVp);
      if (!onVp) {
        panToPagePoint(pt.pageX, pt.pageY, true);
      }
    },
    [isInsideViewport, pagePointFromEvent, panToPagePoint]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      const pt = pagePointFromEvent(e.clientX, e.clientY);
      if (!pt) return;
      panToPagePoint(pt.pageX, pt.pageY, false);
    },
    [pagePointFromEvent, panToPagePoint]
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) {
      dragRef.current = false;
      setDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  }, []);

  if (!content || !layout || shapeCount === 0) return null;

  return (
    <div
      className="vad-canvas-minimap overflow-hidden"
      style={{ width: MAP_W, height: MAP_H }}
    >
      <div
        ref={mapRef}
        role="img"
        aria-label="画布小地图"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={
          "relative h-full w-full rounded-lg border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_94%,transparent)] shadow-[var(--shadow-soft)] backdrop-blur-sm " +
          (dragging ? "cursor-grabbing" : "cursor-crosshair")
        }
      >
        <div
          className={
            "absolute rounded-sm border border-[var(--primary)] bg-[var(--primary-soft)] " +
            (dragging ? "opacity-90" : "pointer-events-none")
          }
          style={{
            left: vpRect.left,
            top: vpRect.top,
            width: vpRect.width,
            height: vpRect.height,
          }}
        />
        {editor.getCurrentPageShapes().map((shape) => {
          if (
            !["image-asset", "reference-card"].includes(shape.type as string)
          )
            return null;
          const bounds = editor.getShapePageBounds(shape.id);
          if (!bounds) return null;
          const r = toMap(bounds.x, bounds.y, bounds.w, bounds.h);
          return (
            <div
              key={shape.id}
              className="pointer-events-none absolute rounded-[2px] bg-[var(--muted)] opacity-35"
              style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
            />
          );
        })}
      </div>
    </div>
  );
}
