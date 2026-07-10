"use client";

/**
 * IDE 侧栏：历史流水线日志
 * @author：wangjunhua
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, ScrollText } from "lucide-react";
import type { PipelineLogEntry } from "@/lib/agents/pipeline-logger";
import { PipelineLogPanel } from "@/components/pipeline-log-panel";

export function PipelineLogSidePanel({
  projectId,
  refreshKey = 0,
}: {
  projectId: string;
  refreshKey?: number;
}) {
  const [entries, setEntries] = useState<PipelineLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/pipeline-log`);
      const data = (await res.json()) as { entries?: PipelineLogEntry[] };
      setEntries(data.entries ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <aside className="flex h-full min-w-0 flex-col overflow-hidden border-r border-zinc-900 bg-zinc-950">
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-900 px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-bold text-[#F4F7FA]">
          <ScrollText className="size-4 text-[#B5A075]" />
          执行日志
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1 text-[10px] font-bold text-[#B5A075] disabled:opacity-40"
        >
          {loading ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <RefreshCw className="size-3" />
          )}
          刷新
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {error ? (
          <p className="text-xs text-red-400">{error}</p>
        ) : loading && entries.length === 0 ? (
          <p className="text-xs text-zinc-500">加载中…</p>
        ) : (
          <PipelineLogPanel
            entries={entries}
            showHeader={false}
            maxHeight="none"
          />
        )}
      </div>
    </aside>
  );
}
