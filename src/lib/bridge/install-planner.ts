/**
 * Install Planner（纯函数）
 * --------------------------------------------------------------
 * 把 Bridge 端点（url + token）映射成各 coding agent 的注册动作：
 *   claude : 自带 `claude mcp add`，shell out 继承其校验与合并规则
 *   codex  : `codex mcp add --url`，再补 TOML 段里的 headers / required / timeout；
 *            没装 codex 时直接写 ~/.codex/config.toml
 *   cursor : 深链一键安装；失败回退深合并 ~/.cursor/mcp.json
 *
 * 不做任何 IO，便于单测；执行器在 install-exec.ts。
 */

import path from "node:path";

export const BRIDGE_AGENT_SLUGS = ["claude", "codex", "cursor"] as const;
export type BridgeAgentSlug = (typeof BRIDGE_AGENT_SLUGS)[number];

export function isBridgeAgentSlug(value: unknown): value is BridgeAgentSlug {
  return typeof value === "string" && (BRIDGE_AGENT_SLUGS as readonly string[]).includes(value);
}

export interface BridgeEndpoint {
  url: string;
  token: string | null;
  serverName: string;
}

export interface PlanContext {
  home: string;
  platform: NodeJS.Platform;
  /** 对应 CLI 是否可用（决定 codex 走 cli 还是直接写 TOML）。 */
  hasCli: boolean;
}

export interface CliInstallPlan {
  kind: "cli";
  slug: BridgeAgentSlug;
  bin: string;
  addArgv: string[];
  removeArgv: string[];
  getArgv: string[];
  /** cli 成功后追加的 TOML 修补（codex 用）。 */
  tomlPatch?: TomlInstallPlan;
}

export interface JsonInstallPlan {
  kind: "json";
  slug: BridgeAgentSlug;
  configPath: string;
  keyPath: string[];
  serverKey: string;
  entry: Record<string, unknown>;
}

export interface TomlInstallPlan {
  kind: "toml";
  slug: BridgeAgentSlug;
  configPath: string;
  table: string;
  entries: Record<string, string>;
}

export type InstallPlan = CliInstallPlan | JsonInstallPlan | TomlInstallPlan;

export function authHeaderValue(endpoint: BridgeEndpoint): string | null {
  return endpoint.token ? `Bearer ${endpoint.token}` : null;
}

export function planAgentInstall(
  slug: BridgeAgentSlug,
  endpoint: BridgeEndpoint,
  ctx: PlanContext
): InstallPlan {
  const { home } = ctx;
  const name = endpoint.serverName;
  const auth = authHeaderValue(endpoint);

  switch (slug) {
    case "claude": {
      const addArgv = ["mcp", "add", "--transport", "http", "--scope", "user", name, endpoint.url];
      if (auth) addArgv.push("--header", `Authorization: ${auth}`);
      return {
        kind: "cli",
        slug,
        bin: "claude",
        addArgv,
        removeArgv: ["mcp", "remove", "--scope", "user", name],
        getArgv: ["mcp", "get", name],
      };
    }

    case "codex": {
      const toml: TomlInstallPlan = {
        kind: "toml",
        slug,
        configPath: path.join(home, ".codex", "config.toml"),
        table: `mcp_servers.${name}`,
        entries: {
          url: tomlString(endpoint.url),
          ...(auth ? { http_headers: `{ Authorization = ${tomlString(auth)} }` } : {}),
          // Codex 对可选服务器只等 1 秒握手；标记 required 并放宽启动超时
          required: "true",
          startup_timeout_sec: "10.0",
        },
      };
      if (!ctx.hasCli) return toml;
      return {
        kind: "cli",
        slug,
        bin: "codex",
        addArgv: ["mcp", "add", name, "--url", endpoint.url],
        removeArgv: ["mcp", "remove", name],
        getArgv: ["mcp", "get", name],
        tomlPatch: toml,
      };
    }

    case "cursor": {
      return {
        kind: "json",
        slug,
        configPath: path.join(home, ".cursor", "mcp.json"),
        keyPath: ["mcpServers"],
        serverKey: name,
        entry: cursorServerEntry(endpoint),
      };
    }

    default: {
      const exhaustive: never = slug;
      throw new Error(`unknown agent slug: ${String(exhaustive)}`);
    }
  }
}

/** Cursor mcp.json / 深链共用的服务条目。 */
export function cursorServerEntry(endpoint: BridgeEndpoint): Record<string, unknown> {
  const auth = authHeaderValue(endpoint);
  return {
    type: "http",
    url: endpoint.url,
    ...(auth ? { headers: { Authorization: auth } } : {}),
  };
}

/** cursor://anysphere.cursor-deeplink/prompt?text=…（≤8000 字符，用户需确认才执行） */
export function cursorPromptDeeplink(text: string): string {
  const clipped = text.length > 1800 ? `${text.slice(0, 1797)}...` : text;
  const url = new URL("cursor://anysphere.cursor-deeplink/prompt");
  url.searchParams.set("text", clipped);
  return url.toString();
}

/** cursor://anysphere.cursor-deeplink/mcp/install?name=…&config=base64(entry) */
export function cursorInstallDeeplink(endpoint: BridgeEndpoint): string {
  const config = Buffer.from(JSON.stringify(cursorServerEntry(endpoint)), "utf8").toString("base64");
  const params = new URLSearchParams({ name: endpoint.serverName, config });
  return `cursor://anysphere.cursor-deeplink/mcp/install?${params.toString()}`;
}

/** 供 UI「复制命令」使用的可读命令行。 */
export function describeInstallCommand(slug: BridgeAgentSlug, endpoint: BridgeEndpoint): string {
  const auth = authHeaderValue(endpoint);
  switch (slug) {
    case "claude":
      return [
        "claude mcp add --transport http --scope user",
        endpoint.serverName,
        endpoint.url,
        ...(auth ? ["--header", shellQuote(`Authorization: ${auth}`)] : []),
      ].join(" ");
    case "codex":
      return [
        `codex mcp add ${endpoint.serverName} --url ${endpoint.url}`,
        "# then add to ~/.codex/config.toml under [mcp_servers.vibeboard]:",
        ...(auth ? [`#   http_headers = { Authorization = ${tomlString(auth)} }`] : []),
        "#   required = true",
        "#   startup_timeout_sec = 10.0",
      ].join("\n");
    case "cursor":
      return JSON.stringify({ mcpServers: { [endpoint.serverName]: cursorServerEntry(endpoint) } }, null, 2);
  }
}

// ───────────────────────── JSON deep-merge ─────────────────────────

export function applyJsonInstall(existingText: string | null, plan: JsonInstallPlan): string {
  const root = parseJsonObject(existingText, plan.configPath);
  let cursor: Record<string, unknown> = root;
  for (const key of plan.keyPath) {
    const next = cursor[key];
    if (next == null || typeof next !== "object" || Array.isArray(next)) cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[plan.serverKey] = plan.entry;
  return `${JSON.stringify(root, null, 2)}\n`;
}

export function removeJsonInstall(existingText: string | null, plan: JsonInstallPlan): string | null {
  if (existingText == null || existingText.trim() === "") return null;
  const root = parseJsonObject(existingText, plan.configPath);
  let cursor: Record<string, unknown> = root;
  for (const key of plan.keyPath) {
    const next = cursor[key];
    if (next == null || typeof next !== "object" || Array.isArray(next)) return null;
    cursor = next as Record<string, unknown>;
  }
  if (!(plan.serverKey in cursor)) return null;
  delete cursor[plan.serverKey];
  return `${JSON.stringify(root, null, 2)}\n`;
}

export function jsonHasInstall(existingText: string | null, plan: JsonInstallPlan): boolean {
  if (!existingText?.trim()) return false;
  try {
    let cursor: unknown = JSON.parse(existingText);
    for (const key of plan.keyPath) {
      if (!cursor || typeof cursor !== "object") return false;
      cursor = (cursor as Record<string, unknown>)[key];
    }
    return Boolean(cursor && typeof cursor === "object" && plan.serverKey in (cursor as object));
  } catch {
    return false;
  }
}

function parseJsonObject(text: string | null, where: string): Record<string, unknown> {
  if (text == null || text.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`existing config at ${where} is not valid JSON: ${(err as Error).message}`);
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`existing config at ${where} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

// ───────────────────────── TOML table upsert ─────────────────────────

/**
 * 在 TOML 文本里 upsert 一个表（如 [mcp_servers.vibeboard]）的若干键。
 * 只改动目标表内的受管键，其他内容原样保留；表不存在则追加到末尾。
 */
export function upsertTomlTable(
  existingText: string | null,
  table: string,
  entries: Record<string, string>
): string {
  const text = existingText ?? "";
  const lines = text.length ? text.split(/\r?\n/) : [];
  const headerRe = tomlTableHeaderRegex(table);

  const start = lines.findIndex((line) => headerRe.test(line));
  if (start === -1) {
    const block = [`[${table}]`, ...Object.entries(entries).map(([k, v]) => `${k} = ${v}`)];
    const prefix = lines.length && lines[lines.length - 1].trim() !== "" ? [...lines, ""] : lines;
    return `${[...prefix, ...block].join("\n")}\n`;
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*\[/.test(lines[i])) {
      end = i;
      break;
    }
  }

  const body = lines.slice(start + 1, end);
  const pending = new Map(Object.entries(entries));
  const rewritten = body.map((line) => {
    const m = line.match(/^\s*([A-Za-z0-9_-]+)\s*=/);
    if (!m) return line;
    const key = m[1];
    if (!pending.has(key)) return line;
    const value = pending.get(key)!;
    pending.delete(key);
    return `${key} = ${value}`;
  });
  // 追加缺失键：插到表体最后一个非空行之后，保留原有尾部空行
  let insertAt = rewritten.length;
  while (insertAt > 0 && rewritten[insertAt - 1].trim() === "") insertAt -= 1;
  const additions = [...pending.entries()].map(([k, v]) => `${k} = ${v}`);
  const newBody = [...rewritten.slice(0, insertAt), ...additions, ...rewritten.slice(insertAt)];

  const out = [...lines.slice(0, start + 1), ...newBody, ...lines.slice(end)];
  return `${out.join("\n").replace(/\n+$/, "")}\n`;
}

export function removeTomlTable(existingText: string | null, table: string): string | null {
  if (!existingText?.trim()) return null;
  const lines = existingText.split(/\r?\n/);
  const headerRe = tomlTableHeaderRegex(table);
  const start = lines.findIndex((line) => headerRe.test(line));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*\[/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const out = [...lines.slice(0, start), ...lines.slice(end)];
  const joined = out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "");
  return joined ? `${joined}\n` : "";
}

export function tomlHasTable(existingText: string | null, table: string): boolean {
  if (!existingText?.trim()) return false;
  const headerRe = tomlTableHeaderRegex(table);
  return existingText.split(/\r?\n/).some((line) => headerRe.test(line));
}

function tomlTableHeaderRegex(table: string): RegExp {
  // 接受 [a.b]、[a."b"]、[ a.b ] 三种写法
  const parts = table.split(".").map((p) => `(?:"${escapeRegex(p)}"|${escapeRegex(p)})`);
  return new RegExp(`^\\s*\\[\\s*${parts.join("\\s*\\.\\s*")}\\s*\\]\\s*(#.*)?$`);
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function shellQuote(value: string): string {
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
