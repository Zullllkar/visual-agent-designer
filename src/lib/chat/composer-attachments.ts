/**
 * Composer 粘贴 / 拖拽参考图
 * --------------------------------------------------------------
 * @author：wangjunhua
 */

import { nanoid } from "nanoid";
import type { ReferenceAsset } from "@/lib/project/assets-schema";

const MAX_ATTACHMENTS = 3;
const MAX_BYTES = 2_500_000;

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name);
}

export async function filesToReferenceAssets(
  files: File[],
  existingCount = 0,
  source: ReferenceAsset["source"] = "clipboard"
): Promise<ReferenceAsset[]> {
  const room = Math.max(0, MAX_ATTACHMENTS - existingCount);
  const images = files.filter(isImageFile).slice(0, room);
  const out: ReferenceAsset[] = [];
  for (const file of images) {
    if (file.size > MAX_BYTES) continue;
    const src = await readFileAsDataUrl(file);
    const size = await readImageSize(src);
    out.push({
      id: nanoid(10),
      label: file.name || (source === "upload" ? "上传参考图" : "粘贴参考图"),
      src,
      width: size.width,
      height: size.height,
      source,
      createdAt: new Date().toISOString(),
    });
  }
  return out;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function readImageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve({
        width: img.naturalWidth || 1200,
        height: img.naturalHeight || 800,
      });
    img.onerror = () => resolve({ width: 1200, height: 800 });
    img.src = src;
  });
}
