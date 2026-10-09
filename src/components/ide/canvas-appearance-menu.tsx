"use client";

import { Grid2x2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CANVAS_GRID_STYLES } from "@/lib/canvas/grid-style";
import { useCanvasUiStore } from "@/store/canvas-ui-store";

export function CanvasAppearanceMenu() {
  const style = useCanvasUiStore((s) => s.canvasGridStyle);
  const setStyle = useCanvasUiStore((s) => s.setCanvasGridStyle);
  const setMenuOpen = useCanvasUiStore((s) => s.setAppearanceMenuOpen);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMenuOpen(open);
    return () => setMenuOpen(false);
  }, [open, setMenuOpen]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-tip="画布外观"
        aria-label="画布外观"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        className={
          "vad-canvas-toolbar-btn grid size-9 place-items-center transition-colors duration-150 " +
          (open ? "vad-canvas-toolbar-btn--active" : "")
        }
      >
        <Grid2x2 className="size-4" />
      </button>
      {open ? (
        <div
          ref={panelRef}
          className="vad-canvas-appearance"
          role="dialog"
          aria-label="画布外观"
        >
          <p className="vad-canvas-appearance-kicker">背景</p>
          <div
            className="vad-canvas-appearance-swatches"
            role="radiogroup"
            aria-label="背景样式"
          >
            {CANVAS_GRID_STYLES.map((item) => {
              const active = style === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={
                    "vad-canvas-appearance-swatch" + (active ? " is-active" : "")
                  }
                  onClick={() => setStyle(item.id)}
                >
                  <span
                    className={`vad-canvas-appearance-preview is-${item.id}`}
                    aria-hidden
                  />
                  <span className="vad-canvas-appearance-name">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </>
  );
}
