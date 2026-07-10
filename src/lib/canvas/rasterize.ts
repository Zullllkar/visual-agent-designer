/**
 * SVG → PNG Rasterizer (server-only)
 * --------------------------------------------------------------
 * 用 @resvg/resvg-js 把 CanvasPage 渲染成 PNG buffer / base64 data URL，
 * 供 Vision Critic 把页面"截图"喂给视觉模型。
 *
 * 注意事项：
 *  - 仅服务端可用（resvg-js 是 native binding，绑入 client bundle 会爆）
 *  - SVG 中已嵌入 image href（data:image/svg+xml,...），resvg 会递归渲染
 *  - 字体：依赖系统已安装的 PingFang SC / Microsoft YaHei / Noto Sans SC；
 *    在常见 macOS / Windows / 部分 Linux 镜像上中文都能正常渲染。
 *    若服务器无中文字体，文本将渲染为方框，但 PNG 仍能输出，整条 pipeline
 *    仍可用（vision 模型的批评维度依旧成立）。
 */

import "server-only";

import { Resvg } from "@resvg/resvg-js";
import type { CanvasPage } from "./schema";
import { renderPageToSvgString } from "./render-static";

export interface RasterizeOptions {
  /** PNG 最大宽度，超过会等比缩放。默认 1024，平衡质量与体积。 */
  maxWidth?: number;
}

export function rasterizePageToPngBuffer(
  page: CanvasPage,
  opts: RasterizeOptions = {}
): Buffer {
  const svg = renderPageToSvgString(page);
  const targetW = Math.min(page.width, opts.maxWidth ?? 1024);

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: targetW },
    font: {
      loadSystemFonts: true,
      defaultFontFamily: "PingFang SC",
      // 失败时再尝试这些常见中文字体
      fontFiles: [],
    },
    background: page.background ?? "#FFFFFF",
  });

  const pngData = resvg.render().asPng();
  return Buffer.from(pngData);
}

/** 直接产出 base64 data URL（OpenAI Vision API 接受）。 */
export function rasterizePageToDataUrl(
  page: CanvasPage,
  opts: RasterizeOptions = {}
): string {
  const buf = rasterizePageToPngBuffer(page, opts);
  return `data:image/png;base64,${buf.toString("base64")}`;
}
