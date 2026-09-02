const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_BOUNDS = { width: 1280, height: 800 };
const WORK_AREA_SLACK = 32;

function isWorkAreaSized(width, height, workArea) {
  if (!workArea) return false;
  return (
    width >= workArea.width - WORK_AREA_SLACK &&
    height >= workArea.height - WORK_AREA_SLACK
  );
}

function loadWindowState(file, workArea) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      typeof raw.width === "number" &&
      typeof raw.height === "number" &&
      raw.width >= 640 &&
      raw.height >= 480
    ) {
      const workAreaSized = isWorkAreaSized(raw.width, raw.height, workArea);
      return {
        x: typeof raw.x === "number" && !workAreaSized ? raw.x : undefined,
        y: typeof raw.y === "number" && !workAreaSized ? raw.y : undefined,
        width: workAreaSized ? DEFAULT_BOUNDS.width : raw.width,
        height: workAreaSized ? DEFAULT_BOUNDS.height : raw.height,
        isMaximized: Boolean(raw.isMaximized),
      };
    }
  } catch {
    /* first launch */
  }
  return { ...DEFAULT_BOUNDS, isMaximized: false };
}

function saveWindowState(win, file) {
  if (!win || win.isDestroyed()) return;
  const bounds =
    typeof win.getNormalBounds === "function"
      ? win.getNormalBounds()
      : win.getBounds();
  const state = {
    ...bounds,
    isMaximized: win.isMaximized(),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

module.exports = { loadWindowState, saveWindowState, DEFAULT_BOUNDS };
