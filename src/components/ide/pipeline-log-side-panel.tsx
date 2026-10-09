"use client";

/**
 * IDE 侧栏：历史流水线日志
 * @author：wangjunhua
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
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
    <aside className="flex h-full min-w-0 flex-col overflow-hidden">
      <div className="vad-inspector-toolbar">
        <span>{entries.length} 条日志</span>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="vad-agent-icon-btn disabled:opacity-40"
          aria-label="刷新日志"
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
        </button>
      </div>
      <div className="vad-inspector-scroll">
        {error ? (
          <p className="text-[12px] text-[var(--danger)]">{error}</p>
        ) : loading && entries.length === 0 ? (
          <div className="grid h-28 place-items-center text-[var(--muted)]">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : entries.length === 0 ? (
          <div className="vad-inspector-empty">
            <div>
              <p className="text-[13px] font-medium tracking-[-0.02em]">还没有执行日志</p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--muted)]">
                Agent 跑生图或导出时，步骤会记在这里。
                </p>
            </div>
          </div>
        ) : (
          <div className="vad-inspector-card">
            <PipelineLogPanel
              entries={entries}
              showHeader={false}
              tone="panel"
              maxHeight="none"
            />
          </div>
        )}
      </div>
    </aside>
  );
}
