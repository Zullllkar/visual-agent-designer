/**
 * Provider 配置缓存（仅内存）
 * --------------------------------------------------------------
 * API Key 只存在浏览器 localStorage，每次 WS 命令 / API 调用随请求带上。
 * Bridge 侧没有浏览器会话，但 request_asset 这类工具需要生图凭证，
 * 所以把最近一次见到的配置按项目缓存在内存里（进程退出即消失，不落盘）。
 *
 * 用户从没打开过应用时缓存为空，工具会明确要求先打开 Vibeboard。
 */

import type { ProviderConfig } from "@/lib/providers/registry";

interface CacheEntry {
  config: ProviderConfig;
  seenAt: number;
}

const byProject = new Map<string, CacheEntry>();
let latest: CacheEntry | undefined;

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
  at: number = Date.now()
): void {
  if (!hasUsableProvider(config) || !config) return;
  const entry = { config, seenAt: at };
  latest = entry;
  if (projectId) byProject.set(projectId, entry);
}

/** 取项目配置，没有则回退到最近一次任意项目的配置。 */
export function getCachedProviderConfig(projectId?: string): ProviderConfig | undefined {
  if (projectId) {
    const hit = byProject.get(projectId);
    if (hit) return hit.config;
  }
  return latest?.config;
}

export function providerCacheStatus(projectId?: string): {
  available: boolean;
  scope: "project" | "latest" | "none";
  seenAt?: number;
  imageKind?: string;
  llmKind?: string;
} {
  const entry = (projectId ? byProject.get(projectId) : undefined) ?? latest;
  if (!entry) return { available: false, scope: "none" };
  return {
    available: true,
    scope: projectId && byProject.has(projectId) ? "project" : "latest",
    seenAt: entry.seenAt,
    imageKind: entry.config.image?.kind,
    llmKind: entry.config.llm?.kind,
  };
}

export function clearProviderCache(): void {
  byProject.clear();
  latest = undefined;
}
