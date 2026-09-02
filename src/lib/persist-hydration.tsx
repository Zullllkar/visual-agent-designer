"use client";

import { useEffect } from "react";
import { useChatStore } from "@/store/chat-store";
import { useProjectStore } from "@/store/project-store";
import { useProviderStore } from "@/store/provider-store";

/**
 * persist 不能在模块加载时自动回水合：localStorage / IDB 的 Promise
 * 会在首屏 render 未 commit 时 set()，React 19 会报
 * “state update on a component that hasn't mounted yet”。
 * 三个 persist store 都设了 skipHydration，这里在 mount 后再 rehydrate。
 */
export function PersistHydration() {
  useEffect(() => {
    void useProjectStore.persist?.rehydrate();
    void useProviderStore.persist?.rehydrate();
    void useChatStore.persist?.rehydrate();
  }, []);
  return null;
}
