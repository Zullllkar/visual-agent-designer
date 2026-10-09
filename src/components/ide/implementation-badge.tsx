"use client";

/**
 * mockup 右下角的实现验收徽标
 * --------------------------------------------------------------
 * 从 implementation-store 取该素材最近一次 report_implementation 的结果：
 *   例：9.2 分 / 待修 6.0 分 / 2 个 high / 仅显示偏差计数
 * 鼠标悬停可查看摘要、预览链接和时间；详细结果由右侧 dock 展示。
 */

import { CheckCircle2, CircleDashed, Wrench, XCircle } from "lucide-react";
import { latestReportForAsset, useImplementationStore } from "@/store/implementation-store";

const STYLE = {
  pass: { bg: "rgba(16,185,129,0.92)", fg: "#ffffff", label: "验收通过" },
  "needs-work": { bg: "rgba(245,158,11,0.94)", fg: "#1f1300", label: "待修" },
  "off-track": { bg: "rgba(239,68,68,0.92)", fg: "#ffffff", label: "偏离较大" },
  unreviewed: { bg: "rgba(15,15,18,0.70)", fg: "#e5e7eb", label: "待视觉验收" },
} as const;

export function ImplementationBadge({
  projectId,
  assetId,
}: {
  projectId: string;
  assetId: string;
}) {
  const report = useImplementationStore((s) =>
    latestReportForAsset(s.byProject[projectId], assetId),
  );
  if (!report) return null;

  const style = STYLE[report.verdict] ?? STYLE["needs-work"];
  const high = report.deviations.filter((d) => d.severity === "high").length;
  const Icon =
    report.verdict === "pass"
      ? CheckCircle2
      : report.verdict === "off-track"
        ? XCircle
        : report.verdict === "unreviewed"
          ? CircleDashed
          : Wrench;
  const score = report.score === null ? "" : ` ${report.score.toFixed(1)}`;
  const tail =
    report.verdict === "pass" || report.verdict === "unreviewed"
      ? ""
      : high > 0
        ? ` · ${high} 个 high`
        : report.deviations.length > 0
          ? ` · ${report.deviations.length} 项偏差`
          : "";
  const when = new Date(report.createdAt);
  const title = [
    `${style.label}${score}`,
    report.summary,
    report.url ? report.url : "",
    `${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div
      title={title}
      style={{
        position: "absolute",
        right: 8,
        bottom: 8,
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 8px",
        borderRadius: 999,
        background: style.bg,
        color: style.fg,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.03em",
        lineHeight: 1.2,
        backdropFilter: "blur(8px)",
        boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
        pointerEvents: "none",
        whiteSpace: "nowrap",
      }}
    >
      <Icon size={10} strokeWidth={2.5} />
      {style.label}
      {score}
      {tail}
    </div>
  );
}
