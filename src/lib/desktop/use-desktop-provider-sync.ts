"use client";

/**
 * 把 provider 配置（含 API key）同步给桌面壳，由它加密进系统钥匙串并推给 Next。
 * 只在 zustand persist 水合完成后动作——否则启动瞬间的默认 mock 配置会被
 * 误当成"用户清空了 key"。
 */

import { useEffect } from "react";
import { useProviderStoreHydrated } from "@/lib/use-hydrated";
import type { ProviderConfig } from "@/lib/providers/registry";
import { useProviderStore } from "@/store/provider-store";

const DEBOUNCE_MS = 800;

export function hasUsableProvider(config: ProviderConfig | undefined): boolean {
  if (!config) return false;
  return Boolean(
    (config.llm && config.llm.kind !== "mock") || (config.image && config.image.kind !== "mock"),
  );
}

export function useDesktopProviderSync(desktop: boolean): void {
  const hydrated = useProviderStoreHydrated();
  const config = useProviderStore((s) => s.config);

  useEffect(() => {
    if (!desktop || !hydrated) return;
    const bridge = window.vadDesktop;
    if (!bridge?.saveProviderConfig) return;
    const timer = window.setTimeout(() => {
      if (hasUsableProvider(config)) {
        void bridge.saveProviderConfig(JSON.stringify(config)).catch(() => undefined);
      } else {
        void bridge.clearProviderConfig?.().catch(() => undefined);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [desktop, hydrated, config]);
}
