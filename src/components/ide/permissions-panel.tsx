"use client";

import { LockKeyhole, RotateCcw, ShieldCheck, X } from "lucide-react";
import { toolContract } from "@/lib/agents/tool-contract";
import type { ProjectFile } from "@/lib/project/schema";

export function PermissionsPanel({ project, onProjectUpdate }: { project: ProjectFile; onProjectUpdate: (project: ProjectFile) => void }) {
  const grants = Object.keys(project.approvalPolicy ?? {});
  const revoke = (name?: string) => {
    const next = { ...(project.approvalPolicy ?? {}) };
    if (name) delete next[name]; else for (const key of Object.keys(next)) delete next[key];
    onProjectUpdate({ ...project, approvalPolicy: Object.keys(next).length ? next : undefined, updatedAt: new Date().toISOString() });
  };
  return (
    <div className="flex h-full min-w-0 flex-col overflow-auto p-3">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
        <div className="flex items-start gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-[var(--primary-soft)] text-[var(--primary)]"><ShieldCheck className="size-4" /></span>
          <div><p className="text-[12px] font-medium">自动授权</p><p className="mt-1 text-[10px] leading-relaxed text-[var(--muted)]">这些工具已获准在本项目中自动执行。撤销后，该工具下次仍会请求确认。</p></div>
        </div>
      </div>
      {grants.length === 0 ? <div className="grid flex-1 place-items-center p-6 text-center text-xs text-[var(--muted)]"><div><LockKeyhole className="mx-auto mb-2 size-5 opacity-60" /><p>还没有自动授权的工具</p><p className="mt-1 text-[11px]">在工具确认里勾选“本项目后续自动允许此类操作”后会出现在这里。</p></div></div> : <div className="mt-3 space-y-2">{grants.map((name) => <div key={name} className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5"><span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-medium">{toolContract(name)?.label ?? name}</span><span className="mt-0.5 block truncate text-[10px] text-[var(--muted)]">{name}</span></span><button type="button" onClick={() => revoke(name)} className="rounded-md p-1 text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-red-600" aria-label="移除授权"><X className="size-3.5" /></button></div>)}</div>}
      {grants.length > 0 ? <button type="button" onClick={() => revoke()} className="mt-3 inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] text-[10px] text-[var(--muted)] hover:bg-[var(--surface-muted)]"><RotateCcw className="size-3" /> 清空全部授权</button> : null}
    </div>
  );
}
