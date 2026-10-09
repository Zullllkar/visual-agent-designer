export const CANVAS_GRID_STORAGE_KEY = "vad.canvas.gridStyle";

export const CANVAS_GRID_STYLES = [
  { id: "dots", label: "点" },
  { id: "lines", label: "线" },
  { id: "none", label: "空白" },
] as const;

export type CanvasGridStyle = (typeof CANVAS_GRID_STYLES)[number]["id"];

export function parseCanvasGridStyle(value: string | null | undefined): CanvasGridStyle {
  if (value === "dots" || value === "lines" || value === "none") return value;
  return "dots";
}

export function isCanvasGridVisible(style: CanvasGridStyle): boolean {
  return style !== "none";
}

export function canvasGridClassName(style: CanvasGridStyle): string {
  if (style === "none") return "";
  return `vad-ide-canvas-grid vad-ide-canvas-grid--${style}`;
}

export function persistCanvasGridStyle(style: CanvasGridStyle): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CANVAS_GRID_STORAGE_KEY, style);
  } catch {
    /* ignore quota / private mode */
  }
}

export function readStoredCanvasGridStyle(): CanvasGridStyle {
  if (typeof window === "undefined") return "dots";
  try {
    return parseCanvasGridStyle(window.localStorage.getItem(CANVAS_GRID_STORAGE_KEY));
  } catch {
    return "dots";
  }
}
