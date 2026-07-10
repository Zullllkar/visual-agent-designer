/**
 * Chat Diff 预览确认：按工具步聚合项目快照，确认后再写入 Store
 * --------------------------------------------------------------
 * @author：wangjunhua
 */

import type { ProjectFile } from "@/lib/project/schema";

/** 单步 diff 的用户决策 */
export type DiffDecision = "pending" | "accepted" | "rejected";

export interface DiffPreviewTurnState {
  /** 本轮发送消息前的项目基准 */
  turnBaseProject: ProjectFile | null;
  /** 各 tool_call 执行完成后的完整项目（来自 project_preview SSE） */
  projectAfterTool: Map<string, ProjectFile>;
  /** 出现预览的工具 id，按执行顺序 */
  toolOrder: string[];
  decisions: Map<string, DiffDecision>;
}

export function createDiffPreviewTurnState(
  base: ProjectFile | null
): DiffPreviewTurnState {
  return {
    turnBaseProject: base ? structuredClone(base) : null,
    projectAfterTool: new Map(),
    toolOrder: [],
    decisions: new Map(),
  };
}

/** 按顺序合并「已接受」的工具结果，得到当前应展示/落盘的项目 */
export function recomputeAppliedProject(
  state: DiffPreviewTurnState
): ProjectFile | null {
  if (!state.turnBaseProject) return null;
  let current = state.turnBaseProject;
  for (const id of state.toolOrder) {
    if (state.decisions.get(id) !== "accepted") continue;
    const next = state.projectAfterTool.get(id);
    if (next) current = next;
  }
  return current;
}

export function countPendingPreviewTools(state: DiffPreviewTurnState): number {
  let n = 0;
  for (const id of state.toolOrder) {
    if (!state.projectAfterTool.has(id)) continue;
    if ((state.decisions.get(id) ?? "pending") === "pending") n++;
  }
  return n;
}

export function hasPreviewTools(state: DiffPreviewTurnState): boolean {
  return state.toolOrder.length > 0;
}

export function registerProjectPreview(
  state: DiffPreviewTurnState,
  toolCallId: string,
  project: ProjectFile
): void {
  state.projectAfterTool.set(toolCallId, project);
  if (!state.toolOrder.includes(toolCallId)) {
    state.toolOrder.push(toolCallId);
  }
  if (!state.decisions.has(toolCallId)) {
    state.decisions.set(toolCallId, "pending");
  }
}
