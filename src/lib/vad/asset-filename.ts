/**
 * 将资产 id 转成 Windows 可落盘的文件名。
 * pending:direct:... 这类逻辑 id 不能直接当路径。
 */

const UNSAFE = /[^a-zA-Z0-9._-]+/g;

export function toSafeAssetFileId(id: string): string {
  const cleaned = id
    .replace(UNSAFE, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  return cleaned || "asset";
}

export function imageExtFromMimeSubtype(subtype: string): string {
  const raw = subtype.toLowerCase();
  if (raw === "jpeg" || raw === "jpg") return "jpg";
  if (raw === "svg+xml") return "svg";
  return raw.replace(/[^a-z0-9]/g, "") || "png";
}

export function toSafeAssetFilename(id: string, ext: string): string {
  return `${toSafeAssetFileId(id)}.${imageExtFromMimeSubtype(ext)}`;
}
