/**
 * 在原图上绘制框选 Mark，输出标注参考图（data URL）
 * @author：wangjunhua
 */

import type { MarkRegion } from "@/store/asset-mark-store";

export async function createRegionAnnotatedDataUrl(
  src: string,
  region: MarkRegion
): Promise<string> {
  const img = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建 canvas 上下文");

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const rx = region.x * canvas.width;
  const ry = region.y * canvas.height;
  const rw = Math.max(2, region.w * canvas.width);
  const rh = Math.max(2, region.h * canvas.height);

  // 暗化非选区
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.clearRect(rx, ry, rw, rh);
  ctx.drawImage(img, rx, ry, rw, rh, rx, ry, rw, rh);

  // 红框高亮
  ctx.strokeStyle = "#EF4444";
  ctx.lineWidth = Math.max(3, Math.round(Math.min(canvas.width, canvas.height) * 0.008));
  ctx.setLineDash([]);
  ctx.strokeRect(rx, ry, rw, rh);

  ctx.fillStyle = "rgba(239, 68, 68, 0.18)";
  ctx.fillRect(rx, ry, rw, rh);

  // 角标
  const corner = Math.max(8, Math.round(Math.min(rw, rh) * 0.12));
  ctx.strokeStyle = "#FCA5A5";
  ctx.lineWidth = Math.max(2, ctx.lineWidth - 1);
  drawCorner(ctx, rx, ry, corner, "tl");
  drawCorner(ctx, rx + rw, ry, corner, "tr");
  drawCorner(ctx, rx, ry + rh, corner, "bl");
  drawCorner(ctx, rx + rw, ry + rh, corner, "br");

  return canvas.toDataURL("image/png");
}

function drawCorner(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  len: number,
  corner: "tl" | "tr" | "bl" | "br"
) {
  ctx.beginPath();
  if (corner === "tl") {
    ctx.moveTo(x, y + len);
    ctx.lineTo(x, y);
    ctx.lineTo(x + len, y);
  } else if (corner === "tr") {
    ctx.moveTo(x - len, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + len);
  } else if (corner === "bl") {
    ctx.moveTo(x, y - len);
    ctx.lineTo(x, y);
    ctx.lineTo(x + len, y);
  } else {
    ctx.moveTo(x - len, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y - len);
  }
  ctx.stroke();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("标注图加载原图失败"));
    img.src = src;
  });
}

export function buildRegionEditPrompt(
  instruction: string,
  originalPrompt: string,
  region: MarkRegion
): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return [
    "Edit ONLY the red-highlighted rectangular region in the annotated reference image.",
    "Keep everything outside the red box unchanged: composition, lighting, style, and unselected content.",
    `Marked region (normalized): x=${pct(region.x)}, y=${pct(region.y)}, w=${pct(region.w)}, h=${pct(region.h)}.`,
    `User instruction for the marked region: ${instruction.trim()}`,
    `Original image context prompt: ${originalPrompt.slice(0, 400)}`,
    "Second reference is the annotated map with the red box; first reference is the original image.",
  ].join(" ");
}
