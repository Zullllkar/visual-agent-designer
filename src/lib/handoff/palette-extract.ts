/**
 * 从 mockup 图片提取像素色板（server-only，resvg 解码）
 * --------------------------------------------------------------
 * 图先缩到 ≤160px 边（色板不需要分辨率），再走 palette-core 的量化。
 * 解码失败（webp / 坏图）返回 null，调用方保持原有 tokens。
 */

import "server-only";

import { Resvg } from "@resvg/resvg-js";
import {
  buildPalette,
  buildRegionSwatch,
  type PaletteEntry,
  type RegionSwatch,
  type RgbaImage,
} from "./palette-core";

const SAMPLE_MAX_EDGE = 160;

export interface ExtractedPalette {
  palette: PaletteEntry[];
  regions: Record<string, RegionSwatch>;
  sampleWidth: number;
  sampleHeight: number;
}

export async function extractPaletteFromDataUrl(
  dataUrl: string,
  opts?: {
    maxColors?: number;
    regions?: Array<{ id: string; bbox?: { x: number; y: number; w: number; h: number } }>;
  },
): Promise<ExtractedPalette | null> {
  const image = decodeToRgba(dataUrl);
  if (!image) return null;

  const palette = buildPalette(image, opts?.maxColors ?? 8);
  const regions: Record<string, RegionSwatch> = {};
  for (const region of opts?.regions ?? []) {
    if (!region.bbox) continue;
    const swatch = buildRegionSwatch(image, region.bbox);
    if (swatch) regions[region.id] = swatch;
  }
  return { palette, regions, sampleWidth: image.width, sampleHeight: image.height };
}

function decodeToRgba(dataUrl: string): RgbaImage | null {
  const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) return null;
  const bytes = Buffer.from(m[2], "base64");
  const size = probeSize(bytes);
  const srcW = size?.width ?? SAMPLE_MAX_EDGE;
  const srcH = size?.height ?? SAMPLE_MAX_EDGE;
  const scale = Math.min(1, SAMPLE_MAX_EDGE / Math.max(srcW, srcH));
  const outW = Math.max(2, Math.round(srcW * scale));
  const outH = Math.max(2, Math.round(srcH * scale));

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`,
    ` width="${outW}" height="${outH}" viewBox="0 0 ${srcW} ${srcH}">`,
    `<image href="${escapeXml(dataUrl)}" width="${srcW}" height="${srcH}" preserveAspectRatio="none"/>`,
    `</svg>`,
  ].join("");

  try {
    const resvg = new Resvg(svg, {
      fitTo: { mode: "width", value: outW },
      font: { loadSystemFonts: false },
    });
    const rendered = resvg.render();
    const pixels = new Uint8Array(rendered.pixels);
    if (pixels.length !== rendered.width * rendered.height * 4) return null;
    return { width: rendered.width, height: rendered.height, pixels };
  } catch {
    return null;
  }
}

function probeSize(buf: Buffer): { width: number; height: number } | null {
  if (
    buf.length >= 24 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = buf[i + 1];
      if (marker === 0xc0 || marker === 0xc2) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
