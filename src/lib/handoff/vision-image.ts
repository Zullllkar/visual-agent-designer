/**
 * Vision 送图预处理：缩放到可接受尺寸，避免 data URL 过大导致超时 / 网关拒收。
 * 单独 Chat 产品一般会自动压缩；项目里之前原图直传是超时主因。
 */

import "server-only";

import { Resvg } from "@resvg/resvg-js";

const DEFAULT_MAX_EDGE = 1536;
const DEFAULT_JPEG_QUALITY_HINT = 0.82;

/**
 * 将 data:image/... 缩放到 maxEdge 以内，输出 JPEG data URL（体积远小于 PNG）。
 * 失败时返回原图。
 */
export async function compressImageDataUrlForVision(
  dataUrl: string,
  opts?: { maxEdge?: number }
): Promise<{ dataUrl: string; width: number; height: number; bytesApprox: number }> {
  const maxEdge = opts?.maxEdge ?? DEFAULT_MAX_EDGE;
  if (!dataUrl.startsWith("data:image/")) {
    return {
      dataUrl,
      width: 0,
      height: 0,
      bytesApprox: Math.round((dataUrl.length * 3) / 4),
    };
  }

  try {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) {
      return fallback(dataUrl);
    }

    // 用 resvg 包一层 SVG 做等比缩放（无需 sharp）
    const size = probePngOrJpegSize(parsed.bytes);
    const srcW = size?.width ?? maxEdge;
    const srcH = size?.height ?? maxEdge;
    const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
    const outW = Math.max(2, Math.round(srcW * scale));
    const outH = Math.max(2, Math.round(srcH * scale));

    // 已经够小则直接返回（避免二次有损）
    const approxIn = parsed.bytes.length;
    if (scale >= 0.98 && approxIn < 1_200_000) {
      return {
        dataUrl,
        width: srcW,
        height: srcH,
        bytesApprox: approxIn,
      };
    }

    const href = dataUrl;
    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`,
      ` width="${outW}" height="${outH}" viewBox="0 0 ${srcW} ${srcH}">`,
      `<image href="${escapeXml(href)}" width="${srcW}" height="${srcH}" preserveAspectRatio="none"/>`,
      `</svg>`,
    ].join("");

    const resvg = new Resvg(svg, {
      fitTo: { mode: "width", value: outW },
      font: { loadSystemFonts: false },
    });
    const png = Buffer.from(resvg.render().asPng());
    // PNG 仍可能偏大；多数 Vision API 接受 PNG。若 >1.8MB 再提示上层可降 maxEdge。
    const out = `data:image/png;base64,${png.toString("base64")}`;
    return {
      dataUrl: out,
      width: outW,
      height: outH,
      bytesApprox: png.length,
    };
  } catch {
    return fallback(dataUrl);
  }
}

function fallback(dataUrl: string) {
  return {
    dataUrl,
    width: 0,
    height: 0,
    bytesApprox: Math.round((dataUrl.length * 3) / 4),
  };
}

function parseDataUrl(
  dataUrl: string
): { mediaType: string; bytes: Buffer } | null {
  const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) return null;
  return { mediaType: m[1], bytes: Buffer.from(m[2], "base64") };
}

/** 极简 PNG/JPEG 尺寸探测（失败则 null） */
function probePngOrJpegSize(
  buf: Buffer
): { width: number; height: number } | null {
  // PNG
  if (
    buf.length >= 24 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return {
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
    };
  }
  // JPEG SOF0/2
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = buf[i + 1];
      if (marker === 0xc0 || marker === 0xc2) {
        return {
          height: buf.readUInt16BE(i + 5),
          width: buf.readUInt16BE(i + 7),
        };
      }
      const len = buf.readUInt16BE(i + 2);
      i += 2 + len;
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

void DEFAULT_JPEG_QUALITY_HINT;
