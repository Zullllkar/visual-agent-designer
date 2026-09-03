/**
 * 实现截图入参解析
 * --------------------------------------------------------------
 * coding agent 可以传 base64 或本地文件路径。路径只允许落在关联仓库
 * 或系统临时目录内，避免变成任意文件读取。
 */

import "server-only";

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { extname, isAbsolute, relative, resolve } from "node:path";
import type { ProjectFile } from "@/lib/project/schema";

const MAX_BYTES = 12 * 1024 * 1024;
/** 低于此值不可能是一张真实截图，多半是截断的 base64。 */
const MIN_BYTES = 64;

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export type ScreenshotResult =
  | { ok: true; dataUrl: string; from: "base64" | "path"; bytes: number }
  | { ok: false; error: string };

export async function readScreenshotInput(
  project: ProjectFile,
  input: { screenshotBase64?: string; screenshotPath?: string }
): Promise<ScreenshotResult> {
  const base64 = input.screenshotBase64?.trim();
  if (base64) {
    const parsed = parseInlineImage(base64);
    if (!parsed) {
      return { ok: false, error: "screenshotBase64 must be raw base64 or a data:image/...;base64,... URL." };
    }
    if (parsed.bytes < MIN_BYTES) {
      return {
        ok: false,
        error: `screenshotBase64 decodes to only ${parsed.bytes} bytes — the payload looks truncated. Send the whole PNG/JPEG.`,
      };
    }
    if (parsed.bytes > MAX_BYTES) {
      return { ok: false, error: `Screenshot is ${Math.round(parsed.bytes / 1024 / 1024)}MB; keep it under 12MB.` };
    }
    return { ok: true, dataUrl: parsed.dataUrl, from: "base64", bytes: parsed.bytes };
  }

  const path = input.screenshotPath?.trim();
  if (!path) {
    return { ok: false, error: "Provide either screenshotBase64 or screenshotPath." };
  }
  if (!isAbsolute(path)) {
    return { ok: false, error: "screenshotPath must be an absolute path." };
  }
  const abs = resolve(path);
  const allowed = allowedRoots(project);
  if (!allowed.some((root) => isInside(abs, root))) {
    return {
      ok: false,
      error:
        "screenshotPath must live inside the linked repository or the system temp dir. " +
        "Pass screenshotBase64 instead, or link the repo in Vibeboard first.",
    };
  }
  const mime = MIME_BY_EXT[extname(abs).toLowerCase()];
  if (!mime) {
    return { ok: false, error: "Screenshot must be a .png, .jpg, .webp or .gif file." };
  }
  try {
    const stat = await fs.stat(abs);
    if (!stat.isFile()) return { ok: false, error: "screenshotPath is not a file." };
    if (stat.size > MAX_BYTES) {
      return { ok: false, error: `Screenshot is ${Math.round(stat.size / 1024 / 1024)}MB; keep it under 12MB.` };
    }
    const buf = await fs.readFile(abs);
    return {
      ok: true,
      dataUrl: `data:${mime};base64,${buf.toString("base64")}`,
      from: "path",
      bytes: buf.byteLength,
    };
  } catch (err) {
    return { ok: false, error: `Could not read screenshotPath: ${(err as Error).message}` };
  }
}

function parseInlineImage(value: string): { dataUrl: string; bytes: number } | null {
  const dataMatch = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  const payload = (dataMatch ? dataMatch[2] : value).replace(/\s+/g, "");
  if (!payload || !/^[A-Za-z0-9+/=]+$/.test(payload)) return null;
  const bytes = Math.floor((payload.length * 3) / 4);
  const mime = dataMatch ? dataMatch[1] : sniffMime(payload);
  return { dataUrl: `data:${mime};base64,${payload}`, bytes };
}

function sniffMime(base64: string): string {
  if (base64.startsWith("iVBORw0KGgo")) return "image/png";
  if (base64.startsWith("/9j/")) return "image/jpeg";
  if (base64.startsWith("UklGR")) return "image/webp";
  if (base64.startsWith("R0lGOD")) return "image/gif";
  return "image/png";
}

function allowedRoots(project: ProjectFile): string[] {
  const roots = [resolve(tmpdir())];
  if (project.linkedRepo?.path) roots.push(resolve(project.linkedRepo.path));
  return roots;
}

function isInside(candidate: string, root: string): boolean {
  const rel = relative(root, candidate);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}
