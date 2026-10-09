/**
 * Agent 评估场景
 * --------------------------------------------------------------
 * 定义基本测试场景，用于评估 Agent 在不同任务中的表现。
 */

import "server-only";

import type { AgentPhase } from "@/lib/agents/agent-phase";

/** 评估场景 */
export interface EvalScenario {
  /** 场景 ID */
  id: string;
  /** 场景名称 */
  name: string;
  /** 场景描述 */
  description: string;
  /** 用户输入 */
  prompt: string;
  /** 期望的阶段流转 */
  expectedPhases: AgentPhase[];
  /** 期望调用的工具（按顺序） */
  expectedTools?: string[];
  /** 期望的最终状态 */
  expectedOutcome: "completed" | "waiting_for_user" | "failed";
  /** 期望生成的素材数量范围 */
  expectedAssetRange?: { min: number; max: number };
  /** 超时时间（毫秒） */
  timeoutMs?: number;
}

/** 评估结果 */
export interface EvalResult {
  scenarioId: string;
  passed: boolean;
  actualPhases: AgentPhase[];
  actualTools: string[];
  actualOutcome: string;
  durationMs: number;
  errors: string[];
  assetCount?: number;
}

/** 内置评估场景 */
export const evalScenarios: EvalScenario[] = [
  {
    id: "blank-to-images",
    name: "空白项目到素材生成",
    description: "从空白项目开始，Agent 应先提问收集需求，再生成 Brief 和素材",
    prompt: "帮我做一个产品落地页",
    expectedPhases: ["DISCOVERY", "DISCOVERY"],
    expectedTools: ["ask_discovery"],
    expectedOutcome: "waiting_for_user",
    timeoutMs: 30_000,
  },
  {
    id: "brief-to-direction",
    name: "已有 Brief 到方向规划",
    description: "项目已有 Brief，Agent 应规划设计方向并请求确认",
    prompt: "帮我规划视觉方向",
    expectedPhases: ["BRIEF", "DIRECTION"],
    expectedTools: ["plan_design_direction", "confirm_direction"],
    expectedOutcome: "waiting_for_user",
    timeoutMs: 60_000,
  },
  {
    id: "direction-to-generation",
    name: "方向确认后生成素材",
    description: "方向已确认，Agent 应生成视觉素材",
    prompt: "方向很好，开始生成素材吧",
    expectedPhases: ["DIRECTION", "GENERATION"],
    expectedTools: ["generate_images"],
    expectedOutcome: "completed",
    expectedAssetRange: { min: 2, max: 8 },
    timeoutMs: 120_000,
  },
  {
    id: "export-handoff",
    name: "导出交付包",
    description: "素材已生成，Agent 应导出 Handoff 包",
    prompt: "导出给 Cursor 用",
    expectedPhases: ["REVIEW", "HANDOFF"],
    expectedTools: ["export_handoff"],
    expectedOutcome: "completed",
    timeoutMs: 60_000,
  },
];

/** 运行单个评估场景 */
export async function runEvalScenario(
  scenario: EvalScenario,
  runFn: (prompt: string) => Promise<{
    phases: AgentPhase[];
    tools: string[];
    outcome: string;
    durationMs: number;
    assetCount?: number;
  }>
): Promise<EvalResult> {
  const errors: string[] = [];

  try {
    const result = await runFn(scenario.prompt);

    // 检查阶段流转
    for (const expectedPhase of scenario.expectedPhases) {
      if (!result.phases.includes(expectedPhase)) {
        errors.push(`缺少期望阶段: ${expectedPhase}`);
      }
    }

    // 检查工具调用
    if (scenario.expectedTools) {
      for (const expectedTool of scenario.expectedTools) {
        if (!result.tools.includes(expectedTool)) {
          errors.push(`缺少期望工具调用: ${expectedTool}`);
        }
      }
    }

    // 检查结果状态
    if (scenario.expectedOutcome === "completed" && result.outcome !== "completed") {
      errors.push(`期望完成，实际: ${result.outcome}`);
    }
    if (scenario.expectedOutcome === "waiting_for_user" && result.outcome !== "waiting_for_user") {
      errors.push(`期望等待用户，实际: ${result.outcome}`);
    }

    // 检查素材数量
    if (scenario.expectedAssetRange && result.assetCount !== undefined) {
      const { min, max } = scenario.expectedAssetRange;
      if (result.assetCount < min || result.assetCount > max) {
        errors.push(`素材数量 ${result.assetCount} 不在期望范围 [${min}, ${max}]`);
      }
    }

    return {
      scenarioId: scenario.id,
      passed: errors.length === 0,
      actualPhases: result.phases,
      actualTools: result.tools,
      actualOutcome: result.outcome,
      durationMs: result.durationMs,
      errors,
      assetCount: result.assetCount,
    };
  } catch (e) {
    return {
      scenarioId: scenario.id,
      passed: false,
      actualPhases: [],
      actualTools: [],
      actualOutcome: "failed",
      durationMs: 0,
      errors: [(e as Error).message],
    };
  }
}
