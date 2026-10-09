/**
 * 用户把本地图片拖到画布：落成可显示、可「+」引用的 ImageAsset。
 */

import { nanoid } from "nanoid";
import type { ImageAsset } from "./assets-schema";
import type { ProjectFile } from "./schema";
import { looksLikeGeneratedAssetId } from "./asset-title";

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i;

export function isCanvasImageFile(file: { type?: string; name?: string }): boolean {
  const type = file.type ?? "";
  if (type.startsWith("image/")) return true;
  return IMAGE_EXT.test(file.name ?? "");
}

export function titleFromUploadFileName(fileName: string): string {
  const stem =
    fileName
      .replace(/\\/g, "/")
      .split("/")
      .pop()
      ?.replace(IMAGE_EXT, "")
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() ?? "";
  const cleaned = stem || "上传图片";
  if (looksLikeGeneratedAssetId(cleaned)) return `${cleaned} 图`;
  return cleaned;
}

export function buildUploadedImageAsset(input: {
  id?: string;
  fileName: string;
  src: string;
  width: number;
  height: number;
  createdAt?: string;
}): ImageAsset {
  const title = titleFromUploadFileName(input.fileName);
  const createdAt = input.createdAt ?? new Date().toISOString();
  return {
    id: input.id ?? nanoid(10),
    title,
    prompt: `用户上传：${title}`,
    src: input.src,
    width: Math.max(1, input.width),
    height: Math.max(1, input.height),
    model: "upload",
    createdAt,
    status: "candidate",
    source: "uploaded",
  };
}

export function applyUploadedImageToProject(
  project: ProjectFile,
  asset: ImageAsset
): ProjectFile {
  const assets = project.assets ?? [];
  if (assets.some((item) => item.id === asset.id)) {
    return {
      ...project,
      assets: assets.map((item) => (item.id === asset.id ? asset : item)),
      updatedAt: asset.createdAt,
    };
  }
  return {
    ...project,
    assets: [...assets, asset],
    updatedAt: asset.createdAt,
  };
}
