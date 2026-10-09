import { afterEach, describe, expect, it } from "vitest";
import {
  dismissCanvasSelection,
  shouldDismissFromClassPath,
} from "./dismiss-canvas-selection";
import { useCanvasSelectionStore } from "@/store/canvas-selection-store";

afterEach(() => {
  useCanvasSelectionStore.getState().clear();
});

describe("shouldDismissFromClassPath", () => {
  it("keeps pointer events on the selection dock", () => {
    expect(shouldDismissFromClassPath(["vad-canvas-dock", "button"])).toBe(false);
    expect(shouldDismissFromClassPath(["vad-cite-menu", "button"])).toBe(false);
  });

  it("keeps pointer events on the cite spawn menu", () => {
    expect(shouldDismissFromClassPath(["vad-cite-menu", "button"])).toBe(false);
    expect(shouldDismissFromClassPath(["vad-cite-port"])).toBe(false);
  });

  it("dismisses pointer events on settings, inspector, and agent chrome", () => {
    expect(shouldDismissFromClassPath(["vad-settings-overlay", "button"])).toBe(
      true,
    );
    expect(shouldDismissFromClassPath(["vad-inspector", "button"])).toBe(true);
    expect(shouldDismissFromClassPath(["vad-agent-column", "textarea"])).toBe(
      true,
    );
  });

  it("does not dismiss clicks on the selected artwork itself", () => {
    expect(shouldDismissFromClassPath(["tl-container", "tl-shape"])).toBe(false);
  });

  it("keeps pointer events on the spawn prompt composer", () => {
    expect(shouldDismissFromClassPath(["vad-spawn-prompt", "textarea"])).toBe(
      false,
    );
  });

  it("keeps canvas zoom controls clickable while an image is selected", () => {
    expect(shouldDismissFromClassPath(["vad-canvas-view-chrome", "button"])).toBe(
      false,
    );
    expect(shouldDismissFromClassPath(["vad-canvas-view-bar", "button"])).toBe(
      false,
    );
  });
});

describe("dismissCanvasSelection", () => {
  it("clears the canvas selection store", () => {
    useCanvasSelectionStore.getState().set({
      projectId: "p1",
      kind: "asset",
      pageId: "",
      pageName: "shot",
      assetId: "a1",
      assetIds: ["a1"],
    });
    dismissCanvasSelection();
    expect(useCanvasSelectionStore.getState().selection).toBeNull();
  });
});
