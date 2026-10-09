"use client";

/**
 * 实现验收报告（coding agent 通过 report_implementation 回报）的客户端缓存
 * --------------------------------------------------------------
 * BridgeRequestDock 轮询 /mcp/reports 后写入这里；画布上的 mockup 卡片
 * 按 assetId 取最近一次结论显示徽标，设计者不用去翻 dock 或磁盘。
 */

import { create } from "zustand";

export type ImplementationVerdict = "pass" | "needs-work" | "off-track" | "unreviewed";

export interface ImplementationReportDto {
  id: string;
  assetId?: string;
  /** unreviewed 时为 null */
  score: number | null;
  verdict: ImplementationVerdict;
  summary: string;
  source: "vision" | "heuristic";
  url?: string;
  createdAt: string;
  deviations: Array<{
    slot: string;
    kind: string;
    severity: "low" | "medium" | "high";
    expected: string;
    actual: string;
    fixHint: string;
  }>;
}

interface ImplementationState {
  byProject: Record<string, ImplementationReportDto[]>;
  setReports: (projectId: string, reports: ImplementationReportDto[]) => void;
}

export const useImplementationStore = create<ImplementationState>((set) => ({
  byProject: {},
  setReports: (projectId, reports) =>
    set((s) => {
      const prev = s.byProject[projectId];
      // 内容没变就不触发订阅者重渲染（卡片很多）
      if (prev && sameReports(prev, reports)) return s;
      return { byProject: { ...s.byProject, [projectId]: reports } };
    }),
}));

/** 某个 mockup 最近一次报告；报告按 createdAt 倒序时 O(n) 找第一条即可 */
export function latestReportForAsset(
  reports: ImplementationReportDto[] | undefined,
  assetId: string,
): ImplementationReportDto | undefined {
  if (!reports) return undefined;
  let best: ImplementationReportDto | undefined;
  for (const r of reports) {
    if (r.assetId !== assetId) continue;
    if (!best || r.createdAt > best.createdAt) best = r;
  }
  return best;
}

function sameReports(a: ImplementationReportDto[], b: ImplementationReportDto[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].createdAt !== b[i].createdAt) return false;
  }
  return true;
}
