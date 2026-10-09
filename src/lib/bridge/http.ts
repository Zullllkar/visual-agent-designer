/**
 * Bridge HTTP 层
 * --------------------------------------------------------------
 * 挂在自定义 server 上，先于 Next 处理：
 *   /mcp            Streamable HTTP MCP 端点（Host / Origin / Bearer 三道校验）
 *   /mcp/status     设置面板用：url、认证、活跃项目、已连接客户端、深链与命令
 *   /mcp/agents     检测本机 CLI + 各端是否已注册（会 spawn --version，稍慢）
 *   /mcp/install    POST {agent, action}：写入对方配置 / 调对方 CLI
 *   /mcp/build/*    预览 / 启动 / 取消本机 coding agent CLI（需先关联仓库）
 *   /mcp/desktop/capture-agent  桌面壳注册 / 心跳 / 注销截图代理（需 Bearer bridge token）
 *   /mcp/desktop/provider-config 桌面壳推送钥匙串里的 provider 配置（需 Bearer bridge token）
 *
 * 管理端点只接受同源浏览器请求或无 Origin 的本机进程；MCP 端点额外要求 token。
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { ProjectFile } from "@/lib/project/schema";
import { loadMergedProjectFromVad, saveProjectToVad } from "@/lib/vad/storage";
import { activeContext } from "./active-context";
import { bearerToken, constantTimeEqual } from "./auth";
import { cancelBuild, getBuild, listBuilds, prepareBuild, startBuild } from "./build-runner";
import { captureAgent } from "./capture-agent";
import { bridgeClients, classifyClientName } from "./clients";
import { BRIDGE_MCP_PATH, BRIDGE_SERVER_NAME } from "./config";
import { applyProposalToProject } from "./design-proposal";
import { detectAllAgentClis } from "./detect";
import { invalidateHandoffCache } from "./handoff-cache";
import { listImplementationReports } from "./implementation-review";
import { installAgent, registrationStatus, uninstallAgent } from "./install-exec";
import {
  BRIDGE_AGENT_SLUGS,
  type BridgeEndpoint,
  cursorInstallDeeplink,
  describeInstallCommand,
  isBridgeAgentSlug,
} from "./install-planner";
import { BRIDGE_SERVER_VERSION, createBridgeMcpServer, publicRequest } from "./mcp-server";
import { bridgeRequests, isAutoApproveAssets, setAutoApproveAssets } from "./pending-requests";
import {
  clearPersistedProviderConfig,
  providerCacheStatus,
  rememberPersistedProviderConfig,
} from "./provider-cache";
import type { ProviderConfig } from "@/lib/providers/registry";

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

  return async function handleBridgeRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
    const pathname = url.pathname;

    if (!isLoopbackHostHeader(req.headers.host)) {
      return sendJson(res, 403, {
        error: "forbidden_host",
        message: "Bridge only accepts loopback Host headers.",
      });
    }

    if (pathname === BRIDGE_MCP_PATH) {
      return handleMcp(req, res, runtime);
    }

    if (!isSameOriginOrNonBrowser(req)) {
      return sendJson(res, 403, {
        error: "forbidden_origin",
        message: "Management endpoints require a same-origin request.",
      });
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
        commands: Object.fromEntries(
          BRIDGE_AGENT_SLUGS.map((slug) => [slug, describeInstallCommand(slug, endpoint)]),
        ),
        autoApproveAssets: isAutoApproveAssets(),
        providerCache: providerCacheStatus(activeContext.snapshot().projectId),
        pendingRequests: bridgeRequests.list({ status: "pending" }).length,
        desktopCapture: captureAgent.status(),
      });
    }

    if (pathname === `${BRIDGE_MCP_PATH}/desktop/capture-agent`) {
      // 注册方是桌面壳主进程；用 bridge token 证明它确实读到了本服务的 /mcp/status
      if (runtime.authEnabled) {
        const presented = bearerToken(req.headers.authorization);
        if (!presented || !runtime.token || !constantTimeEqual(presented, runtime.token)) {
          return sendJson(res, 401, {
            error: "unauthorized",
            message: "Capture agent registration requires the bridge Bearer token.",
          });
        }
      }
      if (req.method === "GET") {
        return sendJson(res, 200, { ok: true, ...captureAgent.status() });
      }
      if (req.method === "DELETE") {
        const raw = req.headers["x-capture-token"];
        const presented = typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
        return sendJson(res, 200, { ok: captureAgent.unregister(presented) });
      }
      if (req.method === "POST") {
        let body: { url?: unknown; token?: unknown; pid?: unknown; version?: unknown };
        try {
          body = JSON.parse(await readBody(req, 8 * 1024));
        } catch {
          return sendJson(res, 400, { error: "invalid_json" });
        }
        const agentUrl = typeof body.url === "string" ? body.url.trim() : "";
        const agentToken = typeof body.token === "string" ? body.token.trim() : "";
        if (!isLoopbackHttpUrl(agentUrl) || agentToken.length < 16) {
          return sendJson(res, 400, {
            error: "invalid_input",
            message: "Need a loopback http url and a token of at least 16 chars.",
          });
        }
        const reg = captureAgent.register({
          url: agentUrl,
          token: agentToken,
          pid: typeof body.pid === "number" ? body.pid : undefined,
          version: typeof body.version === "string" ? body.version : undefined,
        });
        return sendJson(res, 200, {
          ok: true,
          registeredAt: new Date(reg.registeredAt).toISOString(),
          heartbeatMs: 30_000,
        });
      }
      return sendJson(res, 405, { error: "method_not_allowed" });
    }

    if (pathname === `${BRIDGE_MCP_PATH}/desktop/provider-config`) {
      if (runtime.authEnabled) {
        const presented = bearerToken(req.headers.authorization);
        if (!presented || !runtime.token || !constantTimeEqual(presented, runtime.token)) {
          return sendJson(res, 401, {
            error: "unauthorized",
            message: "Provider config push requires the bridge Bearer token.",
          });
        }
      }
      if (req.method === "DELETE") {
        clearPersistedProviderConfig();
        return sendJson(res, 200, { ok: true, providerCache: providerCacheStatus() });
      }
      if (req.method === "POST") {
        let body: unknown;
        try {
          body = JSON.parse(await readBody(req, 64 * 1024));
        } catch {
          return sendJson(res, 400, { error: "invalid_json" });
        }
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          return sendJson(res, 400, { error: "invalid_input", message: "Expected a ProviderConfig object." });
        }
        const accepted = rememberPersistedProviderConfig(body as ProviderConfig);
        if (!accepted) {
          return sendJson(res, 400, {
            error: "no_usable_provider",
            message: "Config has no non-mock llm or image provider; nothing to persist.",
          });
        }
        return sendJson(res, 200, { ok: true, providerCache: providerCacheStatus() });
      }
      return sendJson(res, 405, { error: "method_not_allowed" });
    }

    if (pathname === `${BRIDGE_MCP_PATH}/requests` && req.method === "GET") {
      const projectId = url.searchParams.get("projectId") ?? undefined;
      const includeResolved = url.searchParams.get("all") === "1";
      const all = bridgeRequests.list(projectId ? { projectId } : undefined);
      return sendJson(res, 200, {
        ok: true,
        autoApproveAssets: isAutoApproveAssets(),
        requests: (includeResolved ? all : all.filter((r) => r.status === "pending")).map(
          publicRequest,
        ),
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
        return sendJson(res, 400, {
          error: "invalid_input",
          message: "Need requestId and action approve|reject|answer.",
        });
      }
      const resolution =
        action === "approve"
          ? ({ action: "approve" } as const)
          : action === "reject"
            ? ({
                action: "reject",
                reason: typeof body.reason === "string" ? body.reason : undefined,
              } as const)
            : ({
                action: "answer",
                answer: typeof body.answer === "string" ? body.answer : "",
              } as const);
      if (resolution.action === "answer" && !resolution.answer.trim()) {
        return sendJson(res, 400, {
          error: "empty_answer",
          message: "answer must be a non-empty string.",
        });
      }

      // 提案：先真的改 Layout IR 并落盘，成功了才算 approved；失败保持 pending 让设计侧决定
      const pendingReq = bridgeRequests.get(requestId);
      if (pendingReq?.kind === "proposal" && pendingReq.proposal && resolution.action === "approve") {
        const project = await loadMergedProjectFromVad(pendingReq.projectId).catch(() => null);
        if (!project) {
          return sendJson(res, 404, { error: "project_not_found", message: `No project ${pendingReq.projectId}.` });
        }
        const applied = applyProposalToProject(project, pendingReq.proposal);
        if (!applied.ok) {
          return sendJson(res, 409, { error: "apply_failed", message: applied.error });
        }
        try {
          await saveProjectToVad(applied.project);
        } catch (err) {
          return sendJson(res, 500, { error: "save_failed", message: (err as Error).message });
        }
        invalidateHandoffCache(project.id);
        const updated = bridgeRequests.resolve(requestId, { action: "approve", appliedSummary: applied.summary });
        if (!updated) {
          return sendJson(res, 409, { error: "not_pending", message: "Request not found or already handled." });
        }
        return sendJson(res, 200, { ok: true, request: publicRequest(updated), applied: applied.summary });
      }

      const updated = bridgeRequests.resolve(requestId, resolution);
      if (!updated) {
        return sendJson(res, 409, {
          error: "not_pending",
          message: "Request not found or already handled.",
        });
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
      const registrations = await Promise.all(
        BRIDGE_AGENT_SLUGS.map((slug) => registrationStatus(slug, endpoint)),
      );
      return sendJson(res, 200, {
        ok: true,
        agents: BRIDGE_AGENT_SLUGS.map((slug) => ({
          slug,
          cli: detected.find((d) => d.slug === slug),
          registration: registrations.find((r) => r.slug === slug),
          lastConnectedAt: bridgeClients.list().find((c) => classifyClientName(c.name) === slug)
            ?.lastSeenAt,
        })),
      });
    }

    if (pathname === `${BRIDGE_MCP_PATH}/build` && req.method === "GET") {
      const projectId = url.searchParams.get("projectId") ?? activeContext.snapshot().projectId;
      if (!projectId) {
        return sendJson(res, 400, { error: "missing_project", message: "Pass ?projectId=..." });
      }
      return sendJson(res, 200, { ok: true, projectId, runs: listBuilds(projectId) });
    }

    if (pathname === `${BRIDGE_MCP_PATH}/build/run` && req.method === "GET") {
      const id = url.searchParams.get("id") ?? "";
      const after = Number(url.searchParams.get("after") ?? "0");
      if (!id) return sendJson(res, 400, { error: "missing_id", message: "Pass ?id=..." });
      const run = getBuild(id, Number.isFinite(after) ? after : 0);
      if (!run) return sendJson(res, 404, { error: "not_found" });
      return sendJson(res, 200, { ok: true, run });
    }

    if (pathname === `${BRIDGE_MCP_PATH}/build/preview` && req.method === "POST") {
      const parsed = await readBuildRequest(req);
      if (!parsed.ok) return sendJson(res, parsed.status, parsed.body);
      const result = prepareBuild({
        project: parsed.project,
        slug: parsed.agent,
        extraPrompt: parsed.extraPrompt,
        model: parsed.model,
        bridgeUrl: runtime.url,
        bridgeToken: runtime.authEnabled ? runtime.token : null,
      });
      if (!result.ok) return sendJson(res, 400, { error: result.code, message: result.error });
      const p = result.prepared;
      return sendJson(res, 200, {
        ok: true,
        slug: p.slug,
        bin: p.bin,
        binPath: p.binPath,
        version: p.version,
        argv: p.argv,
        command: p.command,
        cwd: p.cwd,
        fingerprint: p.fingerprint,
        prompt: p.prompt,
        promptChars: p.prompt.length,
        envKeys: p.envKeys,
        warnings: p.warnings,
        installUrl: p.installUrl,
      });
    }

    if (pathname === `${BRIDGE_MCP_PATH}/build/start` && req.method === "POST") {
      const parsed = await readBuildRequest(req);
      if (!parsed.ok) return sendJson(res, parsed.status, parsed.body);
      if (!parsed.fingerprint) {
        return sendJson(res, 400, {
          error: "missing_fingerprint",
          message: "Preview first, then send the fingerprint.",
        });
      }
      const result = await startBuild({
        project: parsed.project,
        slug: parsed.agent,
        extraPrompt: parsed.extraPrompt,
        model: parsed.model,
        fingerprint: parsed.fingerprint,
        confirm: parsed.confirm,
        bridgeUrl: runtime.url,
        bridgeToken: runtime.authEnabled ? runtime.token : null,
      });
      if (!result.ok) {
        return sendJson(res, result.code === "already_running" ? 409 : 400, {
          error: result.code,
          message: result.error,
          fingerprint: result.prepared?.fingerprint,
          command: result.prepared?.command,
        });
      }
      return sendJson(res, 200, { ok: true, run: result.run });
    }

    if (pathname === `${BRIDGE_MCP_PATH}/build/cancel` && req.method === "POST") {
      let body: { runId?: unknown };
      try {
        body = JSON.parse(await readBody(req, 4096));
      } catch {
        return sendJson(res, 400, { error: "invalid_json" });
      }
      const runId = typeof body.runId === "string" ? body.runId : "";
      if (!runId) return sendJson(res, 400, { error: "missing_run_id" });
      const result = cancelBuild(runId);
      if (!result.ok)
        return sendJson(res, result.code === "not_found" ? 404 : 409, {
          error: result.code,
          message: result.error,
        });
      return sendJson(res, 200, { ok: true, run: result.run });
    }

    if (pathname === `${BRIDGE_MCP_PATH}/install` && req.method === "POST") {
      if (!/^application\/json/i.test(req.headers["content-type"] ?? "")) {
        return sendJson(res, 415, {
          error: "unsupported_media_type",
          message: "Send application/json.",
        });
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
      const result =
        action === "install"
          ? await installAgent(body.agent, endpoint)
          : await uninstallAgent(body.agent, endpoint);
      return sendJson(res, result.ok ? 200 : 500, result);
    }

    return sendJson(res, 404, { error: "not_found" });
  };
}

// ───────────────────────── MCP endpoint ─────────────────────────

async function handleMcp(
  req: IncomingMessage,
  res: ServerResponse,
  runtime: BridgeRuntime,
): Promise<void> {
  const origin = req.headers.origin;
  if (origin && !isLoopbackOrigin(origin)) {
    return sendJson(res, 403, {
      error: "forbidden_origin",
      message: "Only loopback origins may call the Bridge.",
    });
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
        message:
          "Missing or invalid Bearer token. Re-run the install from Vibeboard → Settings → Connect coding agent.",
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

/** 截图代理只允许回环 http：桌面壳和本服务同机，没有理由跨主机 */
export function isLoopbackHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" && isLoopbackOrigin(u.origin);
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
    return (
      `${u.hostname}${u.port ? `:${u.port}` : ""}`.toLowerCase() === host.toLowerCase() ||
      u.host.toLowerCase() === host.toLowerCase()
    );
  } catch {
    return false;
  }
}

function applyCors(res: ServerResponse, origin: string): void {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  );
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, Mcp-Protocol-Version");
  res.setHeader("Access-Control-Max-Age", "600");
}

// ───────────────────────── io ─────────────────────────

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
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

type BuildRequestOk = {
  ok: true;
  project: ProjectFile;
  agent: (typeof BRIDGE_AGENT_SLUGS)[number];
  extraPrompt?: string;
  model?: string;
  fingerprint?: string;
  confirm: boolean;
};

async function readBuildRequest(
  req: IncomingMessage,
): Promise<BuildRequestOk | { ok: false; status: number; body: unknown }> {
  let body: {
    projectId?: unknown;
    agent?: unknown;
    extraPrompt?: unknown;
    model?: unknown;
    fingerprint?: unknown;
    confirm?: unknown;
  };
  try {
    body = JSON.parse(await readBody(req, 256 * 1024));
  } catch {
    return { ok: false, status: 400, body: { error: "invalid_json" } };
  }
  if (!isBridgeAgentSlug(body.agent)) {
    return {
      ok: false,
      status: 400,
      body: { error: "invalid_agent", allowed: BRIDGE_AGENT_SLUGS },
    };
  }
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  if (!projectId) {
    return {
      ok: false,
      status: 400,
      body: { error: "missing_project", message: "Need projectId." },
    };
  }
  const project = await loadMergedProjectFromVad(projectId).catch(() => null);
  if (!project) {
    return {
      ok: false,
      status: 404,
      body: { error: "project_not_found", message: `No project ${projectId}.` },
    };
  }
  return {
    ok: true,
    project,
    agent: body.agent,
    extraPrompt: typeof body.extraPrompt === "string" ? body.extraPrompt : undefined,
    model: typeof body.model === "string" ? body.model : undefined,
    fingerprint: typeof body.fingerprint === "string" ? body.fingerprint : undefined,
    confirm: body.confirm === true,
  };
}
