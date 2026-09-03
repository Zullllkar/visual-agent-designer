/**
 * Bridge HTTP 层
 * --------------------------------------------------------------
 * 挂在自定义 server 上，先于 Next 处理：
 *   /mcp            Streamable HTTP MCP 端点（Host / Origin / Bearer 三道校验）
 *   /mcp/status     设置面板用：url、认证、活跃项目、已连接客户端、深链与命令
 *   /mcp/agents     检测本机 CLI + 各端是否已注册（会 spawn --version，稍慢）
 *   /mcp/install    POST {agent, action}：写入对方配置 / 调对方 CLI
 *
 * 管理端点只接受同源浏览器请求或无 Origin 的本机进程；MCP 端点额外要求 token。
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { activeContext } from "./active-context";
import { bridgeClients, classifyClientName } from "./clients";
import { BRIDGE_MCP_PATH, BRIDGE_SERVER_NAME } from "./config";
import { detectAllAgentClis } from "./detect";
import { listImplementationReports } from "./implementation-review";
import { installAgent, registrationStatus, uninstallAgent } from "./install-exec";
import {
  BRIDGE_AGENT_SLUGS,
  cursorInstallDeeplink,
  describeInstallCommand,
  isBridgeAgentSlug,
  type BridgeEndpoint,
} from "./install-planner";
import { createBridgeMcpServer, BRIDGE_SERVER_VERSION, publicRequest } from "./mcp-server";
import {
  bridgeRequests,
  isAutoApproveAssets,
  setAutoApproveAssets,
} from "./pending-requests";
import { providerCacheStatus } from "./provider-cache";

export interface BridgeRuntime {
  url: string;
  port: number;
  hostname: string;
  token: string | null;
  authEnabled: boolean;
  startedAt: number;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]", "0.0.0.0"]);

export function isBridgePath(pathname: string): boolean {
  return pathname === BRIDGE_MCP_PATH || pathname.startsWith(`${BRIDGE_MCP_PATH}/`);
}

export function createBridgeHttpHandler(runtime: BridgeRuntime) {
  const endpoint: BridgeEndpoint = {
    url: runtime.url,
    token: runtime.authEnabled ? runtime.token : null,
    serverName: BRIDGE_SERVER_NAME,
  };

  return async function handleBridgeRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
    const pathname = url.pathname;

    if (!isLoopbackHostHeader(req.headers.host)) {
      return sendJson(res, 403, { error: "forbidden_host", message: "Bridge only accepts loopback Host headers." });
    }

    if (pathname === BRIDGE_MCP_PATH) {
      return handleMcp(req, res, runtime);
    }

    if (!isSameOriginOrNonBrowser(req)) {
      return sendJson(res, 403, { error: "forbidden_origin", message: "Management endpoints require a same-origin request." });
    }

    if (pathname === `${BRIDGE_MCP_PATH}/status` && req.method === "GET") {
      return sendJson(res, 200, {
        ok: true,
        serverName: BRIDGE_SERVER_NAME,
        serverVersion: BRIDGE_SERVER_VERSION,
        url: runtime.url,
        port: runtime.port,
        authEnabled: runtime.authEnabled,
        token: runtime.authEnabled ? runtime.token : null,
        startedAt: new Date(runtime.startedAt).toISOString(),
        activeContext: activeContext.snapshot(),
        clients: bridgeClients.list().map((c) => ({ ...c, slug: classifyClientName(c.name) })),
        cursorDeeplink: cursorInstallDeeplink(endpoint),
        commands: Object.fromEntries(BRIDGE_AGENT_SLUGS.map((slug) => [slug, describeInstallCommand(slug, endpoint)])),
        autoApproveAssets: isAutoApproveAssets(),
        providerCache: providerCacheStatus(activeContext.snapshot().projectId),
        pendingRequests: bridgeRequests.list({ status: "pending" }).length,
      });
    }

    if (pathname === `${BRIDGE_MCP_PATH}/requests` && req.method === "GET") {
      const projectId = url.searchParams.get("projectId") ?? undefined;
      const includeResolved = url.searchParams.get("all") === "1";
      const all = bridgeRequests.list(projectId ? { projectId } : undefined);
      return sendJson(res, 200, {
        ok: true,
        autoApproveAssets: isAutoApproveAssets(),
        requests: (includeResolved ? all : all.filter((r) => r.status === "pending")).map(publicRequest),
      });
    }

    if (pathname === `${BRIDGE_MCP_PATH}/requests` && req.method === "POST") {
      let body: { requestId?: unknown; action?: unknown; answer?: unknown; reason?: unknown };
      try {
        body = JSON.parse(await readBody(req, 64 * 1024));
      } catch {
        return sendJson(res, 400, { error: "invalid_json" });
      }
      const requestId = typeof body.requestId === "string" ? body.requestId : "";
      const action = body.action;
      if (!requestId || (action !== "approve" && action !== "reject" && action !== "answer")) {
        return sendJson(res, 400, { error: "invalid_input", message: "Need requestId and action approve|reject|answer." });
      }
      const resolution =
        action === "approve"
          ? ({ action: "approve" } as const)
          : action === "reject"
            ? ({ action: "reject", reason: typeof body.reason === "string" ? body.reason : undefined } as const)
            : ({ action: "answer", answer: typeof body.answer === "string" ? body.answer : "" } as const);
      if (resolution.action === "answer" && !resolution.answer.trim()) {
        return sendJson(res, 400, { error: "empty_answer", message: "answer must be a non-empty string." });
      }
      const updated = bridgeRequests.resolve(requestId, resolution);
      if (!updated) {
        return sendJson(res, 409, { error: "not_pending", message: "Request not found or already handled." });
      }
      return sendJson(res, 200, { ok: true, request: publicRequest(updated) });
    }

    if (pathname === `${BRIDGE_MCP_PATH}/auto-approve` && req.method === "POST") {
      let body: { enabled?: unknown };
      try {
        body = JSON.parse(await readBody(req, 4096));
      } catch {
        return sendJson(res, 400, { error: "invalid_json" });
      }
      setAutoApproveAssets(body.enabled === true);
      return sendJson(res, 200, { ok: true, autoApproveAssets: isAutoApproveAssets() });
    }

    if (pathname === `${BRIDGE_MCP_PATH}/reports` && req.method === "GET") {
      const projectId = url.searchParams.get("projectId") ?? activeContext.snapshot().projectId;
      if (!projectId) {
        return sendJson(res, 400, { error: "missing_project", message: "Pass ?projectId=..." });
      }
      const reports = await listImplementationReports(projectId, 20);
      return sendJson(res, 200, { ok: true, projectId, reports });
    }

    if (pathname === `${BRIDGE_MCP_PATH}/agents` && req.method === "GET") {
      const detected = detectAllAgentClis();
      const registrations = await Promise.all(BRIDGE_AGENT_SLUGS.map((slug) => registrationStatus(slug, endpoint)));
      return sendJson(res, 200, {
        ok: true,
        agents: BRIDGE_AGENT_SLUGS.map((slug) => ({
          slug,
          cli: detected.find((d) => d.slug === slug),
          registration: registrations.find((r) => r.slug === slug),
          lastConnectedAt: bridgeClients.list().find((c) => classifyClientName(c.name) === slug)?.lastSeenAt,
        })),
      });
    }

    if (pathname === `${BRIDGE_MCP_PATH}/install` && req.method === "POST") {
      if (!/^application\/json/i.test(req.headers["content-type"] ?? "")) {
        return sendJson(res, 415, { error: "unsupported_media_type", message: "Send application/json." });
      }
      let body: { agent?: unknown; action?: unknown };
      try {
        body = JSON.parse(await readBody(req, 64 * 1024));
      } catch {
        return sendJson(res, 400, { error: "invalid_json" });
      }
      if (!isBridgeAgentSlug(body.agent)) {
        return sendJson(res, 400, { error: "invalid_agent", allowed: BRIDGE_AGENT_SLUGS });
      }
      const action = body.action === "uninstall" ? "uninstall" : "install";
      const result = action === "install" ? await installAgent(body.agent, endpoint) : await uninstallAgent(body.agent, endpoint);
      return sendJson(res, result.ok ? 200 : 500, result);
    }

    return sendJson(res, 404, { error: "not_found" });
  };
}

// ───────────────────────── MCP endpoint ─────────────────────────

async function handleMcp(req: IncomingMessage, res: ServerResponse, runtime: BridgeRuntime): Promise<void> {
  const origin = req.headers.origin;
  if (origin && !isLoopbackOrigin(origin)) {
    return sendJson(res, 403, { error: "forbidden_origin", message: "Only loopback origins may call the Bridge." });
  }
  if (origin) applyCors(res, origin);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (runtime.authEnabled) {
    const presented = bearerToken(req.headers.authorization);
    if (!presented || !runtime.token || !constantTimeEqual(presented, runtime.token)) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="vibeboard-bridge"');
      return sendJson(res, 401, {
        error: "unauthorized",
        message: "Missing or invalid Bearer token. Re-run the install from Vibeboard → Settings → Connect coding agent.",
      });
    }
  }

  const server = createBridgeMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: false,
  });
  res.on("close", () => {
    void transport.close().catch(() => undefined);
    void server.close().catch(() => undefined);
  });
  try {
    await server.connect(transport);
    // 无会话模式下每个请求都是新实例，initialize 与 initialized 落在不同实例上，
    // 所以直接在传输层截获 initialize 请求记录 clientInfo。
    const forward = transport.onmessage;
    transport.onmessage = (message, extra) => {
      if (isInitializeRequest(message)) {
        bridgeClients.record(message.params.clientInfo);
      }
      forward?.(message, extra);
    };
    await transport.handleRequest(req, res);
  } catch (err) {
    if (!res.headersSent) {
      sendJson(res, 500, { error: "bridge_internal", message: (err as Error).message });
    } else {
      res.end();
    }
  }
}

// ───────────────────────── guards ─────────────────────────

function hostnameOf(hostHeader: string): string {
  const h = hostHeader.trim();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end > 0 ? h.slice(0, end + 1) : h;
  }
  const idx = h.lastIndexOf(":");
  return idx > 0 ? h.slice(0, idx) : h;
}

export function isLoopbackHostHeader(host: string | undefined): boolean {
  if (!host) return false;
  return LOOPBACK_HOSTS.has(hostnameOf(host).toLowerCase());
}

export function isLoopbackOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return LOOPBACK_HOSTS.has(u.hostname.toLowerCase()) || u.hostname === "[::1]";
  } catch {
    return false;
  }
}

/** 浏览器请求必须与 Host 同源；非浏览器（无 Origin）放行。 */
export function isSameOriginOrNonBrowser(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const u = new URL(origin);
    const host = req.headers.host ?? "";
    return `${u.hostname}${u.port ? `:${u.port}` : ""}`.toLowerCase() === host.toLowerCase() || u.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function applyCors(res: ServerResponse, origin: string): void {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, Mcp-Protocol-Version");
  res.setHeader("Access-Control-Max-Age", "600");
}

// ───────────────────────── io ─────────────────────────

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
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
