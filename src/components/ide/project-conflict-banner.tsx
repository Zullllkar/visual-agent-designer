"use client";

import { AlertTriangle, Check } from "lucide-react";
import type { ProjectConflict } from "@/store/project-store";

export function ProjectConflictBanner({ conflict, onReload, onDismiss }: { conflict?: ProjectConflict; onReload: () => void; onDismiss: () => void }) {
  if (!conflict) return null;
  return <div className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-950 shadow-lg"><AlertTriangle className="size-3.5" /><span>另一个窗口更新了此项目（版本 {conflict.remoteRevision ?? "?"}）。</span><button type="button" onClick={onReload} className="rounded-md bg-amber-200 px-2 py-1 font-medium">重新加载</button><button type="button" onClick={onDismiss} aria-label="关闭冲突提示" className="rounded p-1 hover:bg-amber-200"><Check className="size-3" /></button></div>;
}
