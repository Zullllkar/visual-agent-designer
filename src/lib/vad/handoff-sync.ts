/**
 * Handoff 目录同步
 * --------------------------------------------------------------
 * 项目保存时自动编译 handoff 包到 .vad/projects/<id>/handoff/
 *
 * @author：wangjunhua
 */

import { promises as fs } from "node:fs";
import { join, dirname } from "node:path";
import type { ProjectFile } from "@/lib/project/schema";
import { createHandoffTarget } from "@/lib/handoff/markdown-target";
import { projectDir } from "./paths";
import { ensureDir } from "./persist";

export async function syncHandoffBundle(project: ProjectFile): Promise<void> {
  const archHandoffDir = join(projectDir(project.id), "handoff");
  await ensureDir(archHandoffDir);

  const targets: Array<"cursor" | "claude-code" | "codex" | "markdown"> = [
    "cursor",
    "claude-code",
    "codex",
    "markdown",
  ];

  const allFiles = new Map<string, string | Uint8Array>();

  for (const targetName of targets) {
    const target = createHandoffTarget(targetName);
    const artifact = await target.build({
      project,
      screenshots: [],
      aiReferenceImages: [],
    });
    for (const file of artifact.files) {
      allFiles.set(file.path, file.content);
    }
  }

  for (const [relPath, content] of allFiles.entries()) {
    const full = join(archHandoffDir, relPath);
    await ensureDir(dirname(full));
    if (typeof content === "string") {
      await fs.writeFile(full, content, "utf8");
    } else {
      await fs.writeFile(full, Buffer.from(content));
    }
  }
}
