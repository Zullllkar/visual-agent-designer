/**
 * 已连接的 MCP 客户端
 * --------------------------------------------------------------
 * 每次 initialize 握手记录 clientInfo，设置面板据此显示
 * "Cursor 已连接 / Codex 最近 3 分钟前连接过"。
 */

export interface BridgeClientRecord {
  name: string;
  version?: string;
  firstSeenAt: number;
  lastSeenAt: number;
  connections: number;
}

class BridgeClientRegistry {
  private clients = new Map<string, BridgeClientRecord>();

  record(info: { name?: string; version?: string } | undefined, at: number = Date.now()): void {
    const name = info?.name?.trim() || "unknown";
    const existing = this.clients.get(name);
    if (existing) {
      existing.lastSeenAt = at;
      existing.version = info?.version ?? existing.version;
      existing.connections += 1;
      return;
    }
    this.clients.set(name, {
      name,
      version: info?.version,
      firstSeenAt: at,
      lastSeenAt: at,
      connections: 1,
    });
  }

  list(): BridgeClientRecord[] {
    return [...this.clients.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }
}

export const bridgeClients = new BridgeClientRegistry();

/** 把 clientInfo.name 归一成设置面板里的三类目标（其余返回 null）。 */
export function classifyClientName(name: string): "cursor" | "codex" | "claude" | null {
  const n = name.toLowerCase();
  if (n.includes("cursor")) return "cursor";
  if (n.includes("codex")) return "codex";
  if (n.includes("claude")) return "claude";
  return null;
}
