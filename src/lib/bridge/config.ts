/**
 * Bridge 配置
 * --------------------------------------------------------------
 * token 与发现文件（bridge.json）。两者都落在 .vad/bridge/ 下：
 *   - token        : coding agent 访问 /mcp 时携带的 Bearer 凭证
 *   - bridge.json  : 当前服务的 url / port / token / pid，供 stdio 转发器与安装器读取
 */

import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { VAD_ROOT } from "@/lib/vad/paths";

export const BRIDGE_SERVER_NAME = "vibeboard";
export const BRIDGE_MCP_PATH = "/mcp";

export interface BridgeDiscovery {
  version: 1;
  url: string;
  port: number;
  hostname: string;
  token: string | null;
  pid: number;
  startedAt: string;
  vadRoot: string;
}

export function bridgeDir(): string {
  return join(VAD_ROOT, "bridge");
}

export function bridgeTokenPath(): string {
  return join(bridgeDir(), "token");
}

export function bridgeDiscoveryPath(): string {
  return join(bridgeDir(), "bridge.json");
}

/** 是否要求 Bearer token。VAD_BRIDGE_AUTH=off 仅供本机调试。 */
export function bridgeAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VAD_BRIDGE_AUTH?.trim().toLowerCase() !== "off";
}

/**
 * 读取或生成 token。VAD_BRIDGE_TOKEN 环境变量优先，便于 CI / 多实例。
 */
export async function loadOrCreateBridgeToken(
  env: NodeJS.ProcessEnv = process.env
): Promise<string> {
  const fromEnv = env.VAD_BRIDGE_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  const path = bridgeTokenPath();
  try {
    const existing = (await fs.readFile(path, "utf8")).trim();
    if (existing.length >= 32) return existing;
  } catch {
    // 首次启动：下面生成
  }
  const token = `vb_${randomBytes(24).toString("base64url")}`;
  await fs.mkdir(bridgeDir(), { recursive: true });
  await fs.writeFile(path, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  return token;
}

export async function writeBridgeDiscovery(info: BridgeDiscovery): Promise<void> {
  await fs.mkdir(bridgeDir(), { recursive: true });
  const tmp = `${bridgeDiscoveryPath()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(info, null, 2), "utf8");
  await fs.rename(tmp, bridgeDiscoveryPath());
}

export async function readBridgeDiscovery(): Promise<BridgeDiscovery | null> {
  try {
    const raw = await fs.readFile(bridgeDiscoveryPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<BridgeDiscovery>;
    if (parsed.version !== 1 || typeof parsed.url !== "string") return null;
    return parsed as BridgeDiscovery;
  } catch {
    return null;
  }
}

export function buildBridgeUrl(hostname: string, port: number): string {
  // 对外始终给回环地址：0.0.0.0 / :: 不能用作客户端连接目标
  const host =
    hostname === "0.0.0.0" || hostname === "::" || hostname === "localhost"
      ? "127.0.0.1"
      : hostname;
  return `http://${host}:${port}${BRIDGE_MCP_PATH}`;
}
