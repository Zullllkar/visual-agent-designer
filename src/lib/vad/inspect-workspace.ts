import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { createPlaceholderProject } from "@/lib/project/placeholder";
import type { ProjectFile } from "@/lib/project/schema";
import {
  validateWorkspacePath,
  workspaceFolderName,
  workspaceSidecarDir,
} from "@/lib/studio/workspace";
import { existsSync } from "node:fs";

export async function inspectWorkspaceFolder(input: {
  path: string;
  vadRoot: string;
  idea?: string;
  mkdirIfMissing?: boolean;
}): Promise<{ project: ProjectFile; created: boolean; workspacePath: string }> {
  const checked = validateWorkspacePath(input.path, {
    vadRoot: input.vadRoot,
    mustExist: false,
  });
  if (!checked.ok) throw new Error(checked.error);

  if (!existsSync(checked.path)) {
    if (!input.mkdirIfMissing) {
      throw new Error(`目录不存在：${checked.path}`);
    }
    await mkdir(checked.path, { recursive: true });
  }

  const sidecar = workspaceSidecarDir(checked.path);
  const jsonPath = join(sidecar, "project.json");
  try {
    const raw = JSON.parse(await readFile(jsonPath, "utf8")) as ProjectFile;
    if (raw?.id && raw.title) {
      return {
        project: { ...raw, workspacePath: checked.path },
        created: false,
        workspacePath: checked.path,
      };
    }
  } catch {
    /* empty folder or unreadable sidecar */
  }

  const folder = workspaceFolderName(checked.path);
  const idea = input.idea?.trim() || folder;
  const project = createPlaceholderProject(nanoid(10), idea, {
    workspacePath: checked.path,
  });
  return { project, created: true, workspacePath: checked.path };
}
