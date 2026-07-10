"use client";

/**
 * Handoff 后一键复制 Cursor MCP 配置
 * --------------------------------------------------------------
 * @author：wangjunhua
 */

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";

type McpConfigResponse = {
  nodePath: string;
  cliPath: string;
  cursorConfig: Record<string, unknown>;
};

export function McpQuickCopy({
  compact = false,
  onCopied,
}: {
  compact?: boolean;
  /** 复制成功回调 */
  onCopied?: (which: "cursor") => void;
}) {
  const [cfg, setCfg] = useState<McpConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"cursor" | null>(null);

  const refreshMcp = useCallback(async () => {
    const configData = await fetch("/api/mcp/config").then((r) => r.json());
    setCfg(configData as McpConfigResponse);
    setError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    refreshMcp()
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshMcp]);

  const copyText = useCallback(async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied("cursor");
    onCopied?.("cursor");
    setTimeout(() => setCopied(null), 2000);
  }, [onCopied]);

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-[11px] app-subtle">
        <Loader2 className="size-3 animate-spin" />
        加载 MCP 配置…
      </p>
    );
  }

  if (error || !cfg) {
    return (
      <p className="text-[11px] text-red-600 dark:text-red-400">
        MCP 配置加载失败：{error ?? "未知错误"}
      </p>
    );
  }

  const cursorText = [
    "Cursor → Settings → Features → MCP → Add New MCP Server",
    `Command: ${cfg.nodePath}`,
    `Args: ${cfg.cliPath} mcp`,
  ].join("\n");

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => void copyText(cursorText)}
        className="inline-flex items-center gap-1.5 rounded-lg border app-border px-2.5 py-1 text-[10px] font-medium hover:border-[var(--primary)]"
      >
        {copied === "cursor" ? <Check className="size-3" /> : <Copy className="size-3" />}
        Cursor MCP
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-xl border app-border bg-[var(--surface-muted)] p-4">
      <p className="text-sm font-semibold app-strong">接 MCP 写代码（Handoff 之后）</p>
      <p className="mt-1.5 text-[11px] leading-relaxed app-subtle">
        设计包下载后，在 Cursor 中接入 MCP，可读取画布与设计 token 并落地前端代码。
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void copyText(cursorText)}
          className="app-btn inline-flex items-center gap-1.5 rounded-lg border app-border bg-[var(--surface)] px-3 py-2 text-xs"
        >
          {copied === "cursor" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          复制 Cursor 接入说明
        </button>
      </div>
    </div>
  );
}
