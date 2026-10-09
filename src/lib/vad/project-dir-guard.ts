import { isAbsolute, relative, resolve } from "node:path";

export function isPathInsideRoot(absPath: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(absPath));
  return Boolean(rel) && !rel.startsWith("..") && !isAbsolute(rel);
}

export function canDuplicateProjectDirs(input: {
  src: string;
  dest: string;
  projectsRoot: string;
}): boolean {
  void input.src;
  return isPathInsideRoot(input.dest, input.projectsRoot);
}
