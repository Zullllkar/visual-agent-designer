/** Browser-safe workspace path helpers (no node:path). */

export const WORKSPACE_SIDECAR = ".vibeboard";

export function workspaceFolderName(workspacePath: string): string {
  const trimmed = workspacePath.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || "项目";
}
