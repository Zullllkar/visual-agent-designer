"use client";

/**
 * Handoff 后的 coding agent 接入快捷入口
 * --------------------------------------------------------------
 * 读取 Bridge（/mcp/status），提供：在 Cursor 中一键安装、复制 Claude / Codex
 * 命令、跳到设置里的"连接"分区。完整状态与移除操作在设置面板。
 */

import { Check, Copy, ExternalLink, Loader2, Plug } from "lucide-react";
import { useCallback, useState } from "react";
import type { BridgeAgentSlug } from "@/lib/bridge/client-types";
import { copyToClipboard, openDeeplink, useBridgeStatus } from "@/lib/bridge/use-bridge-status";
import { openSettings } from "@/lib/settings/events";

export function McpQuickCopy({
  compact = false,
  onCopied,
}: {
  compact?: boolean;
  /** 复制 / 打开成功回调 */
  onCopied?: (which: BridgeAgentSlug) => void;
}) {
  const { status, loading, error } = useBridgeStatus({ pollMs: 60_000 });
  const [copied, setCopied] = useState<BridgeAgentSlug | null>(null);

  const copyCommand = useCallback(
    async (slug: BridgeAgentSlug) => {
      if (!status) return;
      const ok = await copyToClipboard(status.commands[slug]);
      if (!ok) return;
      setCopied(slug);
      onCopied?.(slug);
      setTimeout(() => setCopied((c) => (c === slug ? null : c)), 2000);
    },
    [onCopied, status]
  );

  if (loading && !status) {
    return (
      <p className="flex items-center gap-2 text-[11px] app-subtle">
        <Loader2 className="size-3 animate-spin" />
        读取 MCP 接入状态…
      </p>
    );
  }

  if (error || !status) {
    return (
      <p className="text-[11px] text-red-600 dark:text-red-400">
        MCP Bridge 不可用：{error ?? "未知错误"}
      </p>
    );
  }

  const connected = status.clients.filter((c) => c.slug);

  if (compact) {
    return (
      <div className="inline-flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            openDeeplink(status.cursorDeeplink);
            onCopied?.("cursor");
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border app-border px-2.5 py-1 text-[10px] font-medium hover:border-[var(--primary)]"
        >
          <ExternalLink className="size-3" />
          Cursor MCP
        </button>
        <button
          type="button"
          onClick={() => openSettings("bridge")}
          className="inline-flex items-center gap-1.5 rounded-lg border app-border px-2.5 py-1 text-[10px] font-medium hover:border-[var(--primary)]"
        >
          <Plug className="size-3" />
          其他
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl border app-border bg-[var(--surface-muted)] p-4">
      <p className="text-sm font-semibold app-strong">让 coding agent 直接读这份设计</p>
      <p className="mt-1.5 text-[11px] leading-relaxed app-subtle">
        不用下载解压。接入一次后，Cursor / Claude Code / Codex 通过本机 MCP 端点实时读取当前项目的
        定稿图、Layout IR、token 与规格。
        {connected.length > 0
          ? ` 最近连接过：${connected.map((c) => c.name).join("、")}。`
          : ""}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            openDeeplink(status.cursorDeeplink);
            onCopied?.("cursor");
          }}
          className="app-btn inline-flex items-center gap-1.5 rounded-lg border app-border bg-[var(--surface)] px-3 py-2 text-xs"
        >
          <ExternalLink className="size-3.5" />
          在 Cursor 中安装
        </button>
        <button
          type="button"
          onClick={() => void copyCommand("claude")}
          className="app-btn inline-flex items-center gap-1.5 rounded-lg border app-border bg-[var(--surface)] px-3 py-2 text-xs"
        >
          {copied === "claude" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          复制 Claude Code 命令
        </button>
        <button
          type="button"
          onClick={() => void copyCommand("codex")}
          className="app-btn inline-flex items-center gap-1.5 rounded-lg border app-border bg-[var(--surface)] px-3 py-2 text-xs"
        >
          {copied === "codex" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          复制 Codex 命令
        </button>
        <button
          type="button"
          onClick={() => openSettings("bridge")}
          className="app-btn inline-flex items-center gap-1.5 rounded-lg border app-border px-3 py-2 text-xs"
        >
          <Plug className="size-3.5" />
          一键注册与状态
        </button>
      </div>
      <p className="mt-2 text-[10px] app-subtle break-all">端点：{status.url}</p>
    </div>
  );
}
