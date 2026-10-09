/**
 * 先把 generating 占位写入磁盘，再 submit Job。
 * 否则 job.queued 会触发客户端 reloadFromDisk，空盘把占位图冲掉。
 */

import type { AgentContext } from "@/lib/agents/types";
import type { ProjectFile } from "@/lib/project/schema";

export async function persistThenSubmitJob<T>(
  persist: () => Promise<void>,
  submit: () => T
): Promise<T> {
  await persist();
  return submit();
}

/** 占位图先入 scratch / 画布事件 / 磁盘，Job 才能安全排队 */
export async function publishGeneratingPlaceholders(
  ctx: {
    agentCtx: AgentContext;
    onProjectUpdate?: (project: ProjectFile) => void;
  },
  project: ProjectFile
): Promise<void> {
  ctx.agentCtx.scratch.__updatedProject = project;
  ctx.onProjectUpdate?.(project);
  try {
    const { saveProjectToVad } = await import("@/lib/vad/storage");
    await saveProjectToVad(project);
  } catch (err) {
    console.warn("[vad] persist generating placeholders failed", err);
  }
}
