/**
 * Next.js Custom Server
 * --------------------------------------------------------------
 * 挂载 WebSocket 到 HTTP 服务器。
 * Next 16 自定义 server 下 Turbopack 常导致 App Router API route
 * 未注册（/api/* 全部落到 HTML 404）；开发态强制 webpack。
 */

import { createServer } from "node:http";
import next from "next";
import { createBridge } from "./src/lib/bridge";
import { attachWebSocketHandler } from "./src/lib/ws/server";

const dev = process.env.NODE_ENV !== "production";
// 本地优先：默认只监听回环地址。需要局域网访问时显式设置 HOSTNAME=0.0.0.0。
const hostname = process.env.HOSTNAME ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);

const nextDir = process.env.VAD_NEXT_DIR?.trim() || process.cwd();

const app = next({
  dev,
  hostname,
  port,
  dir: nextDir,
  // 自定义 server + Turbopack：Windows 上 app-paths-manifest 不完整，
  // /api/* 与 /projects/[id] 会误走 not-found HTML。
  ...(dev ? { turbopack: false, webpack: true } : {}),
});
const handler = app.getRequestHandler();

function isHealthPath(url: string): boolean {
  const path = url.split("?")[0];
  return path === "/api/health";
}

let requestHandler: ReturnType<typeof app.getRequestHandler> | null = null;

// coding agent 通过 /mcp 读取设计上下文（Streamable HTTP MCP）
const bridge = createBridge({ port, hostname });

const server = createServer((req, res) => {
  const url = req.url ?? "/";
  if (bridge.tryHandle(req, res)) return;
  if (isHealthPath(url)) {
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify({ ok: true, ready: requestHandler != null }));
    return;
  }
  if (!requestHandler) {
    res.writeHead(503, {
      "content-type": "text/plain; charset=utf-8",
      "retry-after": "2",
    });
    res.end("starting");
    return;
  }
  requestHandler(req, res);
});

attachWebSocketHandler(server);

server.listen(port, hostname, () => {
  console.log(
    `> Listening on http://${hostname}:${port} (preparing Next${dev ? " webpack" : ""})`
  );
});

app
  .prepare()
  .then(() => {
    requestHandler = handler;
    console.log(
      `> Ready on http://${hostname}:${port} (WebSocket at /ws, MCP at /mcp)` +
        (dev ? " [webpack]" : "")
    );
  })
  .catch((error) => {
    console.error("[server] Next prepare failed:", error);
    process.exit(1);
  });
