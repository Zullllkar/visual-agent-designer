/**
 * Provider 配置缓存（仅内存）
 * --------------------------------------------------------------
 * API Key 只存在浏览器 localStorage，每次 WS 命令 / API 调用随请求带上。
 * Bridge 侧没有浏览器会话，但 request_asset 这类工具需要生图凭证，
 * 所以把最近一次见到的配置按项目缓存在内存里（进程退出即消失，不落盘）。
 *
 * 桌面版还会把系统钥匙串里加密保存的配置在启动时推过来（persisted），
 * 作为最后的回退——这样界面没打开时 coding agent 也能要图。
 * 纯浏览器模式下没有 persisted，工具会明确要求先打开 Vibeboard。
 */

import type { ProviderConfig } from "@/lib/providers/registry";

interface CacheEntry {
  config: ProviderConfig;
  seenAt: number;
}

const byProject = new Map<string, CacheEntry>();
let latest: CacheEntry | undefined;
let persisted: CacheEntry | undefined;

/** 桌面壳从钥匙串解密后推来的配置。 */
export function rememberPersistedProviderConfig(
  config: ProviderConfig | undefined,
  at: number = Date.now(),
): boolean {
  if (!hasUsableProvider(config) || !config) return false;
  persisted = { config, seenAt: at };
  return true;
}

export function clearPersistedProviderConfig(): void {
  persisted = undefined;
}

function hasUsableProvider(config: ProviderConfig | undefined): boolean {
  if (!config) return false;
  const llmOk = Boolean(config.llm && config.llm.kind !== "mock");
  const imageOk = Boolean(config.image && config.image.kind !== "mock");
  return llmOk || imageOk;
}

/** WS 命令 / API 路由收到 providerConfig 时调用。 */
export function rememberProviderConfig(
  projectId: string | null | undefined,
  config: ProviderConfig | undefined,
  at: number = Date.now(),
): void {
  if (!hasUsableProvider(config) || !config) return;
  const entry = { config, seenAt: at };
  latest = entry;
  if (projectId) byProject.set(projectId, entry);
}

/** 取项目配置 → 最近一次任意项目 → 桌面钥匙串持久化的配置。 */
export function getCachedProviderConfig(projectId?: string): ProviderConfig | undefined {
  if (projectId) {
    const hit = byProject.get(projectId);
    if (hit) return hit.config;
  }
  return latest?.config ?? persisted?.config;
}

export function providerCacheStatus(projectId?: string): {
  available: boolean;
  scope: "project" | "latest" | "desktop" | "none";
  seenAt?: number;
  imageKind?: string;
  llmKind?: string;
  desktopPersisted: boolean;
} {
  const projectHit = projectId ? byProject.get(projectId) : undefined;
  const entry = projectHit ?? latest ?? persisted;
  if (!entry) return { available: false, scope: "none", desktopPersisted: Boolean(persisted) };
  return {
    available: true,
    scope: projectHit ? "project" : latest ? "latest" : "desktop",
    seenAt: entry.seenAt,
    imageKind: entry.config.image?.kind,
    llmKind: entry.config.llm?.kind,
    desktopPersisted: Boolean(persisted),
  };
}

export function clearProviderCache(): void {
  byProject.clear();
  latest = undefined;
  persisted = undefined;
}
