"use client";

/**
 * Bridge 请求坞
 * --------------------------------------------------------------
 * coding agent 从 Cursor / Codex / Claude Code 发来的待处理请求：
 *   asset    — 要一张素材，需要批准（花钱）
 *   question — 设计歧义提问，需要回答
 *   proposal — 结构化 Layout IR 变更，批准后立刻写回项目
 * 以及最近一次实现验收结果。没有待办且没有新报告时完全不渲染。
 */

import {
  Check,
  ChevronDown,
  ChevronUp,
  GitPullRequestArrow,
  Image as ImageIcon,
  MessageSquare,
  Send,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type ImplementationReportDto, useImplementationStore } from "@/store/implementation-store";

interface BridgeRequestDto {
  requestId: string;
  kind: "asset" | "question" | "proposal";
  status: "pending" | "approved" | "rejected" | "answered" | "expired";
  createdAt: number;
  jobId?: string;
  proposal?: {
    assetId: string;
    description: string;
    rationale: string;
    change: { kind: string; slotId?: string };
  };
  asset?: {
    description: string;
    role?: string;
    width: number;
    height: number;
    count: number;
    referenceAssetId?: string;
    estimatedUsd?: number;
  };
  question?: { question: string; options?: string[]; context?: string };
}

type ReportDto = ImplementationReportDto;

const PROPOSAL_KIND_LABEL: Record<string, string> = {
  copy: "改文案",
  bbox: "调整位置",
  "convert-to-code": "改用代码绘制",
  "remove-slot": "删除区域",
  "add-state": "增加状态",
  note: "备注",
};

export function BridgeRequestDock({ projectId }: { projectId: string }) {
  const [requests, setRequests] = useState<BridgeRequestDto[]>([]);
  const [reports, setReports] = useState<ReportDto[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [dismissedReportId, setDismissedReportId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const publishReports = useImplementationStore((s) => s.setReports);

  const refresh = useCallback(async () => {
    try {
      const [reqRes, repRes] = await Promise.all([
        fetch(`/mcp/requests?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" }),
        fetch(`/mcp/reports?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" }),
      ]);
      if (reqRes.ok) {
        const body = (await reqRes.json()) as { requests?: BridgeRequestDto[] };
        setRequests(body.requests ?? []);
      }
      if (repRes.ok) {
        const body = (await repRes.json()) as { reports?: ReportDto[] };
        const next = body.reports ?? [];
        setReports(next);
        publishReports(projectId, next);
      }
    } catch {
      // Bridge 未就绪：静默，下一轮再试
    }
  }, [projectId, publishReports]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 4000);
    return () => clearInterval(timer);
  }, [refresh]);

  const resolve = useCallback(
    async (requestId: string, action: "approve" | "reject" | "answer", payload?: string) => {
      setBusy(requestId);
      try {
        await fetch("/mcp/requests", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            requestId,
            action,
            ...(action === "answer" ? { answer: payload } : {}),
            ...(action === "reject" && payload ? { reason: payload } : {}),
          }),
        });
      } finally {
        setBusy(null);
        void refresh();
      }
    },
    [refresh]
  );

  const latestReport = useMemo(() => {
    const newest = reports[0];
    if (!newest || newest.id === dismissedReportId) return null;
    // 只提示最近 10 分钟内的验收，避免每次打开项目都弹旧报告
    return Date.now() - Date.parse(newest.createdAt) < 10 * 60_000 ? newest : null;
  }, [reports, dismissedReportId]);

  if (requests.length === 0 && !latestReport) return null;

  return (
    <div className="pointer-events-auto absolute bottom-4 left-4 z-20 w-[min(380px,calc(100%-2rem))] space-y-2">
      <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 shadow-[var(--shadow-soft)]">
        <span className="text-[11px] font-semibold">
          来自 coding agent
          {requests.length > 0 ? ` · ${requests.length} 条待处理` : ""}
        </span>
        <button
          type="button"
          className="app-subtle"
          aria-label={expanded ? "收起" : "展开"}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
        </button>
      </div>

      {expanded ? (
        <>
          {requests.map((request) =>
            request.kind === "asset" && request.asset ? (
              <div
                key={request.requestId}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow-soft)]"
              >
                <p className="flex items-center gap-1.5 text-[11px] font-semibold">
                  <ImageIcon className="size-3.5" />
                  请求生成素材
                  {request.asset.estimatedUsd ? (
                    <span className="font-normal app-subtle">约 ${request.asset.estimatedUsd}</span>
                  ) : null}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed">{request.asset.description}</p>
                <p className="mt-0.5 text-[10px] app-subtle">
                  {request.asset.width}×{request.asset.height}
                  {request.asset.role ? ` · ${request.asset.role}` : ""}
                  {request.asset.count > 1 ? ` · ${request.asset.count} 张` : ""}
                  {request.asset.referenceAssetId ? " · 带参考图" : ""}
                </p>
                <div className="mt-2 flex gap-1.5">
                  <button
                    type="button"
                    disabled={busy === request.requestId}
                    onClick={() => void resolve(request.requestId, "approve")}
                    className="inline-flex h-7 items-center gap-1 rounded-md bg-[var(--primary)] px-2.5 text-[11px] font-semibold text-white disabled:opacity-50"
                  >
                    <Check className="size-3" />
                    批准生成
                  </button>
                  <button
                    type="button"
                    disabled={busy === request.requestId}
                    onClick={() => void resolve(request.requestId, "reject", "设计侧不需要这张图")}
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border)] px-2.5 text-[11px] disabled:opacity-50"
                  >
                    <X className="size-3" />
                    拒绝
                  </button>
                </div>
              </div>
            ) : request.kind === "proposal" && request.proposal ? (
              <div
                key={request.requestId}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow-soft)]"
              >
                <p className="flex items-center gap-1.5 text-[11px] font-semibold">
                  <GitPullRequestArrow className="size-3.5" />
                  设计变更提案
                  <span className="font-normal app-subtle">
                    {PROPOSAL_KIND_LABEL[request.proposal.change.kind] ?? request.proposal.change.kind}
                    {request.proposal.change.slotId ? ` · ${request.proposal.change.slotId}` : ""}
                  </span>
                </p>
                <p className="mt-1 text-[11px] leading-relaxed">{request.proposal.description}</p>
                <p className="mt-0.5 text-[10px] leading-relaxed app-subtle">{request.proposal.rationale}</p>
                <div className="mt-2 flex gap-1.5">
                  <button
                    type="button"
                    disabled={busy === request.requestId}
                    onClick={() => void resolve(request.requestId, "approve")}
                    className="inline-flex h-7 items-center gap-1 rounded-md bg-[var(--primary)] px-2.5 text-[11px] font-semibold text-white disabled:opacity-50"
                  >
                    <Check className="size-3" />
                    批准并应用
                  </button>
                  <button
                    type="button"
                    disabled={busy === request.requestId}
                    onClick={() => void resolve(request.requestId, "reject", "保持原设计")}
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border)] px-2.5 text-[11px] disabled:opacity-50"
                  >
                    <X className="size-3" />
                    拒绝
                  </button>
                </div>
              </div>
            ) : request.question ? (
              <div
                key={request.requestId}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow-soft)]"
              >
                <p className="flex items-center gap-1.5 text-[11px] font-semibold">
                  <MessageSquare className="size-3.5" />
                  coding agent 提问
                </p>
                <p className="mt-1 text-[11px] leading-relaxed">{request.question.question}</p>
                {request.question.context ? (
                  <p className="mt-0.5 text-[10px] app-subtle">{request.question.context}</p>
                ) : null}
                {request.question.options?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {request.question.options.map((option) => (
                      <button
                        key={option}
                        type="button"
                        disabled={busy === request.requestId}
                        onClick={() => void resolve(request.requestId, "answer", option)}
                        className="inline-flex h-7 items-center rounded-md border border-[var(--border)] px-2 text-[11px] hover:border-[var(--primary)] disabled:opacity-50"
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="mt-2 flex gap-1.5">
                  <input
                    className="h-7 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-2 text-[11px]"
                    placeholder="直接回答…"
                    value={answers[request.requestId] ?? ""}
                    onChange={(e) =>
                      setAnswers((prev) => ({ ...prev, [request.requestId]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      const value = (answers[request.requestId] ?? "").trim();
                      if (value) void resolve(request.requestId, "answer", value);
                    }}
                  />
                  <button
                    type="button"
                    disabled={busy === request.requestId || !(answers[request.requestId] ?? "").trim()}
                    onClick={() =>
                      void resolve(request.requestId, "answer", (answers[request.requestId] ?? "").trim())
                    }
                    className="inline-flex h-7 items-center gap-1 rounded-md bg-[var(--primary)] px-2 text-[11px] font-semibold text-white disabled:opacity-50"
                  >
                    <Send className="size-3" />
                  </button>
                </div>
              </div>
            ) : null
          )}

          {latestReport ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow-soft)]">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[11px] font-semibold">
                  实现验收{" "}
                  {latestReport.score === null ? "—" : `${latestReport.score.toFixed(1)}/10`}
                  <span
                    className={
                      "ml-1.5 font-normal " +
                      (latestReport.verdict === "pass"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : latestReport.verdict === "off-track"
                          ? "text-red-600 dark:text-red-400"
                          : latestReport.verdict === "unreviewed"
                            ? "app-subtle"
                            : "text-amber-600 dark:text-amber-400")
                    }
                  >
                    {latestReport.verdict === "pass"
                      ? "通过"
                      : latestReport.verdict === "off-track"
                        ? "偏离较大"
                        : latestReport.verdict === "unreviewed"
                          ? "未比对"
                          : "待修"}
                  </span>
                  {latestReport.verdict === "unreviewed" ? (
                    <span className="ml-1.5 font-normal app-subtle">
                      需要配置支持视觉的模型才能对照定稿图
                    </span>
                  ) : latestReport.source === "heuristic" ? (
                    <span className="ml-1.5 font-normal app-subtle">未启用视觉比对</span>
                  ) : null}
                </p>
                <button
                  type="button"
                  className="app-subtle"
                  aria-label="关闭验收提示"
                  onClick={() => setDismissedReportId(latestReport.id)}
                >
                  <X className="size-3.5" />
                </button>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed">{latestReport.summary}</p>
              {latestReport.deviations.length > 0 ? (
                <ul className="mt-1.5 space-y-1">
                  {latestReport.deviations.slice(0, 4).map((d, i) => (
                    <li key={`${d.slot}-${i}`} className="text-[10px] leading-relaxed app-subtle">
                      <span
                        className={
                          d.severity === "high"
                            ? "text-red-600 dark:text-red-400"
                            : d.severity === "medium"
                              ? "text-amber-600 dark:text-amber-400"
                              : ""
                        }
                      >
                        [{d.kind}]
                      </span>{" "}
                      {d.slot ? `${d.slot}：` : ""}
                      {d.fixHint || d.expected}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
