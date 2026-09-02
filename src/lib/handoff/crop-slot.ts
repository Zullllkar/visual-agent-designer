/**
 * 从整图按 bbox 裁切槽位预览 / 失败回退图（server-only，resvg）
 */

import "server-only";

import { Resvg } from "@resvg/resvg-js";
import type { BBox } from "./layout-ir";
import { resolveAssetImageDataUrl } from "./resolve-asset-src";

export async function cropSlotFromMockup(input: {
  src: string;
  width: number;
  height: number;
  bbox: BBox;
  /** 输出最大边，默认 1024 */
  maxEdge?: number;
  projectId?: string;
}): Promise<{ dataUrl: string; width: number; height: number } | null> {
  const href = await resolveAssetImageDataUrl(input.src, input.projectId);
  if (!href) return null;

  const fullW = Math.max(1, Math.round(input.width));
  const fullH = Math.max(1, Math.round(input.height));
  const vx = clamp(input.bbox.x, 0, 1) * fullW;
  const vy = clamp(input.bbox.y, 0, 1) * fullH;
  const vw = Math.max(2, clamp(input.bbox.w, 0.01, 1) * fullW);
  const vh = Math.max(2, clamp(input.bbox.h, 0.01, 1) * fullH);

  const maxEdge = input.maxEdge ?? 1024;
  const scale = Math.min(1, maxEdge / Math.max(vw, vh));
  const outW = Math.max(2, Math.round(vw * scale));
  const outH = Math.max(2, Math.round(vh * scale));

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`,
    ` width="${outW}" height="${outH}" viewBox="${vx} ${vy} ${vw} ${vh}">`,
    `<image href="${escapeXml(href)}" width="${fullW}" height="${fullH}" preserveAspectRatio="none"/>`,
    `</svg>`,
  ].join("");

  try {
    const resvg = new Resvg(svg, {
      fitTo: { mode: "width", value: outW },
      font: { loadSystemFonts: false },
    });
    const png = Buffer.from(resvg.render().asPng());
    return {
      dataUrl: `data:image/png;base64,${png.toString("base64")}`,
      width: outW,
      height: outH,
    };
  } catch {
    return null;
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
