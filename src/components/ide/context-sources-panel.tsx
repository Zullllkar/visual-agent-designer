"use client";

import { Database, Eye, EyeOff } from "lucide-react";
import type { ProjectFile } from "@/lib/project/schema";
import { listContextSources, updateContextSource } from "@/lib/project/context-sources";

export function ContextSourcesPanel({ project, onProjectUpdate }: { project: ProjectFile; onProjectUpdate: (project: ProjectFile) => void }) {
  const sources = listContextSources(project);
  return (
    <div className="flex h-full min-w-0 flex-col overflow-auto p-3">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
        <div className="flex items-center gap-2"><Database className="size-4 text-[var(--primary)]" /><strong className="text-[12px]">上下文来源</strong></div>
        <p className="mt-1 text-[10px] leading-relaxed text-[var(--muted)]">控制 Agent 可以读取哪些项目信息；优先级数字越小越靠前。</p>
      </div>
      <div className="mt-3 space-y-2">
        {sources.map((source) => (
          <div key={source.id} className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5">
            <button type="button" aria-label={source.enabled ? `停用 ${source.label}` : `启用 ${source.label}`} onClick={() => onProjectUpdate(updateContextSource(project, source.id, { enabled: !source.enabled }))} className="rounded-md p-1 text-[var(--muted)] hover:bg-[var(--surface-muted)]">
              {source.enabled ? <Eye className="size-3.5 text-emerald-600" /> : <EyeOff className="size-3.5" />}
            </button>
            <span className={`min-w-0 flex-1 text-[11px] ${source.enabled ? "" : "text-[var(--muted)] line-through"}`}>{source.label}</span>
            <select aria-label={`${source.label} 优先级`} value={source.priority} onChange={(event) => onProjectUpdate(updateContextSource(project, source.id, { priority: Number(event.target.value) }))} className="rounded border border-[var(--border)] bg-[var(--surface-muted)] px-1.5 py-1 text-[10px]">
              {sources.map((_, index) => <option key={index} value={index}>{index + 1}</option>)}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
