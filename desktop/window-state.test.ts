import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { loadWindowState, saveWindowState, DEFAULT_BOUNDS } = require("./window-state.cjs") as {
  loadWindowState: (
    file: string,
    workArea?: { x?: number; y?: number; width: number; height: number }
  ) => {
    x?: number;
    y?: number;
    width: number;
    height: number;
    isMaximized: boolean;
  };
  saveWindowState: (
    win: {
      isDestroyed: () => boolean;
      isMaximized: () => boolean;
      getBounds: () => { x: number; y: number; width: number; height: number };
      getNormalBounds?: () => { x: number; y: number; width: number; height: number };
    },
    file: string
  ) => void;
  DEFAULT_BOUNDS: { width: number; height: number };
};

function tempStateFile() {
  return path.join(os.tmpdir(), `vad-window-state-${Date.now()}-${Math.random()}.json`);
}

describe("saveWindowState", () => {
  it("stores restored bounds when the window is maximized", () => {
    const file = tempStateFile();
    saveWindowState(
      {
        isDestroyed: () => false,
        isMaximized: () => true,
        getBounds: () => ({ x: 0, y: 0, width: 1920, height: 1040 }),
        getNormalBounds: () => ({ x: 120, y: 80, width: 1280, height: 800 }),
      },
      file
    );
    const saved = JSON.parse(fs.readFileSync(file, "utf8")) as {
      width: number;
      height: number;
      isMaximized: boolean;
    };
    expect(saved.width).toBe(1280);
    expect(saved.height).toBe(800);
    expect(saved.isMaximized).toBe(true);
  });
});

describe("loadWindowState", () => {
  it("does not reopen a work-area sized window as almost-fullscreen", () => {
    const file = tempStateFile();
    fs.writeFileSync(
      file,
      `${JSON.stringify({ x: 0, y: 0, width: 1920, height: 1040, isMaximized: false })}\n`,
      "utf8"
    );
    const state = loadWindowState(file, { width: 1920, height: 1040 });
    expect(state.width).toBe(DEFAULT_BOUNDS.width);
    expect(state.height).toBe(DEFAULT_BOUNDS.height);
    expect(state.isMaximized).toBe(false);
  });

  it("keeps maximized preference but opens splash at default size", () => {
    const file = tempStateFile();
    fs.writeFileSync(
      file,
      `${JSON.stringify({ x: 0, y: 0, width: 1920, height: 1040, isMaximized: true })}\n`,
      "utf8"
    );
    const state = loadWindowState(file, { width: 1920, height: 1040 });
    expect(state.width).toBe(DEFAULT_BOUNDS.width);
    expect(state.height).toBe(DEFAULT_BOUNDS.height);
    expect(state.isMaximized).toBe(true);
  });

  it("clamps a window restored from a disconnected monitor into the work area", () => {
    const file = tempStateFile();
    fs.writeFileSync(
      file,
      `${JSON.stringify({ x: -4200, y: -1800, width: 1280, height: 800, isMaximized: false })}\n`,
      "utf8"
    );
    const state = loadWindowState(file, { x: 0, y: 0, width: 1920, height: 1040 });
    expect(state.x).toBeGreaterThanOrEqual(-1200);
    expect(state.y).toBeGreaterThanOrEqual(-720);
    expect(state.x).toBeLessThan(1920);
    expect(state.y).toBeLessThan(1040);
  });
});
