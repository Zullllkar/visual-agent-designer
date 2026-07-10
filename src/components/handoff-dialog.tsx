"use client";

import { useState } from "react";
import { Check, Copy, Loader2, Package, X } from "lucide-react";
import type { ProjectFile } from "@/lib/project/schema";
import type { HandoffTarget } from "@/lib/handoff/types";
import { downloadHandoffZip } from "@/lib/handoff/client-download";
import { buildKickoffClipboardText } from "@/lib/handoff/kickoff-prompt";
import { McpQuickCopy } from "@/components/mcp-quick-copy";

const TARGETS: Array<{
  id: HandoffTarget["name"];
  label: string;
  desc: string;
  entry: string;
}> = [
  {
    id: "cursor",
    label: "Cursor",
    desc: "包含 .cursorrules，Cursor 自动加载",
    entry: ".cursorrules",
  },
  {
    id: "claude-code",
    label: "Claude Code",
    desc: "包含 CLAUDE.md，Claude Code 自动读取",
    entry: "CLAUDE.md",
  },
  {
    id: "codex",
    label: "Codex / OpenAI Agent",
    desc: "包含 AGENTS.md，Codex 自动读取",
    entry: "AGENTS.md",
  },
  {
    id: "markdown",
    label: "通用 Markdown",
    desc: "纯 README + SPEC，可贴给任何 LLM",
    entry: "README.md",
  },
];

export function HandoffDialog({
  project,
  onClose,
}: {
  project: ProjectFile;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<HandoffTarget["name"] | null>(null);
  const [copied, setCopied] = useState<HandoffTarget["name"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState(false);

  async function exportTarget(id: HandoffTarget["name"]) {
    setBusy(id);
    setError(null);
    try {
      await downloadHandoffZip(project, id);
      setExported(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function copyKickoff(id: HandoffTarget["name"]) {
    setError(null);
    try {
      const text = buildKickoffClipboardText(project, id);
      await navigator.clipboard.writeText(text);
      setCopied(id);
      window.setTimeout(() => setCopied((cur) => (cur === id ? null : cur)), 2000);
    } catch (err) {
      setError((err as Error).message || "复制失败");
    }
  }

  return (
    <div className="app-dialog-overlay" onClick={onClose}>
      <div
        className="app-dialog max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Package className="size-4 app-accent-text" />
              导出 Handoff 包
            </h2>
            <p className="mt-1 text-xs app-subtle">
              下载 zip，或一键复制启动 prompt 粘贴到 coding 工具。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 app-subtle transition hover:bg-[var(--surface-muted)]"
            aria-label="关闭"
          >
            <X className="size-4" />
          </button>
        </div>

        <ul className="mt-4 space-y-2">
          {TARGETS.map((t) => (
            <li key={t.id}>
              <div className="app-card flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium">{t.label}</span>
                  <p className="text-xs app-subtle">{t.desc}</p>
                  <code className="mt-1 block text-[10px] app-subtle">
                    入口: {t.entry}
                  </code>
                </div>
                <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void copyKickoff(t.id)}
                    className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-[var(--border)] px-2.5 text-[11px] font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-muted)] disabled:opacity-50"
                  >
                    {copied === t.id ? (
                      <>
                        <Check className="size-3.5 text-emerald-600" />
                        已复制
                      </>
                    ) : (
                      <>
                        <Copy className="size-3.5" />
                        复制 Prompt
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void exportTarget(t.id)}
                    className="inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-[var(--primary)] px-2.5 text-[11px] font-semibold text-white disabled:opacity-50"
                  >
                    {busy === t.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : null}
                    下载 Zip
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>

        {error ? (
          <p className="mt-3 text-xs text-red-600 dark:text-red-400">出错：{error}</p>
        ) : null}

        <p className="mt-4 text-[11px] leading-relaxed app-subtle">
          zip 内容包括：README / SPEC / 视觉素材 PNG / prompt 清单 / 设计 token / 启动 prompt。
          「复制 Prompt」只复制可粘贴正文，不下载文件。
        </p>

        {exported ? (
          <p className="mt-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            Handoff 包已开始下载。请继续配置 MCP，在 Claude Code / Cursor 中写代码。
          </p>
        ) : null}

        <McpQuickCopy />
      </div>
    </div>
  );
}
