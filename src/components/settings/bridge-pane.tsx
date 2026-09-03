"use client";

/**
 * 设置 → 连接 coding agent
 * --------------------------------------------------------------
 * 展示 Bridge（/mcp）端点、活跃项目、三端接入状态，并提供
 * 一键安装 / 复制命令 / 移除。stdio 转发器作为兜底方案单独列出。
 */

import { Check, Copy, ExternalLink, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  BRIDGE_AGENT_LABELS,
  type BridgeAgentInfo,
  type BridgeAgentSlug,
  type BridgeInstallResponse,
} from "@/lib/bridge/client-types";
import { copyToClipboard, openDeeplink, useBridgeStatus } from "@/lib/bridge/use-bridge-status";
import { useDesktopRuntime } from "@/lib/desktop/use-desktop-runtime";
import type { VadDesktopInfo } from "@/types/vad-desktop";

const AGENT_ORDER: BridgeAgentSlug[] = ["cursor", "claude", "codex"];

const AGENT_HINT: Record<BridgeAgentSlug, string> = {
  cursor: "深链会打开 Cursor 的安装卡（需 3.15.12+）；也可直接写入 ~/.cursor/mcp.json。",
  claude: "调用 claude mcp add 注册到用户作用域，所有项目可用。",
  codex: "调用 codex mcp add 并补齐 ~/.codex/config.toml 的鉴权头与启动超时。",
};

export function BridgePane() {
  const { status, agents, loading, agentsLoading, error, refreshAgents, refreshStatus, install } =
    useBridgeStatus();
  const desktop = useDesktopRuntime();
  const [info, setInfo] = useState<VadDesktopInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<BridgeInstallResponse | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    void window.vadDesktop?.getInfo().then((value) => {
      if (!cancelled) setInfo(value);
    });
    return () => {
      cancelled = true;
    };
  }, [desktop]);

  const flashCopied = (key: string) => {
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800);
  };

  const run = async (agent: BridgeAgentSlug, action: "install" | "uninstall") => {
    setBusy(`${agent}:${action}`);
    setLastResult(null);
    const result = await install(agent, action);
    setLastResult(result);
    setBusy(null);
  };

  if (loading && !status) {
    return (
      <p className="flex items-center gap-2 text-xs app-subtle">
        <Loader2 className="size-3.5 animate-spin" />
        正在读取 Bridge 状态…
      </p>
    );
  }

  if (!status) {
    return (
      <div className="vad-settings-row">
        <div className="vad-settings-copy">
          <strong>Bridge 未就绪</strong>
          <p>{error ?? "无法访问 /mcp/status。请确认应用通过 pnpm dev 或桌面端启动。"}</p>
        </div>
        <button type="button" className="vad-settings-btn" onClick={() => void refreshStatus()}>
          重试
        </button>
      </div>
    );
  }

  const active = status.activeContext;

  return (
    <>
      <div className="vad-settings-row">
        <div className="vad-settings-copy">
          <strong>MCP 端点</strong>
          <p>
            Cursor / Claude Code / Codex 通过这个地址实时读取当前项目的设计稿、Layout IR 与 token。
            {status.authEnabled ? " 已启用 Bearer token 校验，只接受本机请求。" : " 当前未启用 token（VAD_BRIDGE_AUTH=off）。"}
          </p>
        </div>
        <button
          type="button"
          className="vad-settings-btn"
          onClick={() => void copyToClipboard(status.url).then(() => flashCopied("url"))}
        >
          {copied === "url" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          复制地址
        </button>
      </div>
      <p className="vad-settings-path">{status.url}</p>

      <div className="vad-settings-row">
        <div className="vad-settings-copy">
          <strong>当前项目</strong>
          <p>
            {active.active
              ? `coding agent 省略 project 参数时默认读取：${active.projectId}`
              : active.hint ?? "没有打开中的项目。打开一个项目画布后，agent 侧才能自动定位。"}
          </p>
        </div>
        <span className="app-subtle text-xs">{active.active ? "活跃" : "空闲"}</span>
      </div>

      <div className="vad-settings-group flex items-center justify-between">
        <span>接入 coding agent</span>
        <button
          type="button"
          className="vad-settings-btn"
          onClick={() => void refreshAgents()}
          disabled={agentsLoading}
        >
          {agentsLoading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          重新检测
        </button>
      </div>

      {AGENT_ORDER.map((slug) => {
        const agent = agents?.find((a) => a.slug === slug);
        const client = status.clients.find((c) => c.slug === slug);
        return (
          <AgentRow
            key={slug}
            slug={slug}
            agent={agent}
            loading={agentsLoading && !agent}
            lastConnectedAt={client?.lastSeenAt ?? agent?.lastConnectedAt}
            busy={busy}
            copied={copied}
            onInstall={() => void run(slug, "install")}
            onUninstall={() => void run(slug, "uninstall")}
            onDeeplink={slug === "cursor" ? () => openDeeplink(status.cursorDeeplink) : undefined}
            onCopyCommand={() =>
              void copyToClipboard(status.commands[slug]).then(() => flashCopied(`cmd:${slug}`))
            }
          />
        );
      })}

      {lastResult ? (
        <div
          className={
            "mt-3 rounded-lg border px-3 py-2 text-xs " +
            (lastResult.ok
              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
              : "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300")
          }
        >
          <p className="font-medium">
            {BRIDGE_AGENT_LABELS[lastResult.slug]} · {lastResult.action === "install" ? "安装" : "移除"}
            {lastResult.ok ? "成功" : "失败"}
          </p>
          <p className="mt-0.5 break-all opacity-90">{lastResult.message}</p>
          {lastResult.command ? (
            <code className="mt-1 block whitespace-pre-wrap break-all opacity-80">{lastResult.command}</code>
          ) : null}
          {lastResult.stderr ? (
            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all opacity-70">{lastResult.stderr}</pre>
          ) : null}
        </div>
      ) : null}

      <div className="vad-settings-group">兜底：stdio 转发器</div>
      <div className="vad-settings-row">
        <div className="vad-settings-copy">
          <strong>只支持 stdio 的宿主</strong>
          <p>
            用 <code>node cli.js mcp</code> 作为 stdio MCP 服务，它会把请求转发到上面的 HTTP 端点。
            {info?.vadRoot ? "桌面端需要传 --root 指到数据目录。" : "浏览器调试模式下在仓库根目录运行即可。"}
          </p>
        </div>
        <button
          type="button"
          className="vad-settings-btn"
          onClick={() =>
            void copyToClipboard(stdioSnippet(info?.vadRoot)).then(() => flashCopied("stdio"))
          }
        >
          {copied === "stdio" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          复制配置
        </button>
      </div>
      <pre className="vad-settings-path whitespace-pre-wrap">{stdioSnippet(info?.vadRoot)}</pre>
    </>
  );
}

function AgentRow({
  slug,
  agent,
  loading,
  lastConnectedAt,
  busy,
  copied,
  onInstall,
  onUninstall,
  onDeeplink,
  onCopyCommand,
}: {
  slug: BridgeAgentSlug;
  agent?: BridgeAgentInfo;
  loading: boolean;
  lastConnectedAt?: number;
  busy: string | null;
  copied: string | null;
  onInstall: () => void;
  onUninstall: () => void;
  onDeeplink?: () => void;
  onCopyCommand: () => void;
}) {
  const label = BRIDGE_AGENT_LABELS[slug];
  const installed = agent?.cli?.installed ?? false;
  const appInstalled = agent?.cli?.appInstalled ?? false;
  const registered = agent?.registration?.registered ?? false;
  const installing = busy === `${slug}:install`;
  const removing = busy === `${slug}:uninstall`;

  const badges: Array<{ text: string; tone: "ok" | "muted" | "warn" }> = [];
  if (loading) badges.push({ text: "检测中…", tone: "muted" });
  else if (slug === "cursor") {
    badges.push(
      appInstalled || installed
        ? { text: installed ? `CLI ${agent?.cli?.version ?? ""}`.trim() : "IDE 已安装", tone: "ok" }
        : { text: "未检测到 Cursor", tone: "warn" }
    );
  } else {
    badges.push(
      installed
        ? { text: `CLI ${agent?.cli?.version ?? ""}`.trim(), tone: "ok" }
        : { text: "CLI 未安装", tone: "warn" }
    );
  }
  if (!loading) badges.push(registered ? { text: "已注册", tone: "ok" } : { text: "未注册", tone: "muted" });
  if (lastConnectedAt) badges.push({ text: `最近连接 ${relativeTime(lastConnectedAt)}`, tone: "ok" });

  return (
    <div className="vad-settings-row">
      <div className="vad-settings-copy">
        <strong className="flex flex-wrap items-center gap-1.5">
          {label}
          {badges.map((b) => (
            <span
              key={b.text}
              className={
                "rounded-full border px-1.5 py-px text-[10px] font-normal " +
                (b.tone === "ok"
                  ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
                  : b.tone === "warn"
                    ? "border-amber-500/30 text-amber-700 dark:text-amber-300"
                    : "app-border app-subtle")
              }
            >
              {b.text}
            </span>
          ))}
        </strong>
        <p>
          {AGENT_HINT[slug]}
          {agent?.registration?.configPath ? ` 配置：${agent.registration.configPath}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {onDeeplink ? (
          <button type="button" className="vad-settings-btn" onClick={onDeeplink}>
            <ExternalLink className="size-3.5" />
            在 Cursor 中安装
          </button>
        ) : null}
        <button
          type="button"
          className="vad-settings-btn"
          onClick={onInstall}
          disabled={Boolean(busy)}
          title={slug === "cursor" ? "直接写入 ~/.cursor/mcp.json" : undefined}
        >
          {installing ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {slug === "cursor" ? "写入配置" : registered ? "重新注册" : "一键注册"}
        </button>
        <button type="button" className="vad-settings-btn" onClick={onCopyCommand}>
          {copied === `cmd:${slug}` ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          复制
        </button>
        {registered ? (
          <button
            type="button"
            className="vad-settings-btn"
            onClick={onUninstall}
            disabled={Boolean(busy)}
            aria-label={`移除 ${label} 注册`}
          >
            {removing ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function stdioSnippet(vadRoot?: string): string {
  const args = ["<path-to-vibeboard>/cli.js", "mcp"];
  if (vadRoot) args.push("--root", vadRoot);
  return JSON.stringify({ mcpServers: { vibeboard: { command: "node", args } } }, null, 2);
}

function relativeTime(at: number): string {
  const diff = Math.max(0, Date.now() - at);
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} 小时前`;
  return `${Math.round(diff / 86_400_000)} 天前`;
}
