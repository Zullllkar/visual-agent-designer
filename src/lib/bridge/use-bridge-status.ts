"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BridgeAgentSlug,
  BridgeAgentsResponse,
  BridgeInstallResponse,
  BridgeStatusResponse,
} from "./client-types";

interface BridgeState {
  status: BridgeStatusResponse | null;
  agents: BridgeAgentsResponse["agents"] | null;
  loading: boolean;
  agentsLoading: boolean;
  error: string | null;
}

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, { ...init, cache: "no-store" });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // 非 JSON 响应按错误处理
  }
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "message" in body
        ? String((body as { message: unknown }).message)
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body as T;
}

/**
 * 读取 Bridge 状态与各 coding agent 的接入情况，并提供安装 / 卸载动作。
 * `/mcp/agents` 会 spawn CLI 探测版本，较慢，默认只在首次和显式刷新时请求。
 */
export function useBridgeStatus(options: { pollMs?: number } = {}) {
  const pollMs = options.pollMs ?? 15_000;
  const [state, setState] = useState<BridgeState>({
    status: null,
    agents: null,
    loading: true,
    agentsLoading: true,
    error: null,
  });
  const mounted = useRef(true);

  const refreshStatus = useCallback(async () => {
    try {
      const status = await fetchJson<BridgeStatusResponse>("/mcp/status");
      if (mounted.current) setState((s) => ({ ...s, status, loading: false, error: null }));
    } catch (err) {
      if (mounted.current) {
        setState((s) => ({ ...s, loading: false, error: (err as Error).message }));
      }
    }
  }, []);

  const refreshAgents = useCallback(async () => {
    if (mounted.current) setState((s) => ({ ...s, agentsLoading: true }));
    try {
      const data = await fetchJson<BridgeAgentsResponse>("/mcp/agents");
      if (mounted.current) setState((s) => ({ ...s, agents: data.agents, agentsLoading: false }));
    } catch (err) {
      if (mounted.current) {
        setState((s) => ({ ...s, agentsLoading: false, error: (err as Error).message }));
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refreshStatus();
    void refreshAgents();
    const timer = setInterval(() => void refreshStatus(), pollMs);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [pollMs, refreshAgents, refreshStatus]);

  const install = useCallback(
    async (agent: BridgeAgentSlug, action: "install" | "uninstall" = "install") => {
      const result = await fetchJson<BridgeInstallResponse>("/mcp/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent, action }),
      }).catch((err) => ({
        ok: false,
        slug: agent,
        action,
        method: "cli" as const,
        message: (err as Error).message,
      }));
      void refreshAgents();
      return result;
    },
    [refreshAgents]
  );

  return { ...state, refreshStatus, refreshAgents, install };
}

/** 打开 cursor:// 深链：桌面壳走 IPC，浏览器直接交给系统协议处理。 */
export function openDeeplink(url: string): void {
  if (window.vadDesktop?.openExternal) {
    window.vadDesktop.openExternal(url);
    return;
  }
  window.location.assign(url);
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
