/**
 * 桌面截图代理。
 * --------------------------------------------------------------
 * coding agent 调 report_implementation 只给 url 时，Next 进程把请求转到这里，
 * 用隐藏的离屏 BrowserWindow 加载页面并截整页，PNG 回传。
 *
 * 只监听 127.0.0.1 随机端口 + Bearer token；启动后向 Next 注册并定期心跳。
 * 纯函数（校验 / 注册报文）与依赖 Electron 的部分分开，便于单测。
 */

const http = require("node:http");
const { randomBytes } = require("node:crypto");

const DEFAULT_WIDTH = 1440;
const DEFAULT_HEIGHT = 900;
const MIN_EDGE = 320;
const MAX_WIDTH = 2560;
/** 整页最高多少像素；再高的页面截图和 vision 都吃不消 */
const MAX_HEIGHT = 6000;
const DEFAULT_DELAY_MS = 800;
const MAX_DELAY_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_TIMEOUT_MS = 60_000;
const BODY_LIMIT = 16 * 1024;
const HEARTBEAT_MS = 30_000;

function clampInt(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.round(v)));
}

/**
 * 校验并归一化截图请求。返回 { ok:true, request } 或 { ok:false, error }。
 * @param {unknown} body
 */
function parseCaptureRequest(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "body must be a JSON object" };
  }
  const raw = /** @type {Record<string, unknown>} */ (body);
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "url must be an absolute http(s) URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "url must be http or https" };
  }
  return {
    ok: true,
    request: {
      url: parsed.toString(),
      width: clampInt(raw.width, MIN_EDGE, MAX_WIDTH, DEFAULT_WIDTH),
      height: clampInt(raw.height, MIN_EDGE, MAX_HEIGHT, DEFAULT_HEIGHT),
      fullPage: raw.fullPage !== false,
      delayMs: clampInt(raw.delayMs, 0, MAX_DELAY_MS, DEFAULT_DELAY_MS),
      timeoutMs: clampInt(raw.timeoutMs, 3_000, MAX_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    },
  };
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bearerFrom(header) {
  if (typeof header !== "string") return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function newCaptureToken() {
  return `cap_${randomBytes(24).toString("base64url")}`;
}

/** 注册报文（纯函数，便于测试） */
function registrationPayload({ agentUrl, agentToken, version }) {
  return {
    url: agentUrl,
    token: agentToken,
    pid: process.pid,
    version: version ?? null,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * 用隐藏离屏窗口截图。
 * @param {typeof import('electron').BrowserWindow} BrowserWindow
 * @param {{url:string,width:number,height:number,fullPage:boolean,delayMs:number,timeoutMs:number}} request
 */
async function captureWithWindow(BrowserWindow, request) {
  const deadline = Date.now() + request.timeoutMs;
  const remaining = () => Math.max(500, deadline - Date.now());
  const win = new BrowserWindow({
    show: false,
    width: request.width,
    height: request.height,
    useContentSize: true,
    webPreferences: {
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  try {
    win.webContents.setAudioMuted(true);
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    await withTimeout(win.loadURL(request.url), remaining(), "page load");
    await sleep(Math.min(request.delayMs, remaining()));

    if (request.fullPage) {
      const docHeight = await withTimeout(
        win.webContents.executeJavaScript(
          "Math.max(document.documentElement ? document.documentElement.scrollHeight : 0, document.body ? document.body.scrollHeight : 0)",
          true
        ),
        remaining(),
        "measure document"
      );
      const target = clampInt(docHeight, request.height, MAX_HEIGHT, request.height);
      if (target !== request.height) {
        win.setContentSize(request.width, target);
        // 让布局与懒加载图片有机会跟上新视口
        await sleep(Math.min(400, remaining()));
      }
    }

    const image = await withTimeout(win.webContents.capturePage(), remaining(), "capturePage");
    const size = image.getSize();
    return {
      ok: true,
      pngBase64: image.toPNG().toString("base64"),
      width: size.width,
      height: size.height,
      finalUrl: win.webContents.getURL(),
      title: win.webContents.getTitle(),
    };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

/**
 * 起回环 HTTP 服务。截图串行执行，避免同时开多个渲染进程。
 * @param {{ token: string, BrowserWindow: typeof import('electron').BrowserWindow, logger?: {info:(m:string)=>void,error:(m:string)=>void} }} opts
 */
async function createCaptureServer({ token, BrowserWindow, logger }) {
  let queue = Promise.resolve();

  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || (req.url ?? "").split("?")[0] !== "/capture") {
      sendJson(res, 404, { ok: false, error: "not_found" });
      return;
    }
    if (!constantTimeEqual(bearerFrom(req.headers.authorization) ?? "", token)) {
      sendJson(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
    let body;
    try {
      body = JSON.parse(await readBody(req, BODY_LIMIT));
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid_json" });
      return;
    }
    const parsed = parseCaptureRequest(body);
    if (!parsed.ok) {
      sendJson(res, 400, { ok: false, error: parsed.error });
      return;
    }
    const request = parsed.request;
    const run = queue.then(async () => {
      const started = Date.now();
      try {
        const result = await captureWithWindow(BrowserWindow, request);
        logger?.info(
          `capture ok ${request.url} ${result.width}x${result.height} ${Date.now() - started}ms`
        );
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger?.error(`capture failed ${request.url}: ${message}`);
        return { ok: false, error: message };
      }
    });
    queue = run.then(
      () => undefined,
      () => undefined
    );
    const result = await run;
    sendJson(res, result.ok ? 200 : 500, result);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const url = `http://127.0.0.1:${port}`;
  logger?.info(`capture agent listening at ${url}`);

  return {
    url,
    port,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/** 从 /mcp/status 拿 bridge token（本机非浏览器请求无需 Origin） */
async function fetchBridgeToken(serverOrigin) {
  const res = await fetch(`${serverOrigin}/mcp/status`, { cache: "no-store" });
  if (!res.ok) throw new Error(`/mcp/status ${res.status}`);
  const json = await res.json();
  return {
    token: typeof json.token === "string" ? json.token : null,
    authEnabled: json.authEnabled !== false,
  };
}

/**
 * 向 Next 注册（也用于心跳）。返回 true 表示对方接受。
 * @param {{ serverOrigin: string, agentUrl: string, agentToken: string, version?: string }} opts
 */
async function registerCaptureAgent({ serverOrigin, agentUrl, agentToken, version }) {
  const { token, authEnabled } = await fetchBridgeToken(serverOrigin);
  if (authEnabled && !token) {
    throw new Error("bridge requires a token but /mcp/status did not return one");
  }
  const res = await fetch(`${serverOrigin}/mcp/desktop/capture-agent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(registrationPayload({ agentUrl, agentToken, version })),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`register ${res.status} ${text.slice(0, 200)}`);
  }
  return true;
}

async function unregisterCaptureAgent({ serverOrigin, agentToken }) {
  const { token } = await fetchBridgeToken(serverOrigin);
  await fetch(`${serverOrigin}/mcp/desktop/capture-agent`, {
    method: "DELETE",
    headers: {
      "x-capture-token": agentToken,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
}

module.exports = {
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  MAX_HEIGHT,
  HEARTBEAT_MS,
  parseCaptureRequest,
  registrationPayload,
  newCaptureToken,
  createCaptureServer,
  registerCaptureAgent,
  unregisterCaptureAgent,
  captureWithWindow,
};
