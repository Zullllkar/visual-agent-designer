/**
 * Static SVG string renderer (isomorphic, dependency-free)
 * --------------------------------------------------------------
 * 把 CanvasPage 渲染为可独立保存的 SVG 字符串。
 *
 * 设计要点：
 *  - 纯字符串拼接，不依赖 react-dom/server，避免 Next.js 把 react-dom/server
 *    误判为 client bundle 的问题。
 *  - 同构可用：client 端 handoff zip 用、server 端 rasterize 也用。
 *  - 与 src/lib/canvas/svg-renderer.tsx 中的 CanvasSvg React 组件保持视觉一致；
 *    UI 预览继续用那个组件。
 */

import type { CanvasNode, CanvasPage } from "./schema";

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', 'Hiragino Sans GB', sans-serif";

export function renderPageToSvgString(page: CanvasPage): string {
  const body = page.nodes.map(renderNode).join("");
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}" viewBox="0 0 ${page.width} ${page.height}" role="img" aria-label="${esc(page.name)}">`,
    `<rect x="0" y="0" width="${page.width}" height="${page.height}" fill="${esc(page.background ?? "#ffffff")}"/>`,
    body,
    `</svg>`,
  ].join("\n");
}

function renderNode(node: CanvasNode): string {
  switch (node.type) {
    case "frame":
      return `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" fill="${esc(node.fill ?? "transparent")}" rx="${node.radius ?? 0}" ry="${node.radius ?? 0}"/>`;
    case "text": {
      const fontSize = node.fontSize ?? 14;
      return renderTextBlock({
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        content: node.content,
        fontSize,
        fontWeight: node.fontWeight ?? 400,
        color: node.color ?? "#111827",
        align: node.align,
      });
    }
    case "image": {
      const clip = node.radius
        ? `<defs><clipPath id="clip-${esc(node.id)}"><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${node.radius}" ry="${node.radius}"/></clipPath></defs>`
        : "";
      const clipAttr = node.radius ? ` clip-path="url(#clip-${esc(node.id)})"` : "";
      return `<g>${clip}<image href="${esc(node.src)}" x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" preserveAspectRatio="xMidYMid slice"${clipAttr}/></g>`;
    }
    case "button":
      return `<g><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" fill="${esc(node.fill ?? "#111827")}" rx="${node.radius ?? 8}" ry="${node.radius ?? 8}"/><text x="${node.x + node.width / 2}" y="${node.y + node.height / 2 + 5}" fill="${esc(node.color ?? "#ffffff")}" font-size="15" font-weight="600" text-anchor="middle" font-family="${esc(FONT_STACK)}">${esc(node.label)}</text></g>`;
    case "card": {
      const title = node.title
        ? renderTextBlock({
            x: node.x + 16,
            y: node.y + 14,
            width: node.width - 32,
            height: 26,
            content: node.title,
            fontSize: 15,
            fontWeight: 600,
            color: "#111827",
          })
        : "";
      const body = node.body
        ? renderTextBlock({
            x: node.x + 16,
            y: node.y + 40,
            width: node.width - 32,
            height: Math.max(24, node.height - 56),
            content: node.body,
            fontSize: 12,
            fontWeight: 400,
            color: "#6B7280",
          })
        : "";
      return `<g><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" fill="${esc(node.fill ?? "#ffffff")}" rx="${node.radius ?? 12}" ry="${node.radius ?? 12}" stroke="#E4E4E7" stroke-width="1"/>${title}${body}</g>`;
    }
    case "line":
      return `<line x1="${node.x}" y1="${node.y}" x2="${node.x2}" y2="${node.y2}" stroke="${esc(node.stroke ?? "#111827")}" stroke-width="${node.strokeWidth ?? 1}"${node.arrow ? ' marker-end="url(#arrowhead)"' : ""}/>`;
    case "shape": {
      const fill = esc(node.fill ?? "transparent");
      const stroke = esc(node.stroke ?? "transparent");
      const strokeWidth = node.strokeWidth ?? 0;
      if (node.shape === "ellipse") {
        return `<ellipse cx="${node.x + node.width / 2}" cy="${node.y + node.height / 2}" rx="${node.width / 2}" ry="${node.height / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
      }
      return `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" rx="${node.radius ?? 0}"/>`;
    }
  }
}

function renderTextBlock(opts: {
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
  fontSize: number;
  fontWeight?: number;
  color: string;
  align?: "left" | "center" | "right";
}): string {
  const {
    x,
    y,
    width,
    height,
    content,
    fontSize,
    fontWeight = 400,
    color,
    align = "left",
  } = opts;
  const lineHeight = Math.round(fontSize * 1.25);
  const maxLines = Math.max(1, Math.floor(height / lineHeight));
  const lines = wrapText(content, width, fontSize, maxLines);
  const tx = align === "center" ? x + width / 2 : align === "right" ? x + width : x;
  const anchor = align === "center" ? "middle" : align === "right" ? "end" : "start";
  const tspans = lines
    .map(
      (line, index) =>
        `<tspan x="${tx}" dy="${index === 0 ? 0 : lineHeight}">${esc(line)}</tspan>`
    )
    .join("");

  return `<text x="${tx}" y="${y + fontSize}" fill="${esc(color)}" font-size="${fontSize}" font-weight="${fontWeight}" text-anchor="${anchor}" font-family="${esc(FONT_STACK)}">${tspans}</text>`;
}

function wrapText(
  content: string,
  width: number,
  fontSize: number,
  maxLines: number
): string[] {
  const maxChars = Math.max(1, Math.floor(width / Math.max(fontSize * 0.56, 6)));
  const units = Array.from(content);
  const lines: string[] = [];
  let current = "";

  for (const unit of units) {
    if ((current + unit).length > maxChars) {
      lines.push(current);
      current = unit;
      if (lines.length === maxLines) break;
    } else {
      current += unit;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);

  if (lines.length > 0 && units.join("").length > lines.join("").length) {
    lines[lines.length - 1] = truncateLine(lines[lines.length - 1], maxChars);
  }
  return lines.length > 0 ? lines : [""];
}

function truncateLine(line: string, maxChars: number): string {
  if (maxChars <= 1) return "…";
  return `${line.slice(0, Math.max(0, maxChars - 1))}…`;
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
