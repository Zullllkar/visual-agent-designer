/**
 * Vibeboard Bridge 入口
 * --------------------------------------------------------------
 * server.ts 调用 `createBridge({ port, hostname })` 得到一个请求门卫：
 * 命中 /mcp* 的请求交给 Bridge，其余放行给 Next。初始化（读 token、
 * 写 bridge.json）是异步的，初始化完成前对 /mcp* 返回 503。
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import {
  bridgeAuthEnabled,
  buildBridgeUrl,
  loadOrCreateBridgeToken,
  writeBridgeDiscovery,
} from "./config";
import { setHandoffBuildOrigin } from "./handoff-cache";
import { createBridgeHttpHandler, isBridgePath, type BridgeRuntime } from "./http";
import { VAD_ROOT } from "@/lib/vad/paths";

export { activeContext } from "./active-context";
export { BRIDGE_MCP_PATH, BRIDGE_SERVER_NAME } from "./config";

export interface BridgeHandle {
  /** 若请求属于 Bridge 则接管并返回 true（异步完成响应）。 */
  tryHandle(req: IncomingMessage, res: ServerResponse): boolean;
  ready: Promise<BridgeRuntime>;
}

export function createBridge(opts: { port: number; hostname: string }): BridgeHandle {
  let handler: ((req: IncomingMessage, res: ServerResponse) => Promise<void>) | null = null;

  const ready = (async (): Promise<BridgeRuntime> => {
    const authEnabled = bridgeAuthEnabled();
    const token = authEnabled ? await loadOrCreateBridgeToken() : null;
    const url = buildBridgeUrl(opts.hostname, opts.port);
    const runtime: BridgeRuntime = {
      url,
      port: opts.port,
      hostname: opts.hostname,
      token,
      authEnabled,
      startedAt: Date.now(),
    };
    setHandoffBuildOrigin(url.replace(/\/mcp$/, ""));
    await writeBridgeDiscovery({
      version: 1,
      url,
      port: opts.port,
      hostname: opts.hostname,
      token,
      pid: process.pid,
      startedAt: new Date(runtime.startedAt).toISOString(),
      vadRoot: VAD_ROOT,
    }).catch((err) => {
      console.warn("[bridge] failed to write bridge.json:", (err as Error).message);
    });
    handler = createBridgeHttpHandler(runtime);
    console.log(`> Bridge MCP at ${url}${authEnabled ? " (bearer token required)" : " (auth off)"}`);
    return runtime;
  })();

  ready.catch((err) => {
    console.error("[bridge] init failed:", err);
  });

  return {
    ready,
    tryHandle(req, res) {
      const pathname = (req.url ?? "/").split("?")[0];
      if (!isBridgePath(pathname)) return false;
      if (!handler) {
        void ready
          .then(() => handler?.(req, res))
          .catch(() => {
            res.writeHead(503, { "content-type": "application/json", "retry-after": "2" });
            res.end(JSON.stringify({ error: "bridge_starting" }));
          });
        return true;
      }
      void handler(req, res).catch((err) => {
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "bridge_internal", message: (err as Error).message }));
        } else {
          res.end();
        }
      });
      return true;
    },
  };
}
