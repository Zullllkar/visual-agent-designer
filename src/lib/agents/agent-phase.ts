/**
 * Agent 显式状态机
 * --------------------------------------------------------------
 * 定义 Agent 工作流的阶段（Phase），每个工具声明其
 * inputPhase / outputPhase，状态机据此推进。
 *
 * 阶段流转：
 *   DISCOVERY → BRIEF → DIRECTION → ASSET_PLAN → GENERATION → REVIEW → REFINEMENT → HANDOFF
 */

/** Agent 工作流阶段 */
export type AgentPhase =
  | "DISCOVERY"
  | "BRIEF"
  | "DIRECTION"
  | "ASSET_PLAN"
  | "GENERATION"
  | "REVIEW"
  | "REFINEMENT"
  | "HANDOFF"
  | "DONE";

/** 阶段之间的合法转移 */
const PHASE_TRANSITIONS: Record<AgentPhase, AgentPhase[]> = {
  DISCOVERY: ["DISCOVERY", "BRIEF"],
  BRIEF: ["BRIEF", "DIRECTION", "DISCOVERY"],
  DIRECTION: ["DIRECTION", "ASSET_PLAN", "REVIEW"],
  ASSET_PLAN: ["ASSET_PLAN", "GENERATION", "DIRECTION"],
  GENERATION: ["GENERATION", "REVIEW", "REFINEMENT"],
  REVIEW: ["REVIEW", "REFINEMENT", "HANDOFF", "GENERATION"],
  REFINEMENT: ["REFINEMENT", "REVIEW", "GENERATION", "HANDOFF"],
  HANDOFF: ["HANDOFF", "DONE"],
  DONE: ["DISCOVERY"],
};

/** 检查从 from 到 to 的转移是否合法 */
export function canTransition(from: AgentPhase, to: AgentPhase): boolean {
  return PHASE_TRANSITIONS[from]?.includes(to) ?? false;
}

/** 执行阶段转移，如果不合法则抛出错误 */
export function transitionPhase(
  from: AgentPhase,
  to: AgentPhase
): AgentPhase {
  if (!canTransition(from, to)) {
    throw new Error(
      `非法阶段转移: ${from} → ${to}。合法目标: ${PHASE_TRANSITIONS[from]?.join(", ") ?? "无"}`
    );
  }
  return to;
}

/** 获取阶段的人类可读名称 */
export function phaseLabel(phase: AgentPhase): string {
  const labels: Record<AgentPhase, string> = {
    DISCOVERY: "需求发现",
    BRIEF: "简报生成",
    DIRECTION: "方向规划",
    ASSET_PLAN: "素材规划",
    GENERATION: "素材生成",
    REVIEW: "质量评审",
    REFINEMENT: "迭代优化",
    HANDOFF: "交付导出",
    DONE: "完成",
  };
  return labels[phase];
}

/**
 * 根据工具的 outputPhase 和当前阶段计算下一个阶段。
 * 如果工具没有声明 outputPhase，则保持当前阶段不变。
 */
export function resolveNextPhase(
  currentPhase: AgentPhase,
  toolOutputPhase?: AgentPhase
): AgentPhase {
  if (!toolOutputPhase) return currentPhase;
  if (toolOutputPhase === currentPhase) return currentPhase;
  if (canTransition(currentPhase, toolOutputPhase)) return toolOutputPhase;
  // 如果不合法但目标是 DONE，允许跳跃到 DONE
  if (toolOutputPhase === "DONE") return "DONE";
  return currentPhase;
}

/** 根据当前项目数据推导 Agent 初始阶段 */
export function inferInitialPhase(project: {
  brief?: unknown;
  designDirection?: unknown;
  assets?: unknown[];
  pages?: unknown[];
} | null): AgentPhase {
  if (!project?.brief) return "DISCOVERY";
  if (!project.designDirection) return "BRIEF";
  if ((project.assets?.length ?? 0) > 0 || (project.pages?.length ?? 0) > 0) {
    return "GENERATION";
  }
  return "DIRECTION";
}
