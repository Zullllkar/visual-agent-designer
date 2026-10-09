/**
 * Agent 工具接口
 * --------------------------------------------------------------
 * 所有工具统一实现此接口，通过 ToolRegistry 注册和调度。
 * 替代 chat-orchestrator.ts 中的 switch-case 分发。
 */

import type { ProjectFile } from "@/lib/project/schema";
import type { AgentContext } from "@/lib/agents/types";
import type { ProviderConfig } from "@/lib/providers/registry";
import type { CodeDiffEventData, ToolArtifact } from "@/lib/agents/chat-schema";
import type { AgentPhase } from "@/lib/agents/agent-phase";

export interface ToolContext {
  project: ProjectFile | null;
  userMessage: string;
  agentCtx: AgentContext;
  providerConfig?: ProviderConfig;
  onProjectUpdate?: (project: ProjectFile) => void;
  onAssetReady?: (asset: { id: string; src: string }) => void;
  abortSignal?: AbortSignal;
  /** 当前 Agent Run ID，用于关联 Job */
  runId?: string;
  /** Current tool call id, used to attach background jobs to a tool step. */
  toolCallId?: string;
}

export interface ToolResult {
  summary: string;
  updatedProject?: ProjectFile | null;
  data?: unknown;
  fileWrites?: string[];
  codeDiffs?: CodeDiffEventData[];
  artifacts?: ToolArtifact[];
}

/** 工具风险等级 */
export type RiskLevel = "safe" | "moderate" | "destructive" | "external";
export type ConfirmationPolicy = "auto" | "session" | "always";

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
  fallback?(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;

  // ── P1: 状态机 ──
  /** 此工具允许在哪些阶段被调用 */
  inputPhase?: AgentPhase[];
  /** 工具执行成功后，Agent 应进入哪个阶段 */
  outputPhase?: AgentPhase;

  // ── P1: 幂等与权限 ──
  /** 风险等级，destructive 需要用户确认 */
  riskLevel?: RiskLevel;
  /** 是否需要用户确认后才能执行 */
  requiresConfirmation?: boolean;
  /** 幂等键生成函数，返回相同键表示重复调用 */
  idempotencyKey?: (args: Record<string, unknown>) => string;
  /** 执行超时（毫秒），超时后自动取消 */
  timeoutMs?: number;
  /** Optional canonical UI contract overrides for legacy tools. */
  displayLabel?: string;
  confirmationPolicy?: ConfirmationPolicy;
}
