/**
 * Agent 接口
 * --------------------------------------------------------------
 * 完整 Agent 列表（详见 PRODUCT_ARCHITECTURE_SPEC.md §6）：
 *   Brief / ProductArchitect / DesignDirector / Layout / Content
 *   Prompt / Image / VisionCritic / Layerization / Handoff
 */

import type { LlmProvider } from "@/lib/providers/llm/types";
import type { ImageProvider } from "@/lib/providers/image/types";
import type { Skill, DesignSystem } from "@/lib/skills/schema";
import type { BaseCheckpointSaver } from "@langchain/langgraph";

export interface AgentContext {
  /** 项目 id。 */
  projectId: string;
  /** 共享内存，agent 可读可写。 */
  scratch: Record<string, unknown>;
  /** 已解析的运行时 providers。 */
  providers: {
    llm: LlmProvider;
    image: ImageProvider;
    /** 是否启用 Vision Critic（rasterize → 喂给视觉模型）。 */
    visionCritic: boolean;
  };
  /**
   * 当前激活的文件化技能（SKILL.md）。
   * 由 orchestrator / chat session 在启动时 resolve 后注入。
   * 缺失时 agent 走"无 skill 默认行为"。
   */
  skill?: Skill | null;
  /**
   * 当前激活的设计系统（DESIGN.md）。
   */
  designSystem?: DesignSystem | null;
  /** LangGraph 会话线程 ID（用于 checkpoint 持久化）。 */
  threadId?: string;
  /** LangGraph checkpointer（SqliteSaver 单例）。 */
  checkpointer?: BaseCheckpointSaver;
  /** AbortSignal，用于取消 Agent 运行。 */
  abortSignal?: AbortSignal;
}

export interface Agent<TInput = unknown, TOutput = unknown> {
  name: string;
  run(input: TInput, ctx: AgentContext): Promise<TOutput>;
}
