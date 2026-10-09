import { describe, expect, it } from "vitest";
import {
  CANVAS_GRID_STYLES,
  canvasGridClassName,
  isCanvasGridVisible,
  parseCanvasGridStyle,
} from "./grid-style";

describe("parseCanvasGridStyle", () => {
  it("defaults to dots (current canvas grid)", () => {
    expect(parseCanvasGridStyle(undefined)).toBe("dots");
    expect(parseCanvasGridStyle(null)).toBe("dots");
    expect(parseCanvasGridStyle("nope")).toBe("dots");
  });

  it("accepts dots, lines, and none", () => {
    expect(parseCanvasGridStyle("dots")).toBe("dots");
    expect(parseCanvasGridStyle("lines")).toBe("lines");
    expect(parseCanvasGridStyle("none")).toBe("none");
  });
});

describe("canvas grid visibility and class", () => {
  it("hides the overlay when style is none", () => {
    expect(isCanvasGridVisible("none")).toBe(false);
    expect(isCanvasGridVisible("dots")).toBe(true);
    expect(isCanvasGridVisible("lines")).toBe(true);
  });

  it("maps each visible style to a modifier class", () => {
    expect(canvasGridClassName("dots")).toBe(
      "vad-ide-canvas-grid vad-ide-canvas-grid--dots",
    );
    expect(canvasGridClassName("lines")).toBe(
      "vad-ide-canvas-grid vad-ide-canvas-grid--lines",
    );
    expect(canvasGridClassName("none")).toBe("");
  });

  it("exposes the three picker options in screenshot order", () => {
    expect(CANVAS_GRID_STYLES.map((item) => item.id)).toEqual([
      "dots",
      "lines",
      "none",
    ]);
  });
});
