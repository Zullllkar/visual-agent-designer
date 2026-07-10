"use client";

import { useSyncExternalStore } from "react";
import { useProjectStore } from "@/store/project-store";
import { useProviderStore } from "@/store/provider-store";

/**
 * 在 client 端 mount 之后才返回 true。
 * 用于避免 zustand persist 在 SSR 时与 client 初始状态不一致导致的 hydration mismatch。
 *
 * 注意：本 hook 只能解决「同步 storage（如 localStorage）」的水合时机；
 * 异步 storage（如 IndexedDB）请改用 useProjectStoreHydrated 等
 * 具体 store 的 hook，等待真正完成 rehydration。
 */
export function useHydrated() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

/**
 * 等待 useProjectStore 的 zustand persist 真正完成 rehydration。
 *
 * 因为 project-store 改用了 IndexedDB（异步）作为 storage，
 * `useEffect(() => setHydrated(true))` 会在 IDB 数据回来之前就 true，
 * 此时直接读 store.projects[id] 仍是空 dict，会出现"项目不存在"闪烁。
 *
 * 对于读 projects 字典的页面（ProjectList / ProjectWorkspace / IdeShell），
 * 应改用本 hook 替代 useHydrated。
 *
 * SSR 安全：服务端 useProjectStore.persist 仍存在，hasHydrated() 返回
 * false；effect 只跑在 client，订阅 onFinishHydration 即可。
 */
export function useProjectStoreHydrated() {
  return useSyncExternalStore(
    (onStoreChange) => useProjectStore.persist.onFinishHydration(onStoreChange),
    () => useProjectStore.persist.hasHydrated(),
    () => false
  );
}

/**
 * 等待 useProviderStore 从 localStorage 完成 rehydration。
 * 未完成前 config 仍是默认 Mock，会导致首页误显示「未配置」。
 */
export function useProviderStoreHydrated() {
  return useSyncExternalStore(
    (onStoreChange) => useProviderStore.persist.onFinishHydration(onStoreChange),
    () => useProviderStore.persist.hasHydrated(),
    () => false
  );
}
