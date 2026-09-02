const path = require("node:path");

const APP_ID = "com.vibeboard.desktop";
const PRODUCT_NAME = "Vibeboard";
const DESKTOP_PORT = Number(process.env.PORT ?? 18765);

/**
 * @param {{ getPath: (name: string) => string }} app
 */
function resolveDesktopPaths(app, env = process.env) {
  const userData = app.getPath("userData");
  return {
    userData,
    vadRoot: env.VAD_ROOT?.trim() || path.join(userData, "vad"),
    checkpoints:
      env.VAD_CHECKPOINTS_DIR?.trim() || path.join(userData, "vad-data"),
    logsDir: path.join(userData, "logs"),
    windowState: path.join(userData, "window-state.json"),
    uiTheme: path.join(userData, "ui-theme.json"),
  };
}

function sidecarRoot(packaged, repoRoot, resourcesPath) {
  if (!packaged) return null;
  return path.join(resourcesPath, "sidecar");
}

module.exports = {
  APP_ID,
  PRODUCT_NAME,
  DESKTOP_PORT,
  resolveDesktopPaths,
  sidecarRoot,
};
