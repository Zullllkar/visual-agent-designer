"use client";

/**
 * Daemon 连接状态提示
 * --------------------------------------------------------------
 * 展示当前落盘模式：内联 Next / Daemon 已连接 / Daemon 回退。
 *
 * @author：wangjunhua
 */

import { useEffect, useState } from "react";
import { HardDrive } from "lucide-react";

interface DaemonStatus {
  enabled: boolean;
  connected: boolean;
  mode: string;
  url?: string;
  message?: string;
}

export function DaemonStatusHint() {
  const [status, setStatus] = useState<DaemonStatus | null>(null);

  useEffect(() => {
    fetch("/api/daemon/status")
      .then((r) => r.json())
      .then((d) => setStatus(d as DaemonStatus))
      .catch(() => setStatus(null));
  }, []);

  if (!status) return null;

  const connected = status.enabled && status.connected;
  const fallback = status.enabled && !status.connected;

  return (
    <div
      className={
        "flex gap-2 rounded-xl border px-3 py-2.5 text-xs " +
        (connected
          ? "app-accent-border app-accent-soft app-strong"
          : fallback
            ? "border-amber-200 bg-amber-50 text-amber-900"
            : "app-border bg-[var(--surface-muted)] app-subtle")
      }
    >
      <HardDrive className="size-4 shrink-0 opacity-70" />
      <div>
        <p className="font-semibold">
          {connected
            ? "VAD Daemon 已连接"
            : status.enabled
              ? "VAD Daemon 未连接（已回退内联写盘）"
              : "内联落盘模式"}
        </p>
        <p className="mt-0.5 leading-relaxed opacity-90">
          {status.message}
          {!status.enabled ? (
            <>
              {" "}
              启用：另开终端运行 <code className="rounded bg-[var(--surface)] px-1">pnpm daemon</code>
              ，并在 <code className="rounded bg-[var(--surface)] px-1">.env.local</code> 设置{" "}
              <code className="rounded bg-[var(--surface)] px-1">VAD_DAEMON_URL=http://127.0.0.1:3921</code>
            </>
          ) : status.url ? (
            <> · {status.url}</>
          ) : null}
        </p>
      </div>
    </div>
  );
}
