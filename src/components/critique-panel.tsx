"use client";

import { useState } from "react";
import {
  ChevronDown,
  AlertTriangle,
  AlertCircle,
  Info,
  ArrowRight,
  Wrench,
} from "lucide-react";
import type {
  CritiqueIssue,
  CritiqueReport,
  ProjectCritique,
  CritiqueHistoryEntry,
} from "@/lib/agents/critic-schema";

/**
 * 工作台右侧「质量评审」面板
 * --------------------------------------------------------------
 * 展示项目级总分 + 评审迭代时间轴 + 当前页 / 全部页的 issues。
 *
 * @author：wangjunhua
 */
export function CritiquePanel({
  critique,
  activePageId,
  history,
  onRepair,
  onRollback,
}: {
  critique?: ProjectCritique;
  activePageId?: string;
  history?: CritiqueHistoryEntry[];
  onRepair?: (input: { pageId: string; issue: CritiqueIssue }) => void;
  onRollback?: () => void;
}) {
  if (!critique || critique.reports.length === 0) {
    return (
      <p className="mt-2 rounded-md bg-[var(--surface-muted)] p-3 text-xs leading-relaxed app-subtle">
        暂无质量评审。下次生成时会自动产出。
      </p>
    );
  }

  const activeReport =
    critique.reports.find((r) => r.pageId === activePageId) ??
    critique.reports[0];

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between rounded-md bg-[var(--surface-muted)] p-3">
        <span className="text-xs app-subtle">总分</span>
        <ScoreBadge score={critique.overallScore} large />
      </div>

      {history && history.length > 1 ? <HistoryTimeline history={history} /> : null}
      {onRollback ? (
        <button type="button" onClick={onRollback} className="inline-flex h-7 w-full items-center justify-center rounded-md border app-border text-[10px] app-subtle hover:bg-[var(--surface-muted)]">
          恢复最近一次修复前的版本
        </button>
      ) : null}

      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] font-medium app-subtle">
            当前页：{activeReport.pageId}
          </span>
          <ScoreBadge score={activeReport.score} />
        </div>
        <p className="mt-1.5 rounded-md bg-[var(--surface-muted)] p-2 text-[11px] leading-relaxed app-strong">
          {activeReport.summary}
        </p>
      </div>

      <IssueList report={activeReport} onRepair={onRepair} />

      <details className="group rounded-md border app-border">
        <summary className="flex cursor-pointer items-center justify-between gap-2 px-2.5 py-1.5 text-[11px] app-subtle transition hover:bg-[var(--surface-muted)]">
          <span>所有页面 ({critique.reports.length})</span>
          <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t app-border">
          {critique.reports.map((r) => (
            <div
              key={r.pageId}
              className="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border)_50%,transparent)] px-2.5 py-1.5 text-[11px] last:border-0"
            >
              <span className="app-strong">{r.pageId}</span>
              <div className="flex items-center gap-2">
                <span className="app-subtle">{r.issues.length} 问题</span>
                <ScoreBadge score={r.score} />
              </div>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function HistoryTimeline({ history }: { history: CritiqueHistoryEntry[] }) {
  const sorted = [...history].sort((a, b) => a.round - b.round);
  const accepted = sorted.filter((h) => h.accepted);
  const final = accepted.length > 0 ? accepted[accepted.length - 1] : sorted[0];
  const initial = sorted[0];
  const delta = final.overallScore - initial.overallScore;

  return (
    <div className="rounded-md border app-border p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider app-subtle">
          评审迭代
        </span>
        <span
          className={
            "text-[11px] font-mono " +
            (delta > 0
              ? "text-emerald-600 dark:text-emerald-400"
              : delta < 0
                ? "text-red-600 dark:text-red-400"
                : "app-subtle")
          }
        >
          {delta > 0 ? "+" : ""}
          {delta.toFixed(1)}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-1 overflow-x-auto pb-1">
        {sorted.map((h, i) => (
          <div key={h.round} className="flex shrink-0 items-center gap-1">
            <div
              className={
                "flex flex-col items-center rounded-md px-1.5 py-1 " +
                (h.accepted
                  ? "bg-emerald-50 dark:bg-emerald-950/40"
                  : "bg-[var(--surface-muted)] opacity-60")
              }
              title={h.accepted ? "已采纳" : "未采纳（分数未提升）"}
            >
              <span className="text-[9px] app-subtle">
                {h.round === 0 ? "init" : `R${h.round}`}
              </span>
              <ScoreBadge score={h.overallScore} />
            </div>
            {i < sorted.length - 1 ? (
              <ArrowRight className="size-3 shrink-0 app-subtle" />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function IssueList({ report, onRepair }: { report: CritiqueReport; onRepair?: (input: { pageId: string; issue: CritiqueIssue }) => void }) {
  if (report.issues.length === 0) {
    return (
      <p className="rounded-md bg-emerald-50 p-2 text-[11px] text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
        ✓ 当前页未发现问题
      </p>
    );
  }
  return (
    <ul className="space-y-1.5">
      {report.issues.map((issue, i) => (
        <IssueRow key={i} issue={issue} pageId={report.pageId} onRepair={onRepair} />
      ))}
    </ul>
  );
}

function IssueRow({ issue, pageId, onRepair }: { issue: CritiqueIssue; pageId: string; onRepair?: (input: { pageId: string; issue: CritiqueIssue }) => void }) {
  const [open, setOpen] = useState(false);
  const Icon =
    issue.severity === "high"
      ? AlertTriangle
      : issue.severity === "medium"
        ? AlertCircle
        : Info;
  const tone =
    issue.severity === "high"
      ? "text-red-600 dark:text-red-400"
      : issue.severity === "medium"
        ? "text-amber-600 dark:text-amber-400"
        : "app-subtle";

  return (
    <li className="rounded-md border app-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left transition hover:bg-[var(--surface-muted)]"
      >
        <Icon className={"mt-0.5 size-3.5 shrink-0 " + tone} />
        <div className="flex-1">
          <div className="flex items-center gap-1.5">
            <span className="rounded-sm bg-[var(--surface-muted)] px-1 text-[9px] font-medium uppercase tracking-wider app-subtle">
              {issue.category}
            </span>
            <SourceBadge source={issue.source} />
          </div>
          <p className="mt-0.5 text-[11px] leading-snug app-strong">
            {issue.message}
          </p>
        </div>
        <ChevronDown
          className={
            "mt-0.5 size-3 shrink-0 app-subtle transition-transform " +
            (open ? "rotate-180" : "")
          }
        />
      </button>
      {open && issue.suggestion ? (
        <p className="border-t app-border bg-[var(--surface-muted)] px-2.5 py-1.5 text-[11px] app-strong">
          建议：{issue.suggestion}
        </p>
      ) : null}
      {onRepair ? (
        <div className="border-t app-border px-2.5 py-1.5">
          <button
            type="button"
            onClick={() => onRepair({ pageId, issue })}
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--primary-soft)] px-2 py-1 text-[10px] font-medium text-[var(--primary)] hover:opacity-80"
          >
            <Wrench className="size-3" /> 让 Agent 修复
          </button>
        </div>
      ) : null}
    </li>
  );
}

function SourceBadge({ source }: { source?: string }) {
  const tone =
    source === "vision"
      ? "bg-[var(--primary-soft)] text-[var(--primary)]"
      : source === "llm"
        ? "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-[var(--accent)]"
        : "bg-[var(--surface-muted)] app-subtle";
  return (
    <span
      className={
        "rounded-sm px-1 text-[9px] font-medium uppercase tracking-wider " +
        tone
      }
    >
      {source ?? "-"}
    </span>
  );
}

function ScoreBadge({ score, large = false }: { score: number; large?: boolean }) {
  const tone =
    score >= 8
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
      : score >= 6
        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
        : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
  return (
    <span
      className={
        "rounded-md px-1.5 font-mono font-semibold " +
        tone +
        (large ? " text-2xl py-1" : " text-[11px] py-0.5")
      }
    >
      {score.toFixed(1)}
    </span>
  );
}
