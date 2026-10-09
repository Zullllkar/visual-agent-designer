/**
 * 用户工作区目录：创作落在本机所选文件夹，而不是应用 .vad/projects。
 */

import { isAbsolute, normalize, relative, resolve } from "node:path";
import { WORKSPACE_SIDECAR } from "./workspace-name";

export { WORKSPACE_SIDECAR, workspaceFolderName } from "./workspace-name";

export type WorkspacePathOk = { ok: true; path: string };
export type WorkspacePathErr = { ok: false; error: string };
export type WorkspacePathResult = WorkspacePathOk | WorkspacePathErr;

export function workspaceSidecarDir(workspacePath: string): string {
  return resolve(workspacePath, WORKSPACE_SIDECAR);
}

export function isInternalAppDataPath(
  candidate: string,
  vadRoot: string,
): boolean {
  const abs = resolve(normalize(candidate));
  const root = resolve(normalize(vadRoot));
  const rel = relative(root, abs);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function validateWorkspacePath(
  raw: string,
  opts: { vadRoot: string; mustExist?: boolean },
): WorkspacePathResult {
  const input = raw.trim();
  if (!input) return { ok: false, error: "工作区路径为空。" };
  if (!isAbsolute(input) && !/^[A-Za-z]:[\\/]/.test(input)) {
    return { ok: false, error: "请选择本机绝对目录。" };
  }
  const abs = resolve(normalize(input));
  if (isInternalAppDataPath(abs, opts.vadRoot)) {
    return { ok: false, error: "不能把创作写进应用自己的数据目录。" };
  }
  return { ok: true, path: abs };
}
