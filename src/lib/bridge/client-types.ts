/**
 * Bridge 管理端点的响应类型（客户端 / 服务端共用，纯类型）。
 */

export type BridgeAgentSlug = "claude" | "codex" | "cursor";

export interface BridgeStatusResponse {
  ok: true;
  serverName: string;
  serverVersion: string;
  url: string;
  port: number;
  authEnabled: boolean;
  token: string | null;
  startedAt: string;
  activeContext: {
    active: boolean;
    projectId?: string;
    lastInteractionAt?: number;
    ageMs?: number;
    hint?: string;
  };
  clients: Array<{
    name: string;
    version?: string;
    firstSeenAt: number;
    lastSeenAt: number;
    connections: number;
    slug: BridgeAgentSlug | null;
  }>;
  cursorDeeplink: string;
  commands: Record<BridgeAgentSlug, string>;
  autoApproveAssets: boolean;
  providerCache: {
    available: boolean;
    scope: "project" | "latest" | "none";
    seenAt?: number;
    imageKind?: string;
    llmKind?: string;
  };
  pendingRequests: number;
}

export interface BridgeAgentInfo {
  slug: BridgeAgentSlug;
  cli?: {
    bin: string;
    path: string | null;
    version: string | null;
    installed: boolean;
    appInstalled?: boolean;
    installUrl: string;
  };
  registration?: {
    registered: boolean;
    method: "cli" | "json" | "toml";
    configPath?: string;
    detail?: string;
  };
  lastConnectedAt?: number;
}

export interface BridgeAgentsResponse {
  ok: true;
  agents: BridgeAgentInfo[];
}

export interface BridgeInstallResponse {
  ok: boolean;
  slug: BridgeAgentSlug;
  action: "install" | "uninstall";
  method: "cli" | "json" | "toml";
  message: string;
  configPath?: string;
  command?: string;
  stdout?: string;
  stderr?: string;
}

export const BRIDGE_AGENT_LABELS: Record<BridgeAgentSlug, string> = {
  cursor: "Cursor",
  claude: "Claude Code",
  codex: "Codex",
};

export type BuildRunStatus = "running" | "completed" | "failed" | "cancelled";
export type BuildLogKind = "status" | "text" | "thinking" | "tool" | "error" | "stderr";

export interface BuildLogEvent {
  ts: number;
  kind: BuildLogKind;
  text: string;
  name?: string;
  seq?: number;
}

export interface BuildPreviewResponse {
  ok: true;
  slug: BridgeAgentSlug;
  bin: string;
  binPath: string;
  version: string | null;
  argv: string[];
  command: string;
  cwd: string;
  fingerprint: string;
  prompt: string;
  promptChars: number;
  envKeys: string[];
  warnings: string[];
  installUrl: string;
}

export interface BuildRunPublic {
  id: string;
  projectId: string;
  slug: BridgeAgentSlug;
  status: BuildRunStatus;
  cwd: string;
  bin: string;
  command: string;
  fingerprint: string;
  startedAt: number;
  endedAt?: number;
  exitCode?: number | null;
  error?: string;
  events: BuildLogEvent[];
  promptChars: number;
  eventCount: number;
}
