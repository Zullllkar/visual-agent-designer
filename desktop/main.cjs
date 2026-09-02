/**
 * Vibeboard 桌面主进程。
 * 窗口 / 菜单 / 用户数据 / sidecar 生命周期；业务仍在 Next 进程。
 */

const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  nativeTheme,
  screen,
  shell,
} = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { createLogger } = require("./log.cjs");
const { isHttpUrl, isLocalAppUrl } = require("./origin.cjs");
const { parseHealthResponse } = require("./health.cjs");
const { resolveDevSidecarSpawn } = require("./sidecar.cjs");
const {
  killPidTree,
  parseNextAlreadyRunning,
  releaseConflictingNextDev,
  shouldKillConflictingNext,
} = require("./next-dev-lock.cjs");
const { splashDataUrl } = require("./splash.cjs");
const {
  APP_ID,
  DESKTOP_PORT,
  PRODUCT_NAME,
  resolveDesktopPaths,
  sidecarRoot,
} = require("./paths.cjs");
const { loadUiTheme, saveUiTheme, windowChrome } = require("./theme.cjs");
const { loadWindowState, saveWindowState } = require("./window-state.cjs");

const REPO_ROOT = path.resolve(__dirname, "..");
const ICON_PNG = path.join(__dirname, "icons", "icon.png");
const POLL_MS = 500;

app.setName(PRODUCT_NAME);
if (process.platform === "win32") {
  app.setAppUserModelId(APP_ID);
}

const PORT = Number(process.env.PORT ?? DESKTOP_PORT);
const SERVER_ORIGIN = `http://127.0.0.1:${PORT}`;

/** @type {import('electron').BrowserWindow | null} */
let mainWindow = null;
/** @type {import('node:child_process').ChildProcess | null} */
let spawnedServer = null;
/** @type {boolean} */
let spawnedByThisProcess = false;
/** @type {Error | null} */
let sidecarSpawnError = null;
let sidecarOutput = "";
let releasedNextConflict = false;
/** @type {ReturnType<typeof createLogger> | null} */
let logger = null;
/** @type {ReturnType<typeof resolveDesktopPaths> | null} */
let desktopPaths = null;
let restoreMaximized = false;

function currentUiTheme() {
  return desktopPaths ? loadUiTheme(desktopPaths.uiTheme) : "light";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function showSplash(win, message) {
  if (!win || win.isDestroyed()) return;
  const url = splashDataUrl(message, windowChrome(currentUiTheme()));
  const current = win.webContents.getURL();
  if (current.startsWith("data:text/html")) {
    try {
      await win.webContents.executeJavaScript(
        `(function(){var n=document.getElementById("splash-msg");if(n)n.textContent=${JSON.stringify(message)};})()`
      );
      return;
    } catch {
      /* reload below */
    }
  }
  await win.loadURL(url);
}

function readyTimeoutMs() {
  return app.isPackaged ? 60_000 : 180_000;
}

function probeHealth() {
  return new Promise((resolve) => {
    const req = http.get(`${SERVER_ORIGIN}/api/health`, (res) => {
      const chunks = [];
      res.on("data", (chunk) => {
        chunks.push(chunk);
      });
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve(parseHealthResponse(res.statusCode ?? 0, body));
      });
    });
    req.on("error", () => resolve("down"));
    req.setTimeout(4000, () => {
      req.destroy();
      resolve("down");
    });
  });
}

/** 健康检查通过后，等首页编译完再离开闪屏，避免白屏把动画冲掉。 */
function probeAppPage(timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get(`${SERVER_ORIGIN}/`, (res) => {
      res.resume();
      const code = res.statusCode ?? 0;
      if (code === 503) {
        resolve("starting");
        return;
      }
      if (code >= 200 && code < 400) {
        resolve("ready");
        return;
      }
      resolve("down");
    });
    req.on("error", () => resolve("down"));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve("timeout");
    });
  });
}

async function waitUntilAppPage() {
  const timeoutMs = readyTimeoutMs();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = Math.max(5_000, deadline - Date.now());
    const status = await probeAppPage(remaining);
    if (status === "ready") return;
    if (status === "timeout") break;
    await sleep(POLL_MS);
  }
  throw new Error(
    `等待界面编译超时（${timeoutMs / 1000}s）：${SERVER_ORIGIN}`
  );
}

function sidecarEnv() {
  const paths = desktopPaths;
  return {
    ...process.env,
    PORT: String(PORT),
    HOSTNAME: "127.0.0.1",
    VAD_DESKTOP: "1",
    VAD_ROOT: paths.vadRoot,
    VAD_CHECKPOINTS_DIR: paths.checkpoints,
    VAD_PROJECT_ROOT: app.isPackaged
      ? path.join(sidecarRoot(true, REPO_ROOT, process.resourcesPath), "app")
      : REPO_ROOT,
  };
}

function onSidecarSpawnError(err) {
  const raw = err instanceof Error ? err.message : String(err);
  sidecarSpawnError = new Error(`启动本地服务失败：${raw}`);
  logger?.error(sidecarSpawnError.message);
}

function attachSidecarOutput(child) {
  sidecarOutput = "";
  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) continue;
    stream.on("data", (chunk) => {
      const text = String(chunk);
      sidecarOutput += text;
      process.stdout.write(text);
    });
  }
}

function spawnDevServer() {
  const spec = resolveDevSidecarSpawn({
    platform: process.platform,
    repoRoot: REPO_ROOT,
    env: process.env,
  });
  logger?.info(`spawn sidecar ${spec.command} ${spec.args.join(" ")}`);
  const child = spawn(spec.command, spec.args, {
    ...spec.options,
    env: sidecarEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  attachSidecarOutput(child);
  child.once("error", onSidecarSpawnError);
  return child;
}

function spawnPackagedServer() {
  const root = sidecarRoot(true, REPO_ROOT, process.resourcesPath);
  const nodeName = process.platform === "win32" ? "node.exe" : "node";
  const nodeBin = path.join(root, nodeName);
  const serverJs = path.join(root, "server.cjs");
  const appDir = path.join(root, "app");
  if (!fs.existsSync(nodeBin) || !fs.existsSync(serverJs)) {
    throw new Error(
      `安装包缺少 sidecar（${nodeBin} 或 ${serverJs}）。请用 pnpm dist:desktop 重新打包。`
    );
  }
  return spawn(nodeBin, [serverJs], {
    cwd: appDir,
    env: {
      ...sidecarEnv(),
      NODE_ENV: "production",
      VAD_NEXT_DIR: appDir,
    },
    stdio: "inherit",
    windowsHide: true,
    detached: false,
  });
}

function spawnVadServer() {
  sidecarSpawnError = null;
  return app.isPackaged ? spawnPackagedServer() : spawnDevServer();
}

function killSpawnedServer() {
  const child = spawnedServer;
  if (!child || !spawnedByThisProcess) return;
  if (child.exitCode !== null || child.killed) {
    spawnedServer = null;
    spawnedByThisProcess = false;
    return;
  }
  const pid = child.pid;
  spawnedServer = null;
  spawnedByThisProcess = false;
  if (!pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  child.kill("SIGTERM");
}

async function waitUntilReady(onStarting) {
  const timeoutMs = readyTimeoutMs();
  const deadline = Date.now() + timeoutMs;
  let announcedStarting = false;
  while (Date.now() < deadline) {
    if (sidecarSpawnError) {
      throw sidecarSpawnError;
    }
    if (spawnedByThisProcess && spawnedServer) {
      if (spawnedServer.exitCode !== null || spawnedServer.killed) {
        throw new Error("本地服务在就绪前退出");
      }
    }
    const status = await probeHealth();
    if (status === "ready") return;
    if (status === "starting" && !announcedStarting) {
      announcedStarting = true;
      onStarting?.();
    }
    await sleep(POLL_MS);
  }
  throw new Error(
    `等待本地服务超时（${timeoutMs / 1000}s）：${SERVER_ORIGIN}`
  );
}

function failAndQuit(title, message) {
  logger?.error(message);
  console.error(`[desktop] ${message}`);
  dialog.showErrorBox(title, message);
  app.quit();
}

function openExternalSafe(url) {
  if (!isHttpUrl(url) || isLocalAppUrl(url, PORT)) return;
  void shell.openExternal(url);
}

function attachWindowGuards(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isLocalAppUrl(url, PORT)) return { action: "allow" };
    openExternalSafe(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("data:text/html")) return;
    if (isLocalAppUrl(url, PORT)) return;
    event.preventDefault();
    openExternalSafe(url);
  });
  win.webContents.on("before-input-event", (event, input) => {
    if (!app.isPackaged) return;
    const key = String(input.key || "").toLowerCase();
    if (key === "f12") {
      event.preventDefault();
      return;
    }
    if (
      input.control &&
      input.shift &&
      (key === "i" || key === "j" || key === "c")
    ) {
      event.preventDefault();
    }
  });
}

function showAbout() {
  const paths = desktopPaths;
  void dialog.showMessageBox({
    type: "info",
    title: `关于 ${PRODUCT_NAME}`,
    message: PRODUCT_NAME,
    detail: [
      `版本 ${app.getVersion()}`,
      app.isPackaged ? "安装包" : "开发壳",
      "",
      `项目数据：${paths.vadRoot}`,
      `会话记忆：${paths.checkpoints}`,
      `日志：${paths.logsDir}`,
    ].join("\n"),
  });
}

function openDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  void shell.openPath(dir);
}

let recentProjects = [];

function sendRendererCommand(detail) {
  mainWindow?.webContents.send("desktop:command", detail);
}

function menuSections() {
  const isMac = process.platform === "darwin";
  const recents =
    recentProjects.length > 0
      ? recentProjects.map((item) => ({
          label: item.title || item.id,
          click: () =>
            sendRendererCommand({ id: "open-project", projectId: item.id }),
        }))
      : [{ label: "还没有项目", enabled: false }];
  return {
    file: {
      label: "文件",
      submenu: [
        {
          label: "开始创作",
          accelerator: "CommandOrControl+N",
          click: () => sendRendererCommand({ id: "new-brief" }),
        },
        {
          label: "导入项目…",
          click: () => sendRendererCommand({ id: "import-project" }),
        },
        { label: "最近项目", submenu: recents },
        {
          label: "设置",
          accelerator: "CommandOrControl+,",
          click: () => sendRendererCommand({ id: "open-settings" }),
        },
        { type: "separator" },
        {
          label: "全部创作",
          click: () => sendRendererCommand({ id: "open-gallery" }),
        },
        {
          label: "打开项目目录",
          click: () => openDir(desktopPaths.vadRoot),
        },
        {
          label: "打开用户数据",
          click: () => openDir(desktopPaths.userData),
        },
        {
          label: "打开日志",
          click: () => openDir(desktopPaths.logsDir),
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit", label: "退出" },
      ],
    },
    edit: {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" },
      ],
    },
    view: {
      label: "查看",
      submenu: [
        {
          label: "收起侧栏",
          click: () => sendRendererCommand({ id: "toggle-rail" }),
        },
        {
          label: "减少动态效果",
          click: () => sendRendererCommand({ id: "toggle-motion" }),
        },
        { type: "separator" },
        ...(app.isPackaged
          ? []
          : [
              { role: "reload", label: "重新加载" },
              { role: "forceReload", label: "强制重新加载" },
              { role: "toggleDevTools", label: "开发者工具" },
              { type: "separator" },
            ]),
        { role: "resetZoom", label: "实际大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "全屏" },
      ],
    },
    help: {
      label: "帮助",
      submenu: [
        {
          label: "快捷键",
          click: () =>
            sendRendererCommand({ id: "open-settings", section: "shortcuts" }),
        },
        { label: `关于 ${PRODUCT_NAME}`, click: () => showAbout() },
      ],
    },
  };
}

function buildAppMenu() {
  const sections = menuSections();
  const template = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    sections.file,
    sections.edit,
    sections.view,
    sections.help,
  ];
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    return;
  }
  Menu.setApplicationMenu(null);
}

function createWindow() {
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const state = loadWindowState(desktopPaths.windowState, workArea);
  restoreMaximized = state.isMaximized;
  const chrome = windowChrome(currentUiTheme());
  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 960,
    minHeight: 640,
    title: PRODUCT_NAME,
    backgroundColor: chrome.background,
    show: false,
    icon: fs.existsSync(ICON_PNG) ? ICON_PNG : undefined,
    titleBarStyle: "hidden",
    ...(process.platform === "darwin"
      ? {}
      : {
          titleBarOverlay: {
            color: chrome.overlay,
            symbolColor: chrome.symbol,
            height: 40,
          },
        }),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  attachWindowGuards(mainWindow);
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
  const persist = () => saveWindowState(mainWindow, desktopPaths.windowState);
  mainWindow.on("resize", persist);
  mainWindow.on("move", persist);
  mainWindow.on("close", persist);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  return mainWindow;
}

function windowFromEvent(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

function registerIpc() {
  ipcMain.handle("desktop:getInfo", () => ({
    runtime: "electron",
    packaged: app.isPackaged,
    version: app.getVersion(),
    platform: process.platform,
    vadRoot: desktopPaths.vadRoot,
    checkpoints: desktopPaths.checkpoints,
    logsDir: desktopPaths.logsDir,
    port: PORT,
  }));

  ipcMain.handle("desktop:isMaximized", (event) => {
    return Boolean(windowFromEvent(event)?.isMaximized());
  });

  ipcMain.on("desktop:window", (event, action) => {
    const win = windowFromEvent(event);
    if (!win) return;
    if (action === "minimize") win.minimize();
    if (action === "maximize") {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    }
    if (action === "close") win.close();
  });

  ipcMain.on("desktop:open-path", (_event, which) => {
    if (which === "vadRoot") openDir(desktopPaths.vadRoot);
    if (which === "userData") openDir(desktopPaths.userData);
    if (which === "logs") openDir(desktopPaths.logsDir);
  });

  ipcMain.on("desktop:open-project", (_event, projectId) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(String(projectId ?? ""))) return;
    openDir(path.join(desktopPaths.vadRoot, "projects", projectId));
  });

  ipcMain.on("desktop:set-recents", (_event, items) => {
    recentProjects = Array.isArray(items) ? items.slice(0, 8) : [];
  });

  ipcMain.on("desktop:popup-menu", (event, payload) => {
    const win = windowFromEvent(event);
    if (!win || !payload?.id) return;
    const section = menuSections()[payload.id];
    if (!section) return;
    const menu = Menu.buildFromTemplate(section.submenu);
    menu.popup({
      window: win,
      x: Number(payload.x) || 0,
      y: Number(payload.y) || 0,
    });
  });

  ipcMain.on("desktop:titlebar-theme", (event, theme) => {
    const next = theme === "dark" ? "dark" : "light";
    nativeTheme.themeSource = next;
    if (desktopPaths) saveUiTheme(desktopPaths.uiTheme, next);
    const win = windowFromEvent(event);
    if (!win || process.platform === "darwin" || !win.setTitleBarOverlay) {
      return;
    }
    const chrome = windowChrome(next);
    win.setTitleBarOverlay({
      color: chrome.overlay,
      symbolColor: chrome.symbol,
      height: 40,
    });
  });

  const FILE_MAX_BYTES = 48 * 1024 * 1024;

  function dialogFilters(raw) {
    if (!Array.isArray(raw)) {
      return [{ name: "JSON", extensions: ["json"] }];
    }
    return raw
      .filter(
        (item) =>
          item &&
          typeof item.name === "string" &&
          Array.isArray(item.extensions)
      )
      .map((item) => ({
        name: String(item.name).slice(0, 40),
        extensions: item.extensions
          .map((ext) => String(ext).replace(/[^a-z0-9]/gi, ""))
          .filter(Boolean)
          .slice(0, 8),
      }))
      .filter((item) => item.extensions.length > 0)
      .slice(0, 8);
  }

  ipcMain.handle("desktop:save-file", async (event, payload) => {
    const win = windowFromEvent(event);
    if (!win || !payload || typeof payload.data !== "string") {
      return { ok: false };
    }
    if (Buffer.byteLength(payload.data, "utf8") > FILE_MAX_BYTES) {
      return { ok: false };
    }
    const defaultPath = path.basename(String(payload.defaultPath || "export.json"));
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath,
      filters: dialogFilters(payload.filters),
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    await fs.promises.writeFile(filePath, payload.data, "utf8");
    return { ok: true, path: filePath };
  });

  ipcMain.handle("desktop:open-file", async (event, payload) => {
    const win = windowFromEvent(event);
    if (!win) return { ok: false };
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      filters: dialogFilters(payload?.filters),
    });
    if (canceled || !filePaths?.[0]) return { ok: false, canceled: true };
    const filePath = filePaths[0];
    const stat = await fs.promises.stat(filePath);
    if (stat.size > FILE_MAX_BYTES) return { ok: false };
    const data = await fs.promises.readFile(filePath, "utf8");
    return { ok: true, path: filePath, data };
  });
}

async function startDesktop() {
  desktopPaths = resolveDesktopPaths(app);
  fs.mkdirSync(desktopPaths.vadRoot, { recursive: true });
  fs.mkdirSync(desktopPaths.checkpoints, { recursive: true });
  logger = createLogger(desktopPaths.logsDir);
  logger.info(
    `start packaged=${app.isPackaged} origin=${SERVER_ORIGIN} vadRoot=${desktopPaths.vadRoot}`
  );

  nativeTheme.themeSource = currentUiTheme();
  registerIpc();
  buildAppMenu();
  const win = createWindow();
  await showSplash(win, "正在连接本地服务…");

  for (;;) {
    const status = await probeHealth();
    if (status === "ready") {
      logger.info(`reusing ${SERVER_ORIGIN}`);
      break;
    }
    if (status === "starting") {
      logger.info(`waiting for existing sidecar at ${SERVER_ORIGIN}`);
      await showSplash(win, "正在编译界面，第一次会稍慢…");
      try {
        await waitUntilReady();
        break;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger?.error(message);
        const choice = dialog.showMessageBoxSync(win, {
          type: "error",
          title: PRODUCT_NAME,
          message: "无法启动本地服务",
          detail: `${message}\n\n日志目录：${desktopPaths.logsDir}`,
          buttons: ["继续等待", "打开日志", "退出"],
          defaultId: 0,
          cancelId: 2,
          noLink: true,
        });
        if (choice === 1) {
          openDir(desktopPaths.logsDir);
          continue;
        }
        if (choice === 2) {
          app.quit();
          return;
        }
        continue;
      }
    }
    logger.info(`spawning sidecar for ${SERVER_ORIGIN}`);
    if (!app.isPackaged && !releasedNextConflict) {
      const released = releaseConflictingNextDev({
        repoRoot: REPO_ROOT,
        keepPort: PORT,
      });
      if (released) {
        releasedNextConflict = true;
        logger.info(`stopped leftover Next PID ${released.pid} on :${released.port}`);
      }
    }
    await showSplash(win, "正在启动本地服务，首次编译可能需要一两分钟…");
    try {
      spawnedServer = spawnVadServer();
      spawnedByThisProcess = true;
      spawnedServer.once("error", onSidecarSpawnError);
      await waitUntilReady(() => {
        void showSplash(win, "正在编译界面，第一次会稍慢…");
      });
      break;
    } catch (err) {
      const conflict = parseNextAlreadyRunning(sidecarOutput);
      if (
        conflict?.pid &&
        shouldKillConflictingNext({ keepPort: PORT, runningPort: conflict.port }) &&
        !releasedNextConflict
      ) {
        releasedNextConflict = true;
        logger.info(`stopping leftover Next PID ${conflict.pid}`);
        killPidTree(conflict.pid);
        killSpawnedServer();
        continue;
      }
      const message = err instanceof Error ? err.message : String(err);
      logger?.error(message);
      killSpawnedServer();
      const choice = dialog.showMessageBoxSync(win, {
        type: "error",
        title: PRODUCT_NAME,
        message: "无法启动本地服务",
        detail: `${message}\n\n日志目录：${desktopPaths.logsDir}`,
        buttons: ["重试", "打开日志", "退出"],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      });
      if (choice === 1) {
        openDir(desktopPaths.logsDir);
        continue;
      }
      if (choice === 2) {
        app.quit();
        return;
      }
    }
  }

  await showSplash(win, "正在加载界面…");
  await waitUntilAppPage();
  await win.loadURL(SERVER_ORIGIN);
  if (restoreMaximized && !win.isDestroyed()) win.maximize();
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    startDesktop().catch((err) => {
      failAndQuit(
        PRODUCT_NAME,
        err instanceof Error ? err.message : String(err)
      );
    });
  });

  app.on("window-all-closed", () => {
    killSpawnedServer();
    app.quit();
  });

  app.on("before-quit", () => {
    killSpawnedServer();
  });
}
