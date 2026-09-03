#!/usr/bin/env node

/**
 * Vibeboard CLI — stdio MCP 转发器
 * --------------------------------------------------------------
 * `node cli.js mcp` 以 stdio 方式暴露 MCP，把每条 JSON-RPC 消息原样转发到
 * 正在运行的 Vibeboard 服务器的 Streamable HTTP 端点（/mcp），再把响应
 * （JSON 或 SSE）写回 stdout。进程本身无状态、不碰项目文件。
 *
 * 用于只支持 stdio 的 MCP 宿主，或端口会变的开发模式。首选仍是让宿主直接
 * 连接 HTTP 端点（见 Settings → 连接 coding agent）。
 *
 * 端点发现顺序：
 *   1. --url / --token 参数，或 VAD_BRIDGE_URL / VAD_BRIDGE_TOKEN 环境变量
 *   2. <root>/bridge/bridge.json，root 来自 --root、VAD_ROOT，否则 <cwd>/.vad
 *
 * 其他命令：
 *   node cli.js list       列出本机项目
 *   node cli.js status     打印当前 Bridge 端点与连通性
 */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const readline = require("node:readline");

const args = process.argv.slice(2);
const command = args[0] || "help";

function flag(name) {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function resolveVadRoot() {
  return flag("--root") || (process.env.VAD_ROOT && process.env.VAD_ROOT.trim()) || path.join(process.cwd(), ".vad");
}

function readDiscovery() {
  const file = path.join(resolveVadRoot(), "bridge", "bridge.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (parsed && parsed.version === 1 && typeof parsed.url === "string") return parsed;
  } catch {
    // 未启动或路径不对
  }
  return null;
}

function resolveEndpoint() {
  const url = flag("--url") || (process.env.VAD_BRIDGE_URL && process.env.VAD_BRIDGE_URL.trim());
  const token = flag("--token") || (process.env.VAD_BRIDGE_TOKEN && process.env.VAD_BRIDGE_TOKEN.trim()) || null;
  if (url) return { url, token, source: "args/env" };
  const disc = readDiscovery();
  if (disc) return { url: disc.url, token: disc.token || null, source: path.join(resolveVadRoot(), "bridge", "bridge.json") };
  return null;
}

// ─────────────────────────── mcp (stdio → http) ───────────────────────────

const NOT_RUNNING_MESSAGE =
  "Vibeboard is not running (or bridge.json was not found). Open the Vibeboard app, then retry. " +
  `Looked in: ${path.join(resolveVadRoot(), "bridge", "bridge.json")}`;

function writeOut(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function forward(payload) {
  const endpoint = resolveEndpoint();
  const messages = Array.isArray(payload) ? payload : [payload];
  const requestIds = messages.filter((m) => m && m.id !== undefined && m.method).map((m) => m.id);

  if (!endpoint) {
    for (const id of requestIds) writeOut(rpcError(id, -32000, NOT_RUNNING_MESSAGE));
    return;
  }

  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (endpoint.token) headers.authorization = `Bearer ${endpoint.token}`;

  let res;
  try {
    res = await fetch(endpoint.url, { method: "POST", headers, body: JSON.stringify(payload) });
  } catch (err) {
    for (const id of requestIds) {
      writeOut(rpcError(id, -32000, `${NOT_RUNNING_MESSAGE} (${err && err.message ? err.message : err})`));
    }
    return;
  }

  if (res.status === 202 || res.status === 204) return;

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const detail = text ? text.slice(0, 300) : res.statusText;
    for (const id of requestIds) {
      writeOut(rpcError(id, -32000, `Vibeboard bridge returned HTTP ${res.status}: ${detail}`));
    }
    return;
  }

  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("text/event-stream")) {
    await pumpSse(res.body);
    return;
  }
  const text = await res.text();
  if (!text.trim()) return;
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) parsed.forEach(writeOut);
    else writeOut(parsed);
  } catch {
    for (const id of requestIds) writeOut(rpcError(id, -32700, "Bridge returned non-JSON body"));
  }
}

async function pumpSse(body) {
  if (!body) return;
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines = [];
  const flush = () => {
    if (dataLines.length === 0) return;
    const data = dataLines.join("\n");
    dataLines = [];
    try {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) parsed.forEach(writeOut);
      else writeOut(parsed);
    } catch {
      // 非 JSON 的 SSE 事件（如 keep-alive）忽略
    }
  };
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).replace(/\r$/, "");
      buffer = buffer.slice(idx + 1);
      if (line === "") {
        flush();
        continue;
      }
      if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
      // event:/id:/retry:/注释行忽略
    }
  }
  flush();
}

async function runMcpForwarder() {
  // stdout 只能出 JSON-RPC；把 console.log 挪到 stderr
  console.log = console.error;
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let inflight = Promise.resolve();
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let payload;
    try {
      payload = JSON.parse(trimmed);
    } catch {
      writeOut(rpcError(null, -32700, "Parse error"));
      return;
    }
    // 串行转发，保证响应顺序与请求一致
    inflight = inflight.then(() => forward(payload)).catch((err) => {
      console.error("[vibeboard-mcp] forward failed:", err && err.message ? err.message : err);
    });
  });
  rl.on("close", () => {
    inflight.finally(() => process.exit(0));
  });
}

// ─────────────────────────── list / status ───────────────────────────

async function listProjects() {
  const dir = path.join(resolveVadRoot(), "projects");
  let entries = [];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    console.log(`No projects found under ${dir}`);
    return;
  }
  const projects = [];
  for (const id of entries) {
    try {
      const raw = await fsp.readFile(path.join(dir, id, "project.json"), "utf8");
      projects.push(JSON.parse(raw));
    } catch {
      // 跳过非项目目录
    }
  }
  projects.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  if (projects.length === 0) {
    console.log(`No projects found under ${dir}`);
    return;
  }
  console.log(`=== Vibeboard projects (${dir}) ===`);
  projects.forEach((p, i) => {
    console.log(`${i + 1}. [${p.id}] ${p.title} (${p.updatedAt})`);
    if (p.rawIdea) console.log(`   ${p.rawIdea}`);
  });
}

async function printStatus() {
  const endpoint = resolveEndpoint();
  if (!endpoint) {
    console.log("Bridge endpoint: not found");
    console.log(NOT_RUNNING_MESSAGE);
    process.exitCode = 1;
    return;
  }
  console.log(`Bridge endpoint: ${endpoint.url}`);
  console.log(`Token:           ${endpoint.token ? "present" : "none"}`);
  console.log(`Source:          ${endpoint.source}`);
  try {
    const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    if (endpoint.token) headers.authorization = `Bearer ${endpoint.token}`;
    const res = await fetch(endpoint.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "vibeboard-cli", version: "0.1.0" } },
      }),
    });
    console.log(`Reachable:       ${res.ok ? "yes" : `HTTP ${res.status}`}`);
    if (!res.ok) process.exitCode = 1;
  } catch (err) {
    console.log(`Reachable:       no (${err && err.message ? err.message : err})`);
    process.exitCode = 1;
  }
}

function printHelp() {
  console.log("=== Vibeboard CLI ===");
  console.log("Usage:");
  console.log("  node cli.js mcp [--root <vadRoot>] [--url <mcpUrl> --token <token>]");
  console.log("        stdio MCP server that forwards to the running Vibeboard (/mcp)");
  console.log("  node cli.js status [--root <vadRoot>]   show bridge endpoint and reachability");
  console.log("  node cli.js list   [--root <vadRoot>]   list local projects");
}

async function main() {
  if (command === "mcp") return runMcpForwarder();
  if (command === "list") return listProjects();
  if (command === "status") return printStatus();
  printHelp();
}

main().catch((err) => {
  console.error("CLI runtime error:", err);
  process.exit(1);
});
