"use client";

/**
 * Handoff 对话框里的「关联代码仓库」区块。
 * 桌面端用系统目录选择器；浏览器端手填绝对路径。
 */

import { useState } from "react";
import { Check, ExternalLink, FolderOpen, Link2, Loader2, Unlink } from "lucide-react";
import type { ProjectFile } from "@/lib/project/schema";
import { cursorPromptDeeplink } from "@/lib/bridge/install-planner";
import { openDeeplink } from "@/lib/bridge/use-bridge-status";
import { buildRepoKickoffText } from "@/lib/handoff/kickoff-prompt";
import { useDesktopRuntime } from "@/lib/desktop/use-desktop-runtime";

interface SyncPayload {
  ok: boolean;
  project?: ProjectFile;
  sync?: {
    written?: number;
    removed?: number;
    agentFiles?: string[];
    mcpFiles?: string[];
    warnings?: string[];
    error?: string;
    git?: boolean;
    path?: string;
    mountDir?: string;
  };
  message?: string;
}

export function HandoffRepoLink({
  project,
  onProjectUpdate,
}: {
  project: ProjectFile;
  onProjectUpdate?: (project: ProjectFile) => void;
}) {
  const desktop = useDesktopRuntime();
  const linked = project.linkedRepo;
  const [path, setPath] = useState(linked?.path ?? "");
  const [busy, setBusy] = useState<"link" | "sync" | "unlink" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    if (!window.vadDesktop?.pickDirectory) return;
    const result = await window.vadDesktop.pickDirectory();
    if (result.ok && result.path) setPath(result.path);
  };

  const run = async (method: "POST" | "PATCH" | "DELETE") => {
    setBusy(method === "POST" ? "link" : method === "PATCH" ? "sync" : "unlink");
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/repo`, {
        method,
        headers: method === "POST" ? { "content-type": "application/json" } : undefined,
        body: method === "POST" ? JSON.stringify({ path }) : undefined,
      });
      const body = (await res.json()) as SyncPayload & { error?: string; message?: string };
      if (!res.ok || body.ok === false) {
        setError(body.message ?? body.sync?.error ?? body.error ?? `HTTP ${res.status}`);
        if (body.project) onProjectUpdate?.(body.project);
        return;
      }
      if (body.project) onProjectUpdate?.(body.project);
      if (method === "DELETE") {
        setMessage("已取消关联。仓库里已写入的文件保留。");
        return;
      }
      const sync = body.sync;
      setMessage(
        `已同步 ${sync?.written ?? 0} 个文件到 ${sync?.mountDir ?? "design/vibeboard"}` +
          (sync?.agentFiles?.length ? `，写入 ${sync.agentFiles.join("、")}` : "") +
          (sync?.git === false ? "（该目录不是 git 仓库）" : "")
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const openInCursor = () => {
    const mount = linked?.mountDir ?? "design/vibeboard";
    openDeeplink(cursorPromptDeeplink(buildRepoKickoffText(project, mount)));
  };

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)]/40 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide app-subtle">同步到代码仓库</p>
      <p className="mt-1 text-[11px] leading-relaxed app-subtle">
        不用下载 zip。关联后，设计稿会写到仓库的 <code>design/vibeboard/</code>，并补上
        AGENTS.md / CLAUDE.md / Cursor 规则和项目级 MCP 配置。打开 Cursor 就能直接写代码。
      </p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-xs"
          placeholder={desktop ? "点击选择目录，或粘贴绝对路径" : "代码仓库的绝对路径"}
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        {desktop ? (
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 text-[11px]"
            onClick={() => void pick()}
          >
            <FolderOpen className="size-3.5" />
            选择
          </button>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={!path.trim() || busy !== null}
          onClick={() => void run("POST")}
          className="inline-flex h-8 items-center gap-1 rounded-lg bg-[var(--primary)] px-2.5 text-[11px] font-semibold text-white disabled:opacity-50"
        >
          {busy === "link" ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
          {linked?.path ? "重新关联并同步" : "关联并同步"}
        </button>
        {linked?.path ? (
          <>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run("PATCH")}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 text-[11px] disabled:opacity-50"
            >
              {busy === "sync" ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              再次同步
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={openInCursor}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 text-[11px]"
            >
              <ExternalLink className="size-3.5" />
              在 Cursor 中打开
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run("DELETE")}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 text-[11px] disabled:opacity-50"
            >
              {busy === "unlink" ? <Loader2 className="size-3.5 animate-spin" /> : <Unlink className="size-3.5" />}
              取消关联
            </button>
          </>
        ) : null}
      </div>
      {linked?.lastSyncedAt ? (
        <p className="mt-1.5 text-[10px] app-subtle">上次同步 {linked.lastSyncedAt.replace("T", " ").slice(0, 19)}</p>
      ) : null}
      {message ? <p className="mt-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">{message}</p> : null}
      {error ? <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">{error}</p> : null}
    </section>
  );
}