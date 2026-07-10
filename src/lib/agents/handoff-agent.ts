/**
 * Handoff Agent
 * --------------------------------------------------------------
 * 将当前项目编译为 coding agent 可用的 Handoff 包（内存 artifact），
 * 供 UI 下载或 Chat 工具返回摘要。
 *
 * @author：wangjunhua
 */

import type { Agent } from "./types";
import type { ProjectFile } from "@/lib/project/schema";
import type { HandoffTarget } from "@/lib/handoff/types";
import type { HandoffArtifact } from "@/lib/handoff/types";
import { createHandoffTarget } from "@/lib/handoff/markdown-target";

export interface HandoffAgentResult {
  target: HandoffTarget["name"];
  fileCount: number;
  paths: string[];
  artifact: HandoffArtifact;
}

export const HandoffAgent: Agent<
  { project: ProjectFile; target?: HandoffTarget["name"] },
  HandoffAgentResult
> = {
  name: "handoff-agent",
  async run({ project, target = "markdown" }, ctx) {
    const resolvedTarget = pickTarget(target, project);
    const handoffTarget = createHandoffTarget(resolvedTarget);
    const artifact = await handoffTarget.build({
      project,
      screenshots: [],
      aiReferenceImages: (project.assets ?? []).map((a) => ({
        name: a.id,
        path: `design/assets/${a.id}.png`,
        prompt: a.prompt,
      })),
    });

    ctx.scratch.lastHandoff = {
      target: resolvedTarget,
      fileCount: artifact.files.length,
      generatedAt: new Date().toISOString(),
    };

    return {
      target: resolvedTarget,
      fileCount: artifact.files.length,
      paths: artifact.files.map((f) => f.path),
      artifact,
    };
  },
};

function pickTarget(
  explicit: HandoffTarget["name"],
  project: ProjectFile
): HandoffTarget["name"] {
  const targets = project.brief?.outputTargets ?? [];
  if (explicit !== "markdown") return explicit;
  if (targets.includes("cursor")) return "cursor";
  if (targets.includes("claude-code")) return "claude-code";
  if (targets.includes("codex")) return "codex";
  return "markdown";
}
