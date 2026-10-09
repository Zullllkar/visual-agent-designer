"use client";

import { Check, Clipboard, GripVertical, ImageIcon, Play, Sparkles } from "lucide-react";
import { useState } from "react";
import type { AssetPlan, ProjectFile } from "@/lib/project/schema";
import { compareAssetPlans, reorderAssetPlan, validateAssetPlan } from "@/lib/project/asset-plan";

export function AssetPlanPanel({
  project,
  onRunPrompt,
  onProjectUpdate,
}: {
  project: ProjectFile;
  onRunPrompt?: (prompt: string) => void;
  onProjectUpdate?: (project: ProjectFile) => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftPrompt, setDraftPrompt] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const plan = project.assetPlan;
  if (!plan) {
    return (
      <div className="grid h-full place-items-center p-6 text-center text-xs text-[var(--muted)]">
        <div>
          <Sparkles className="mx-auto mb-2 size-5 opacity-60" />
          <p>还没有素材计划</p>
          <p className="mt-1 text-[11px]">让 Agent 先梳理素材清单，再逐项生成。</p>
        </div>
      </div>
    );
  }
  const planned = plan.items.filter((item) => item.status === "planned").length;
  const generated = plan.items.filter((item) => item.status === "generated").length;
  const validation = validateAssetPlan(plan);
  const previousVersion = plan.history?.at(-1);
  const versionDiff = previousVersion ? compareAssetPlans({ ...plan, items: previousVersion.items }, plan) : null;
  const updatePlan = (nextPlan: AssetPlan) => {
    if (!onProjectUpdate) return;
    const history = [...(nextPlan.history ?? []), { version: (nextPlan.history?.at(-1)?.version ?? 0) + 1, savedAt: plan.updatedAt, items: plan.items }].slice(-8);
    onProjectUpdate({ ...project, assetPlan: { ...nextPlan, history }, updatedAt: nextPlan.updatedAt });
  };
  const reorder = (toIndex: number) => {
    if (dragIndex === null || !onProjectUpdate) return;
    const nextPlan = reorderAssetPlan(plan, dragIndex, toIndex);
    updatePlan(nextPlan);
    setDragIndex(null);
  };
  const run = () => onRunPrompt?.("按照当前 Asset Plan 继续生成素材，逐项补齐，暂不进 Review。");
  return (
    <div className="flex h-full min-w-0 flex-col overflow-auto p-3">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Asset Plan</p>
            <p className="mt-1 text-[13px] font-medium text-[var(--foreground)]">{plan.summary}</p>
          </div>
          <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-[10px] text-[var(--muted)]">{generated}/{plan.items.length} 已生成</span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted)]">
          <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${plan.items.length ? (generated / plan.items.length) * 100 : 0}%` }} />
        </div>
        <div className={`mt-2 text-[10px] ${validation.ok ? "text-emerald-600" : "text-red-600"}`}>{validation.ok ? "计划校验通过" : validation.errors.join("；")}</div>
        {versionDiff ? <div className="mt-1 text-[10px] text-[var(--muted)]">相对上版：新增 {versionDiff.added.length} 项、移除 {versionDiff.removed.length} 项、修改 {versionDiff.changed.length} 项{versionDiff.reordered ? "，并调整了顺序" : ""}</div> : null}
        {planned > 0 && onRunPrompt ? (
          <button type="button" onClick={run} className="mt-3 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 text-[11px] font-medium text-white hover:opacity-90">
            <Play className="size-3" /> 按计划生成
          </button>
        ) : null}
      </div>
      <div className="mt-3 space-y-2">
        {plan.items.map((item, index) => (
          <AssetPlanItem key={item.id} item={item} index={index} copied={copied === item.id} editing={editingId === item.id} draftPrompt={editingId === item.id ? draftPrompt : item.prompt} draggable={Boolean(onProjectUpdate)} onDragStart={() => setDragIndex(index)} onDragOver={(event) => event.preventDefault()} onDrop={() => reorder(index)} onEdit={() => { setEditingId(item.id); setDraftPrompt(item.prompt); }} onCancel={() => setEditingId(null)} onSave={() => {
            if (!onProjectUpdate || !draftPrompt.trim()) return;
            updatePlan({ ...plan, items: plan.items.map((candidate) => candidate.id === item.id ? { ...candidate, prompt: draftPrompt.trim() } : candidate), updatedAt: new Date().toISOString() });
            setEditingId(null);
          }} onPromptChange={setDraftPrompt} onCopy={() => {
            void navigator.clipboard?.writeText(item.prompt).then(() => {
              setCopied(item.id);
              window.setTimeout(() => setCopied(null), 1200);
            });
          }} />
        ))}
      </div>
    </div>
  );
}

function AssetPlanItem({ item, index, copied, editing, draftPrompt, draggable, onDragStart, onDragOver, onDrop, onEdit, onCancel, onSave, onPromptChange, onCopy }: { item: AssetPlan["items"][number]; index: number; copied: boolean; editing: boolean; draftPrompt: string; draggable: boolean; onDragStart: () => void; onDragOver: (event: React.DragEvent<HTMLDivElement>) => void; onDrop: () => void; onEdit: () => void; onCancel: () => void; onSave: () => void; onPromptChange: (value: string) => void; onCopy: () => void }) {
  return (
    <div draggable={draggable} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5">
      <div className="flex items-center gap-2">
        {draggable ? <GripVertical className="size-3.5 cursor-grab text-[var(--muted)]" /> : null}
        <span className="grid size-6 place-items-center rounded-md bg-[var(--surface-muted)] text-[10px] text-[var(--muted)]">{String(index + 1).padStart(2, "0")}</span>
        <ImageIcon className="size-3.5 text-[var(--primary)]" />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{item.purpose}</span>
        <span className="text-[10px] text-[var(--muted)]">{item.status === "generated" ? <Check className="size-3.5 text-emerald-600" /> : item.priority}</span>
      </div>
      <div className="mt-2 flex items-start gap-2">
        {editing ? <textarea value={draftPrompt} onChange={(event) => onPromptChange(event.target.value)} rows={4} className="min-h-20 flex-1 resize-y rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-2 text-[11px] leading-relaxed outline-none focus:border-[var(--primary)]" /> : <p className="line-clamp-3 flex-1 text-[11px] leading-relaxed text-[var(--muted)]">{item.prompt}</p>}
        <button type="button" onClick={onCopy} aria-label="复制 Prompt" className="rounded-md p-1 text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]">
          {copied ? <Check className="size-3" /> : <Clipboard className="size-3" />}
        </button>
      </div>
      {editing ? <div className="mt-2 flex justify-end gap-1.5"><button type="button" onClick={onCancel} className="rounded-md px-2 py-1 text-[10px] text-[var(--muted)] hover:bg-[var(--surface-muted)]">取消</button><button type="button" onClick={onSave} className="rounded-md bg-[var(--primary)] px-2 py-1 text-[10px] text-white">保存</button></div> : <button type="button" onClick={onEdit} className="mt-1 text-[10px] text-[var(--primary)] hover:underline">编辑 Prompt</button>}
      <div className="mt-2 flex gap-1.5 text-[10px] text-[var(--muted)]"><span>{item.role}</span><span>·</span><span>{item.width} × {item.height}</span></div>
    </div>
  );
}
