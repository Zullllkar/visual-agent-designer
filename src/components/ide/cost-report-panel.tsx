"use client";

import { useEffect, useState } from "react";
import type { ProjectCostSummary, ToolCostRecord } from "@/lib/agents/cost-tracker";

export function CostReportPanel({ projectId }: { projectId: string }) {
  const [summary, setSummary] = useState<ProjectCostSummary | null>(null);
  const [records, setRecords] = useState<ToolCostRecord[]>([]);
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/projects/${encodeURIComponent(projectId)}/cost`).then((response) => response.json()).then((data: { summary?: ProjectCostSummary; records?: ToolCostRecord[] }) => {
      if (cancelled) return;
      setSummary(data.summary ?? null);
      setRecords(data.records ?? []);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [projectId]);
  if (!summary) return <div className="p-4 text-xs text-[var(--muted)]">正在读取成本统计…</div>;
  return (
    <div className="flex h-full min-w-0 flex-col overflow-auto p-3">
      <div className="grid grid-cols-2 gap-2">
        <Metric label="累计成本" value={`$${summary.totalCostUsd.toFixed(3)}`} />
        <Metric label="运行次数" value={String(summary.runCount)} />
        <Metric label="工具调用" value={String(summary.totalToolCalls)} />
        <Metric label="总耗时" value={`${Math.round(summary.totalDurationMs / 1000)}s`} />
      </div>
      <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
        <p className="text-[11px] font-semibold">按阶段汇总</p>
        <div className="mt-2 space-y-1.5">{Object.entries(summary.byPhase).map(([phase, value]) => <div key={phase} className="flex justify-between text-[10px]"><span className="text-[var(--muted)]">{phase}</span><span>${value.costUsd.toFixed(3)} · {value.count} 次</span></div>)}</div>
      </div>
      <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
        <p className="text-[11px] font-semibold">最近工具成本</p>
        <div className="mt-2 space-y-1.5">{records.slice(0, 12).map((record) => <div key={record.id} className="flex justify-between text-[10px]"><span className="truncate text-[var(--muted)]">{record.toolName}</span><span>${record.costUsd.toFixed(3)}</span></div>)}</div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"><p className="text-[10px] text-[var(--muted)]">{label}</p><p className="mt-1 text-base font-semibold">{value}</p></div>;
}
