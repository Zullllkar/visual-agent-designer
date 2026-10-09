import { nanoid } from "nanoid";

import type { ProjectFile } from "@/lib/project/schema";
import type { ToolContext } from "@/lib/agents/tools/types";

export function resolveAgentContextProjectId(
  project: { id?: string } | null | undefined,
  requestedProjectId?: string | null,
): string {
  const fromProject = project?.id?.trim();
  if (fromProject) return fromProject;
  const requested = requestedProjectId?.trim();
  if (requested) return requested;
  return nanoid(10);
}

export async function attachProjectToToolContext(
  ctx: ToolContext,
  loadProject?: (id: string) => Promise<ProjectFile | null>,
): Promise<ProjectFile | null> {
  if (ctx.project) return ctx.project;
  const id = ctx.agentCtx.projectId?.trim();
  if (!id) return null;
  const load =
    loadProject ??
    (await import("@/lib/vad/storage")).loadMergedProjectFromVad;
  const loaded = await load(id);
  if (loaded) {
    ctx.project = loaded;
    ctx.onProjectUpdate?.(loaded);
  }
  return ctx.project;
}
