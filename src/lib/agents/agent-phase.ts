/**
 * Agent 显式状态机
 * --------------------------------------------------------------
 * 定义 Agent 工作流的阶段（Phase），每个工具声明其
 * inputPhase / outputPhase，状态机据此推进。
 *
 * 阶段流转：
 *   INIT → DISCOVERY → BRIEF → DIRECTION → GENERATION → REVIEW → EXPORT → DONE
 */

/** Agent 工作流阶段 */
export type AgentPhase =
  | "INIT"          // 初始状态，等待用户输入
  | "DISCOVERY"     // 发现阶段，向用户提问
  | "BRIEF"         // 生成产品简报
  | "DIRECTION"     // 规划设计方向
  | "GENERATION"    // 生成视觉素材
  | "REVIEW"        // 审查和调整
  | "EXPORT"        // 导出交付物
  | "DONE";         // 完成

/** 阶段之间的合法转移 */
const PHASE_TRANSITIONS: Record<AgentPhase, AgentPhase[]> = {
  INIT: ["DISCOVERY", "BRIEF", "GENERATION", "REVIEW", "EXPORT"],
  DISCOVERY: ["BRIEF", "DISCOVERY"],
  BRIEF: ["DIRECTION", "GENERATION", "REVIEW"],
  DIRECTION: ["GENERATION", "REVIEW", "DIRECTION"],
  GENERATION: ["REVIEW", "GENERATION", "EXPORT"],
  REVIEW: ["GENERATION", "EXPORT", "REVIEW"],
  EXPORT: ["DONE", "EXPORT"],
  DONE: ["INIT"],
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
    INIT: "初始化",
    DISCOVERY: "需求发现",
    BRIEF: "简报生成",
    DIRECTION: "方向规划",
    GENERATION: "素材生成",
    REVIEW: "审查调整",
    EXPORT: "导出交付",
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
  if (!project?.brief) return "INIT";
  if (!project.designDirection) return "BRIEF";
  if ((project.assets?.length ?? 0) > 0 || (project.pages?.length ?? 0) > 0) {
    return "GENERATION";
  }
  return "DIRECTION";
}
