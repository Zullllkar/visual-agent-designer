/**
 * 确定性几何检查
 * --------------------------------------------------------------
 * 不依赖 LLM；扫描 CanvasPage 的几何属性，产出一组 CritiqueIssue。
 * 这一层永远会跑，保证即便 LLM 不可用也能给用户结构化反馈。
 */

import type { CanvasNode, CanvasPage } from "@/lib/canvas/schema";
import type { CritiqueIssue } from "./critic-schema";

const TEXT_MIN_FONT = 10;
const TEXT_MAX_FONT = 96;

export function runDeterministicChecks(page: CanvasPage): CritiqueIssue[] {
  const issues: CritiqueIssue[] = [];

  if (page.nodes.length === 0) {
    issues.push({
      severity: "high",
      category: "content",
      message: `页面「${page.name}」是空的，没有任何节点。`,
      source: "check",
    });
    return issues;
  }

  for (const n of page.nodes) {
    // 越界
    if (n.x < 0 || n.y < 0) {
      issues.push({
        severity: "high",
        category: "overflow",
        message: `节点位置为负 (x=${n.x}, y=${n.y})。`,
        affectedNodeIds: [n.id],
        source: "check",
      });
    }
    if (n.x + n.width > page.width || n.y + n.height > page.height) {
      issues.push({
        severity: "high",
        category: "overflow",
        message: `节点超出画布边界（页面 ${page.width}×${page.height}，节点终点 ${
          n.x + n.width
        },${n.y + n.height}）。`,
        affectedNodeIds: [n.id],
        suggestion: "缩小节点尺寸或调整 x/y 使其落在画布内。",
        source: "check",
      });
    }

    // 字号异常
    if (n.type === "text" && n.fontSize !== undefined) {
      if (n.fontSize < TEXT_MIN_FONT) {
        issues.push({
          severity: "medium",
          category: "typography",
          message: `文本「${truncate(n.content, 12)}」字号 ${n.fontSize}px 偏小，可读性差。`,
          affectedNodeIds: [n.id],
          suggestion: `建议至少 ${TEXT_MIN_FONT}px。`,
          source: "check",
        });
      } else if (n.fontSize > TEXT_MAX_FONT) {
        issues.push({
          severity: "low",
          category: "typography",
          message: `文本字号 ${n.fontSize}px 过大。`,
          affectedNodeIds: [n.id],
          source: "check",
        });
      }
    }
  }

  // 重叠（两两包围盒相交，忽略 frame/background 与其它节点的容器关系）
  const interactive = page.nodes.filter(
    (n) => n.type !== "frame" || (n.fill && n.fill !== page.background)
  );
  for (let i = 0; i < interactive.length; i++) {
    for (let j = i + 1; j < interactive.length; j++) {
      const a = interactive[i];
      const b = interactive[j];
      if (overlap(a, b)) {
        issues.push({
          severity: "medium",
          category: "overlap",
          message: `节点重叠：${describe(a)} ∩ ${describe(b)}。`,
          affectedNodeIds: [a.id, b.id],
          suggestion: "将其中一个移到下方或调整尺寸。",
          source: "check",
        });
      }
    }
  }

  return issues;
}

/** 0-10 的几何健康分。 */
export function geometryScore(issues: CritiqueIssue[]): number {
  let score = 10;
  for (const i of issues) {
    if (i.source !== "check") continue;
    score -= severityPenalty(i.severity);
  }
  return Math.max(0, Math.round(score * 10) / 10);
}

function severityPenalty(s: CritiqueIssue["severity"]): number {
  return s === "high" ? 2 : s === "medium" ? 1 : 0.4;
}

function overlap(a: CanvasNode, b: CanvasNode) {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

function describe(n: CanvasNode): string {
  switch (n.type) {
    case "text":
      return `text "${truncate(n.content, 10)}"`;
    case "button":
      return `button "${n.label}"`;
    case "image":
      return `image`;
    case "card":
      return `card "${n.title ?? ""}"`;
    case "frame":
      return `frame`;
    case "line":
      return `line`;
    case "shape":
      return `${n.shape} shape`;
  }
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
