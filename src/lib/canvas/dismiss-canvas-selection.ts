import { useCanvasSelectionStore } from "@/store/canvas-selection-store";
import { useCanvasUiStore } from "@/store/canvas-ui-store";

export const CANVAS_SELECTION_DISMISS_EVENT = "vad-dismiss-canvas-selection";

const KEEP_CLASSES = [
  "vad-selection-float",
  "vad-canvas-dock",
  "vad-canvas-dock-menu",
  "vad-slash-menu",
  "vad-agent-composer",
  "vad-cite-menu",
  "vad-cite-port",
  "vad-spawn-prompt",
  "vad-canvas-view-chrome",
  "vad-canvas-view-bar",
] as const;

const DISMISS_CLASSES = [
  "vad-settings-overlay",
  "app-dialog-overlay",
  "vad-inspector",
  "vad-agent-column",
  "vad-agent-panel",
  "vad-ide-topbar",
  "desktop-titlebar",
  "vad-canvas-toolbar",
  "vad-canvas-chip",
] as const;

function classTokens(className: string): string[] {
  return className.split(/\s+/).filter(Boolean);
}

export function shouldDismissFromClassPath(classPath: string[]): boolean {
  const tokens = classPath.flatMap(classTokens);
  if (KEEP_CLASSES.some((name) => tokens.includes(name))) return false;
  return DISMISS_CLASSES.some((name) => tokens.includes(name));
}

export function shouldDismissCanvasSelection(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  const path: string[] = [];
  let node: Element | null = target as Element;
  while (node) {
    if (typeof node.className === "string") path.push(node.className);
    node = node.parentElement;
  }
  return shouldDismissFromClassPath(path);
}

export function dismissCanvasSelection(): void {
  useCanvasSelectionStore.getState().clear();
  useCanvasUiStore.getState().closeCiteMenu();
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CANVAS_SELECTION_DISMISS_EVENT));
}
