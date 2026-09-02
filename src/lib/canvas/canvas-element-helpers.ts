/**
 * Canvas Element Helpers
 * --------------------------------------------------------------
 * 从 manipulate-canvas.ts 提取的共享辅助函数。
 * 覆盖：ID 生成、文本测量、颜色转换、元素查找、箭头绑定几何。
 */

import type { CanvasNode, CanvasPage } from "@/lib/canvas/schema";

/** 生成 10 字符随机 ID (nanoid 风格) */
export function generateCanvasId(): string {
  return Math.random().toString(36).slice(2, 12);
}

/** 测量文本宽度（粗略估算，基于 fontSize 和字符数） */
export function measureTextWidth(text: string, fontSize: number): number {
  // 粗略估算：中文字符约 1.0em，英文字符约 0.6em
  let width = 0;
  for (const char of text) {
    if (/[\u4e00-\u9fff\u3000-\u303f]/.test(char)) {
      width += fontSize;
    } else {
      width += fontSize * 0.6;
    }
  }
  return Math.ceil(width);
}

/** 估算文本所需高度 */
export function measureTextHeight(text: string, fontSize: number, maxWidth: number): number {
  const charWidth = fontSize * 0.6;
  const charsPerLine = Math.max(1, Math.floor(maxWidth / charWidth));
  const lines = Math.ceil(text.length / charsPerLine);
  return Math.ceil(lines * fontSize * 1.4);
}

/** 颜色转换：hex → rgb 对象 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return null;
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  };
}

/** 颜色转换：rgb → hex */
export function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

/** 颜色强制转换：接受 hex/rgb/rgba，返回 hex */
export function coerceColor(color: string | undefined, fallback = "#000000"): string {
  if (!color) return fallback;
  if (color.startsWith("#")) return color;
  const rgbMatch = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(color);
  if (rgbMatch) {
    return rgbToHex(
      parseInt(rgbMatch[1]),
      parseInt(rgbMatch[2]),
      parseInt(rgbMatch[3])
    );
  }
  const rgbaMatch = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*[\d.]+\)$/.exec(color);
  if (rgbaMatch) {
    return rgbToHex(
      parseInt(rgbaMatch[1]),
      parseInt(rgbaMatch[2]),
      parseInt(rgbaMatch[3])
    );
  }
  return fallback;
}

/** 在页面中查找节点 */
export function findNode(page: CanvasPage, nodeId: string): CanvasNode | undefined {
  return page.nodes.find((n) => n.id === nodeId);
}

/** 获取节点中心点 */
export function getNodeCenter(node: CanvasNode): { x: number; y: number } {
  return {
    x: node.x + node.width / 2,
    y: node.y + node.height / 2,
  };
}

/** 计算节点边缘最近点（用于箭头绑定） */
export function computeEdgePoint(
  from: { x: number; y: number },
  node: CanvasNode
): { x: number; y: number } {
  const center = getNodeCenter(node);
  const dx = from.x - center.x;
  const dy = from.y - center.y;
  const halfW = node.width / 2;
  const halfH = node.height / 2;

  if (Math.abs(dx) / halfW > Math.abs(dy) / halfH) {
    // 命中左右边
    const x = dx > 0 ? node.x + node.width : node.x;
    const ratio = dy / (Math.abs(dx) || 1);
    const y = center.y + ratio * halfW;
    return { x, y: Math.max(node.y, Math.min(y, node.y + node.height)) };
  } else {
    // 命中上下边
    const y = dy > 0 ? node.y + node.height : node.y;
    const ratio = dx / (Math.abs(dy) || 1);
    const x = center.x + ratio * halfH;
    return { x: Math.max(node.x, Math.min(x, node.x + node.width)), y };
  }
}

/** 生成节点简短标签 */
export function shortLabel(node: CanvasNode): string {
  const id = node.id.slice(0, 6);
  switch (node.type) {
    case "text":
      return `text:${id}`;
    case "image":
      return `image:${id}`;
    case "frame":
      return `frame:${id}`;
    case "button":
      return `button:${id}`;
    case "card":
      return `card:${id}`;
    case "line":
      return `line:${id}`;
    case "shape":
      return `shape:${id}`;
    default:
      return `node:${id}`;
  }
}

/** 检查两个节点是否重叠 */
export function nodesOverlap(a: CanvasNode, b: CanvasNode): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** 计算节点包围盒 */
export function boundingBox(nodes: CanvasNode[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} | null {
  if (nodes.length === 0) return null;
  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxX = Math.max(...nodes.map((n) => n.x + n.width));
  const maxY = Math.max(...nodes.map((n) => n.y + n.height));
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}
