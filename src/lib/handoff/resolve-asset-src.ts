/**
 * 将 asset.src（data URL / 本地 API 路径 / http）解析为 Vision/生图可用的 data URL。
 * 优先读 .vad 磁盘，避免 cloud LLM 无法访问 localhost。
 */

import "server-only";

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { projectDir } from "@/lib/vad/paths";

const API_ASSET_RE =
  /^\/api\/assets\/([^/]+)\/(assets|references)\/([^/?#]+)$/;

export async function resolveAssetImageDataUrl(
  src: string,
  projectId?: string
): Promise<string | null> {
  if (!src) return null;
  if (src.startsWith("data:image/")) return src;

  const apiMatch = src.match(API_ASSET_RE);
  if (apiMatch) {
    const [, pid, subFolder, filename] = apiMatch;
    const fromDisk = await readProjectImageFile(pid, subFolder, filename);
    if (fromDisk) return fromDisk;
  }

  if (projectId && src.startsWith("/")) {
    const rel = src.replace(/^\//, "");
    const parts = rel.split("/");
    if (parts[0] === "api" && parts[1] === "assets" && parts.length >= 5) {
      const fromDisk = await readProjectImageFile(
        parts[2],
        parts[3] as "assets" | "references",
        parts[4]
      );
      if (fromDisk) return fromDisk;
    }
  }

  if (/^https?:\/\//i.test(src)) {
    return fetchUrlAsDataUrl(src);
  }

  if (src.startsWith("/")) {
    return fetchUrlAsDataUrl(
      `http://127.0.0.1:${process.env.PORT || 3000}${src}`
    );
  }

  return null;
}

async function readProjectImageFile(
  projectId: string,
  subFolder: "assets" | "references",
  filename: string
): Promise<string | null> {
  if (subFolder !== "assets" && subFolder !== "references") return null;
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "");
  if (!safeName) return null;
  try {
    const filePath = join(projectDir(projectId), subFolder, safeName);
    const buf = await fs.readFile(filePath);
    const mime = contentTypeFor(safeName);
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

async function fetchUrlAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const mime = res.headers.get("content-type")?.split(";")[0] || "image/png";
    if (!mime.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function contentTypeFor(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/png";
}
