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

export function toSafeAssetFilename(id: string, ext: string, title?: string): string {
  const idPart = toSafeAssetFileId(id);
  const extPart = imageExtFromMimeSubtype(ext);
  const slug = slugAsciiTitle(title);
  if (!slug) return `${idPart}.${extPart}`;
  const tail = idPart.slice(-10);
  return `${slug}-${tail}.${extPart}`;
}

function slugAsciiTitle(title?: string): string {
  if (!title) return "";
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .toLowerCase();
}
