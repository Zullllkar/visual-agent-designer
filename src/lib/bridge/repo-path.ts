/**
 * 关联仓库路径校验
 * --------------------------------------------------------------
 * 必须是本机已存在的绝对目录，不能指到 Vibeboard 自己的数据根，
 * 也不能指到系统目录。mountDir 必须是相对、无 `..`。
 */

import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, relative, resolve } from "node:path";
import { VAD_CHECKPOINTS_DIR, VAD_ROOT } from "@/lib/vad/paths";

export const DEFAULT_MOUNT_DIR = "design/vibeboard";
export const MOUNT_DIR_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

export type RepoPathOk = { ok: true; path: string; git: boolean; mountDir: string };
export type RepoPathErr = { ok: false; error: string };
export type RepoPathResult = RepoPathOk | RepoPathErr;

const WINDOWS_FORBIDDEN = [
  "C:\\Windows",
  "C:\\Program Files",
  "C:\\Program Files (x86)",
  "C:\\ProgramData",
];

const POSIX_FORBIDDEN = ["/etc", "/usr", "/bin", "/sbin", "/System", "/Library", "/dev", "/proc", "/sys"];

export function normalizeMountDir(raw: string | undefined): RepoPathResult {
  const original = (raw ?? "").trim();
  if (original.startsWith("/") || original.startsWith("\\") || /^[A-Za-z]:/.test(original)) {
    return {
      ok: false,
      error: `mountDir must be a relative path of simple segments (got "${raw ?? ""}"). Example: design/vibeboard`,
    };
  }
  const value = (original || DEFAULT_MOUNT_DIR).replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!value || value.includes("..") || !MOUNT_DIR_RE.test(value)) {
    return {
      ok: false,
      error: `mountDir must be a relative path of simple segments (got "${raw ?? ""}"). Example: design/vibeboard`,
    };
  }
  return { ok: true, path: "", git: false, mountDir: value };
}

export function validateRepoPath(
  raw: string,
  opts: { mountDir?: string; vadRoot?: string; checkpointsDir?: string; platform?: NodeJS.Platform } = {}
): RepoPathResult {
  const mount = normalizeMountDir(opts.mountDir);
  if (!mount.ok) return mount;

  const input = raw.trim();
  if (!input) return { ok: false, error: "Repository path is empty." };
  if (!isAbsolute(input)) {
    return { ok: false, error: "Repository path must be absolute." };
  }

  const abs = resolve(normalize(input));
  const vadRoot = resolve(opts.vadRoot ?? VAD_ROOT);
  const checkpoints = resolve(opts.checkpointsDir ?? VAD_CHECKPOINTS_DIR);
  if (isInside(abs, vadRoot) || isInside(abs, checkpoints)) {
    return { ok: false, error: "Cannot link a folder inside Vibeboard's own data directory." };
  }

  const platform = opts.platform ?? process.platform;
  for (const forbidden of forbiddenRoots(platform)) {
    if (isInside(abs, forbidden)) {
      return { ok: false, error: `Refusing to write into system directory: ${forbidden}` };
    }
  }

  try {
    const st = statSync(abs);
    if (!st.isDirectory()) return { ok: false, error: "Path exists but is not a directory." };
  } catch {
    return { ok: false, error: `Directory does not exist: ${abs}` };
  }

  const git = existsSync(join(abs, ".git"));
  return { ok: true, path: abs, git, mountDir: mount.mountDir };
}

export function mountAbsolute(repoPath: string, mountDir: string): string {
  return join(resolve(repoPath), ...mountDir.split("/"));
}

function forbiddenRoots(platform: NodeJS.Platform): string[] {
  if (platform === "win32") return WINDOWS_FORBIDDEN.map((p) => resolve(p));
  return POSIX_FORBIDDEN;
}

function isInside(candidate: string, root: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
