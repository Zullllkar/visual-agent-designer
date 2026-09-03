import { describe, expect, it } from "vitest";
import {
  applyJsonInstall,
  cursorInstallDeeplink,
  cursorServerEntry,
  jsonHasInstall,
  planAgentInstall,
  removeJsonInstall,
  removeTomlTable,
  tomlHasTable,
  upsertTomlTable,
  type BridgeEndpoint,
  type JsonInstallPlan,
} from "./install-planner";

const endpoint: BridgeEndpoint = {
  url: "http://127.0.0.1:3000/mcp",
  token: "vb_secret",
  serverName: "vibeboard",
};

const ctx = { home: "/home/u", platform: "linux" as NodeJS.Platform, hasCli: true };

describe("planAgentInstall", () => {
  it("claude uses its own CLI with http transport and auth header", () => {
    const plan = planAgentInstall("claude", endpoint, ctx);
    expect(plan.kind).toBe("cli");
    if (plan.kind !== "cli") return;
    expect(plan.bin).toBe("claude");
    expect(plan.addArgv).toEqual([
      "mcp", "add", "--transport", "http", "--scope", "user", "vibeboard", endpoint.url,
      "--header", "Authorization: Bearer vb_secret",
    ]);
    expect(plan.getArgv).toEqual(["mcp", "get", "vibeboard"]);
  });

  it("codex uses CLI plus a TOML patch when the CLI exists", () => {
    const plan = planAgentInstall("codex", endpoint, ctx);
    expect(plan.kind).toBe("cli");
    if (plan.kind !== "cli") return;
    expect(plan.addArgv).toEqual(["mcp", "add", "vibeboard", "--url", endpoint.url]);
    expect(plan.tomlPatch?.table).toBe("mcp_servers.vibeboard");
    expect(plan.tomlPatch?.entries.required).toBe("true");
    expect(plan.tomlPatch?.entries.http_headers).toContain("Bearer vb_secret");
  });

  it("codex falls back to a direct TOML write without the CLI", () => {
    const plan = planAgentInstall("codex", endpoint, { ...ctx, hasCli: false });
    expect(plan.kind).toBe("toml");
    if (plan.kind !== "toml") return;
    expect(plan.configPath.replace(/\\/g, "/")).toBe("/home/u/.codex/config.toml");
    expect(plan.entries.url).toBe(JSON.stringify(endpoint.url));
  });

  it("cursor deep-merges an http entry with headers into ~/.cursor/mcp.json", () => {
    const plan = planAgentInstall("cursor", endpoint, ctx);
    expect(plan.kind).toBe("json");
    if (plan.kind !== "json") return;
    expect(plan.keyPath).toEqual(["mcpServers"]);
    expect(plan.entry).toEqual({
      type: "http",
      url: endpoint.url,
      headers: { Authorization: "Bearer vb_secret" },
    });
  });

  it("omits auth headers when the bridge runs without a token", () => {
    const open = { ...endpoint, token: null };
    expect(cursorServerEntry(open)).toEqual({ type: "http", url: endpoint.url });
    const claude = planAgentInstall("claude", open, ctx);
    if (claude.kind === "cli") expect(claude.addArgv).not.toContain("--header");
  });
});

describe("cursorInstallDeeplink", () => {
  it("base64-encodes the server entry", () => {
    const link = cursorInstallDeeplink(endpoint);
    const url = new URL(link);
    expect(url.protocol).toBe("cursor:");
    expect(url.searchParams.get("name")).toBe("vibeboard");
    const decoded = JSON.parse(Buffer.from(url.searchParams.get("config")!, "base64").toString("utf8"));
    expect(decoded.url).toBe(endpoint.url);
    expect(decoded.headers.Authorization).toBe("Bearer vb_secret");
  });
});

describe("json merge", () => {
  const plan: JsonInstallPlan = {
    kind: "json",
    slug: "cursor",
    configPath: "/x/mcp.json",
    keyPath: ["mcpServers"],
    serverKey: "vibeboard",
    entry: { type: "http", url: "http://127.0.0.1:3000/mcp" },
  };

  it("creates the file structure from nothing", () => {
    const out = JSON.parse(applyJsonInstall(null, plan));
    expect(out.mcpServers.vibeboard.url).toBe("http://127.0.0.1:3000/mcp");
  });

  it("preserves sibling servers and unrelated keys", () => {
    const existing = JSON.stringify({ mcpServers: { other: { command: "x" } }, theme: "dark" });
    const out = JSON.parse(applyJsonInstall(existing, plan));
    expect(out.mcpServers.other).toEqual({ command: "x" });
    expect(out.theme).toBe("dark");
    expect(jsonHasInstall(JSON.stringify(out), plan)).toBe(true);
  });

  it("removes only our entry", () => {
    const existing = JSON.stringify({ mcpServers: { other: { command: "x" }, vibeboard: { url: "u" } } });
    const out = JSON.parse(removeJsonInstall(existing, plan)!);
    expect(out.mcpServers).toEqual({ other: { command: "x" } });
    expect(removeJsonInstall(JSON.stringify(out), plan)).toBeNull();
  });

  it("refuses to clobber invalid JSON", () => {
    expect(() => applyJsonInstall("{ not json", plan)).toThrow(/not valid JSON/);
  });
});

describe("toml upsert", () => {
  const entries = { url: '"http://127.0.0.1:3000/mcp"', required: "true" };

  it("appends a new table to an existing file", () => {
    const existing = 'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "x"\n';
    const out = upsertTomlTable(existing, "mcp_servers.vibeboard", entries);
    expect(out).toContain('model = "gpt-5"');
    expect(out).toContain("[mcp_servers.other]");
    expect(out.trimEnd().endsWith("[mcp_servers.vibeboard]\nurl = \"http://127.0.0.1:3000/mcp\"\nrequired = true")).toBe(true);
  });

  it("updates managed keys in place and keeps unmanaged keys", () => {
    const existing = [
      "[mcp_servers.vibeboard]",
      'url = "http://old"',
      "tool_timeout_sec = 90",
      "",
      "[other]",
      "a = 1",
      "",
    ].join("\n");
    const out = upsertTomlTable(existing, "mcp_servers.vibeboard", entries);
    expect(out).toContain('url = "http://127.0.0.1:3000/mcp"');
    expect(out).not.toContain('url = "http://old"');
    expect(out).toContain("tool_timeout_sec = 90");
    expect(out).toContain("required = true");
    expect(out).toContain("[other]\na = 1");
    expect(tomlHasTable(out, "mcp_servers.vibeboard")).toBe(true);
  });

  it('matches quoted table names like [mcp_servers."vibeboard"]', () => {
    const existing = '[mcp_servers."vibeboard"]\nurl = "x"\n';
    expect(tomlHasTable(existing, "mcp_servers.vibeboard")).toBe(true);
    const out = upsertTomlTable(existing, "mcp_servers.vibeboard", entries);
    expect(out.split("[mcp_servers").length - 1).toBe(1);
  });

  it("removes the whole table and nothing else", () => {
    const existing = '[a]\nx = 1\n\n[mcp_servers.vibeboard]\nurl = "u"\n\n[b]\ny = 2\n';
    const out = removeTomlTable(existing, "mcp_servers.vibeboard");
    expect(out).toBe("[a]\nx = 1\n\n[b]\ny = 2\n");
    expect(removeTomlTable(out, "mcp_servers.vibeboard")).toBeNull();
  });
});
