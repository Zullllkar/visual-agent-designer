/**
 * Agent Coordinator - 专业化 Agent 协调器
 * --------------------------------------------------------------
 * 职责：
 * 1. 管理多个专业化 agents 的协作
 * 2. 编排工作流（串行 + 并行）
 * 3. 处理 agents 之间的数据传递
 * 4. 提供统一的执行接口
 *
 * 核心价值：
 * - 让每个 agent 专注于自己的领域
 * - 通过协调实现复杂的设计流程
 * - 最大化并行执行以提升性能
 */

import { ArchitectAgent, type ArchitectureSpec } from "./architect-agent";
import { DesignerAgent, type DesignDirection } from "./designer-agent";
import { ImageExecutorAgent, type ImageSpec, type GeneratedImages } from "./image-executor-agent";
import type { ToolContext } from "../tools/types";
import { runSpecializedStage, specializedCheckpointStore, type SpecializedCheckpointStore, type SpecializedStageCheckpoint } from "./checkpoint-retry";

/**
 * 工作流类型
 */
export type WorkflowType =
  | "complete"          // 完整设计流程
  | "architecture-only" // 仅结构规划
  | "design-only"       // 仅视觉方向
  | "images-only"       // 仅图像生成
  | "quick-prototype";  // 快速原型

/**
 * 协调器输入
 */
export interface CoordinatorInput {
  userInput: string;
  workflowType: WorkflowType;
  onProgress?: (event: { stage: string; status: "started" | "completed" | "failed"; at: number }) => void;
  options?: {
    skipImages?: boolean;
    maxImages?: number;
    style?: "minimal" | "bold" | "corporate";
    brandKit?: {
      primaryColor?: string;
      fonts?: string[];
    };
    /** Resume completed specialized stages from checkpoints after a restart. */
    checkpointId?: string;
    resumeFromCheckpoint?: boolean;
    maxRetries?: number;
  };
}

/**
 * 协调器输出
 */
export interface CoordinatorOutput {
  architectureSpec?: ArchitectureSpec;
  designDirection?: DesignDirection;
  generatedImages?: GeneratedImages;
  metadata: {
    workflowType: WorkflowType;
    totalDuration: number;
    agentExecutions: Array<{
      agentName: string;
      duration: number;
      success: boolean;
    }>;
    estimatedCostUsd?: number;
    progressEvents?: Array<{ stage: string; status: "started" | "completed" | "failed"; at: number }>;
    checkpoints?: Array<Pick<SpecializedStageCheckpoint, "stage" | "status" | "attempt" | "updatedAt">>;
  };
}

/**
 * Agent Coordinator 实现
 */
export class AgentCoordinator {
  private architectAgent: ArchitectAgent;
  private designerAgent: DesignerAgent;
  private imageExecutorAgent: ImageExecutorAgent;
  private checkpointStore: SpecializedCheckpointStore;

  constructor(apiKey: string, checkpointStore: SpecializedCheckpointStore = specializedCheckpointStore) {
    this.architectAgent = new ArchitectAgent();
    this.designerAgent = new DesignerAgent();
    this.imageExecutorAgent = new ImageExecutorAgent();
    this.checkpointStore = checkpointStore;
  }

  /**
   * 设置工具上下文（必须在执行前调用）
   */
  setToolContext(context: ToolContext): void {
    this.architectAgent.setToolContext(context);
    this.designerAgent.setToolContext(context);
    this.imageExecutorAgent.setToolContext(context);
  }

  /**
   * 执行工作流
   */
  async execute(input: CoordinatorInput): Promise<CoordinatorOutput> {
    console.log(`[AgentCoordinator] 开始执行工作流: ${input.workflowType}`);
    const startTime = Date.now();
    const agentExecutions: CoordinatorOutput["metadata"]["agentExecutions"] = [];
    const progressEvents: NonNullable<CoordinatorOutput["metadata"]["progressEvents"]> = [];
    const emit = (stage: string, status: "started" | "completed" | "failed") => {
      const event = { stage, status, at: Date.now() } as const;
      progressEvents.push(event);
      input.onProgress?.(event);
    };
    input.onProgress?.({ stage: input.workflowType, status: "started", at: Date.now() });

    try {
      switch (input.workflowType) {
        case "complete":
          return this.withMetadata(await this.completeDesignWorkflow(input, agentExecutions), progressEvents, emit);

        case "architecture-only":
          return this.withMetadata(await this.architectureOnlyWorkflow(input, agentExecutions), progressEvents, emit);

        case "design-only":
          return this.withMetadata(await this.designOnlyWorkflow(input, agentExecutions), progressEvents, emit);

        case "images-only":
          return this.withMetadata(await this.imagesOnlyWorkflow(input, agentExecutions), progressEvents, emit);

        case "quick-prototype":
          return this.withMetadata(await this.quickPrototypeWorkflow(input, agentExecutions), progressEvents, emit);

        default:
          throw new Error(`Unknown workflow type: ${input.workflowType}`);
      }
    } finally {
      const totalDuration = Date.now() - startTime;
      console.log(`[AgentCoordinator] 工作流完成: ${totalDuration}ms`);
    }
  }

  private withMetadata(output: CoordinatorOutput, progressEvents: NonNullable<CoordinatorOutput["metadata"]["progressEvents"]>, emit: (stage: string, status: "started" | "completed" | "failed") => void): CoordinatorOutput {
    emit(output.metadata.workflowType, "completed");
    const estimatedCostUsd = output.metadata.agentExecutions.reduce((sum, execution) => sum + (execution.agentName.includes("Image") ? 0.04 : 0.005), 0);
    return { ...output, metadata: { ...output.metadata, estimatedCostUsd, progressEvents } };
  }

  private workflowId(input: CoordinatorInput): string {
    return input.options?.checkpointId ?? `${input.workflowType}:${input.userInput.trim().slice(0, 120)}`;
  }

  private async stage<T>(input: CoordinatorInput, stage: string, fn: () => Promise<T>, executions: CoordinatorOutput["metadata"]["agentExecutions"], agentName: string): Promise<T> {
    const startedAt = Date.now();
    const result = await runSpecializedStage(fn, {
      workflowId: this.workflowId(input),
      stage,
      resume: input.options?.resumeFromCheckpoint === true,
      maxRetries: input.options?.maxRetries ?? 2,
      store: this.checkpointStore,
      onCheckpoint: (checkpoint) => input.onProgress?.({ stage: `${stage}:${checkpoint.status}`, status: checkpoint.status === "failed" ? "failed" : checkpoint.status === "completed" ? "completed" : "started", at: checkpoint.updatedAt }),
    });
    executions.push({ agentName, duration: Date.now() - startedAt, success: result.checkpoint.status === "completed" });
    return result.output;
  }

  /**
   * 工作流 1: 完整设计流程
   *
   * Phase 1 (串行): Architect → Designer
   * Phase 2 (并行): 基于结果生成图像
   */
  private async completeDesignWorkflow(
    input: CoordinatorInput,
    executions: CoordinatorOutput["metadata"]["agentExecutions"]
  ): Promise<CoordinatorOutput> {
    console.log("[AgentCoordinator] 执行完整设计工作流");

    // Phase 1: 结构规划
    const architectureSpec = await this.stage(input, "architect", async () => {
      const result = await this.architectAgent.execute({ userBrief: input.userInput });
      if (!result.success || !result.data) throw new Error(`Architecture planning failed: ${result.error}`);
      return result.data;
    }, executions, "ArchitectAgent");

    // Phase 2: 视觉方向（依赖 Phase 1）
    const designDirection = await this.stage(input, "designer", async () => {
      const result = await this.designerAgent.execute({ architectureSpec, userPreferences: input.options?.style ? { style: input.options.style } : undefined, brandKit: input.options?.brandKit });
      if (!result.success || !result.data) throw new Error(`Design direction failed: ${result.error}`);
      return result.data;
    }, executions, "DesignerAgent");

    // Phase 3: 图像生成（可选）
    let generatedImages: GeneratedImages | undefined;

    if (!input.options?.skipImages) {
      const imageSpecs = this.generateImageSpecs(
        architectureSpec,
        designDirection,
        input.options?.maxImages
      );

      generatedImages = await this.stage(input, "image-executor", async () => {
        const result = await this.imageExecutorAgent.execute({ images: imageSpecs, designDirection, architectureSpec });
        if (!result.success || !result.data) throw new Error(`Image execution failed: ${result.error}`);
        return result.data;
      }, executions, "ImageExecutorAgent");
    }

    return {
      architectureSpec,
      designDirection,
      generatedImages,
      metadata: {
        workflowType: "complete",
        totalDuration: executions.reduce((sum, e) => sum + e.duration, 0),
        agentExecutions: executions,
        checkpoints: this.checkpointStore.list(this.workflowId(input)).map((checkpoint) => ({ stage: checkpoint.stage, status: checkpoint.status, attempt: checkpoint.attempt, updatedAt: checkpoint.updatedAt })),
      },
    };
  }

  /**
   * 工作流 2: 仅结构规划
   */
  private async architectureOnlyWorkflow(
    input: CoordinatorInput,
    executions: CoordinatorOutput["metadata"]["agentExecutions"]
  ): Promise<CoordinatorOutput> {
    console.log("[AgentCoordinator] 执行结构规划工作流");

    const architecture = await this.stage(input, "architect", async () => {
      const result = await this.architectAgent.execute({ userBrief: input.userInput });
      if (!result.success || !result.data) throw new Error(`Architecture planning failed: ${result.error}`);
      return result.data;
    }, executions, "ArchitectAgent");

    return {
      architectureSpec: architecture,
      metadata: {
        workflowType: "architecture-only",
        totalDuration: executions.reduce((sum, item) => sum + item.duration, 0),
        agentExecutions: executions,
      },
    };
  }

  /**
   * 工作流 3: 仅视觉方向
   */
  private async designOnlyWorkflow(
    input: CoordinatorInput,
    executions: CoordinatorOutput["metadata"]["agentExecutions"]
  ): Promise<CoordinatorOutput> {
    console.log("[AgentCoordinator] 执行视觉方向工作流");

    // 先快速生成架构（作为视觉方向的输入）
    const architecture = await this.stage(input, "architect-quick", async () => {
      const result = await this.architectAgent.quickPlan(input.userInput);
      if (!result.success || !result.data) throw new Error("Quick architecture planning failed");
      return result.data;
    }, executions, "ArchitectAgent (quick)");

    // 生成视觉方向
    const designDirection = await this.stage(input, "designer", async () => {
      const result = await this.designerAgent.execute({ architectureSpec: architecture, userPreferences: input.options?.style ? { style: input.options.style } : undefined, brandKit: input.options?.brandKit });
      if (!result.success || !result.data) throw new Error(`Design direction failed: ${result.error}`);
      return result.data;
    }, executions, "DesignerAgent");

    return {
      architectureSpec: architecture,
      designDirection,
      metadata: {
        workflowType: "design-only",
        totalDuration: executions.reduce((sum, item) => sum + item.duration, 0),
        agentExecutions: executions,
      },
    };
  }

  /**
   * 工作流 4: 仅图像生成
   */
  private async imagesOnlyWorkflow(
    input: CoordinatorInput,
    executions: CoordinatorOutput["metadata"]["agentExecutions"]
  ): Promise<CoordinatorOutput> {
    console.log("[AgentCoordinator] 执行图像生成工作流");

    // 使用快速预设生成设计方向
    const designDirection = await this.stage(input, "designer-quick", async () => {
      const result = await this.designerAgent.quickDirection(input.options?.style || "minimal");
      if (!result.success || !result.data) throw new Error("Quick design direction failed");
      return result.data;
    }, executions, "DesignerAgent (quick)");

    // 从用户输入解析图像 prompts（简单分割）
    const prompts = input.userInput
      .split("\n")
      .filter(line => line.trim().length > 0)
      .slice(0, input.options?.maxImages || 5);

    const generatedImages = await this.stage(input, "image-executor", async () => {
      const result = await this.imageExecutorAgent.generateBatch(prompts, designDirection);
      if (!result.success || !result.data) throw new Error(`Image generation failed: ${result.error}`);
      return result.data;
    }, executions, "ImageExecutorAgent");

    return {
      designDirection,
      generatedImages,
      metadata: {
        workflowType: "images-only",
        totalDuration: executions.reduce((sum, item) => sum + item.duration, 0),
        agentExecutions: executions,
      },
    };
  }

  /**
   * 工作流 5: 快速原型（并行执行）
   */
  private async quickPrototypeWorkflow(
    input: CoordinatorInput,
    executions: CoordinatorOutput["metadata"]["agentExecutions"]
  ): Promise<CoordinatorOutput> {
    console.log("[AgentCoordinator] 执行快速原型工作流（并行）");

    const startTime = Date.now();

    // 并行执行结构规划和视觉方向
    const [architecture, designDirection] = await Promise.all([
      this.stage(input, "architect-quick", async () => {
        const result = await this.architectAgent.quickPlan(input.userInput);
        if (!result.success || !result.data) throw new Error("Quick architecture failed");
        return result.data;
      }, executions, "ArchitectAgent (quick, parallel)"),
      this.stage(input, "designer-quick", async () => {
        const result = await this.designerAgent.quickDirection(input.options?.style || "minimal");
        if (!result.success || !result.data) throw new Error("Quick design failed");
        return result.data;
      }, executions, "DesignerAgent (quick, parallel)"),
    ]);

    const parallelDuration = Date.now() - startTime;

    return {
      architectureSpec: architecture,
      designDirection,
      metadata: {
        workflowType: "quick-prototype",
        totalDuration: parallelDuration,
        agentExecutions: executions,
      },
    };
  }

  /**
   * 生成图像规格（基于架构和设计方向）
   */
  private generateImageSpecs(
    architectureSpec: ArchitectureSpec,
    designDirection: DesignDirection,
    maxImages?: number
  ): ImageSpec[] {
    const specs: ImageSpec[] = [];

    for (const screen of architectureSpec.screens) {
      // 为每个 screen 生成 hero 图
      specs.push({
        id: `${screen.id}-hero`,
        screenId: screen.id,
        purpose: "hero",
        prompt: `${screen.purpose}, ${designDirection.visualStyle} style hero image`,
        size: { width: 1200, height: 630 },
      });

      // 如果还有配额，为 features 生成图标
      if (specs.length < (maxImages || 10)) {
        const featureSection = screen.sections.find(s => s.type === "features");
        if (featureSection) {
          specs.push({
            id: `${screen.id}-feature-icons`,
            screenId: screen.id,
            purpose: "icon",
            prompt: `${featureSection.description}, simple icons in ${designDirection.visualStyle} style`,
            size: { width: 400, height: 400 },
          });
        }
      }
    }

    return specs.slice(0, maxImages);
  }

  /**
   * 估算工作流执行时间
   */
  estimateDuration(input: CoordinatorInput): {
    estimated: number;
    breakdown: Record<string, number>;
  } {
    const breakdown: Record<string, number> = {};

    switch (input.workflowType) {
      case "complete":
        breakdown["architect"] = 3000; // 3s
        breakdown["designer"] = 3000; // 3s
        breakdown["images"] = this.imageExecutorAgent.estimateDuration(
          input.options?.maxImages || 5,
          true
        );
        break;

      case "architecture-only":
        breakdown["architect"] = 3000;
        break;

      case "design-only":
        breakdown["architect-quick"] = 500;
        breakdown["designer"] = 3000;
        break;

      case "images-only":
        breakdown["designer-quick"] = 500;
        breakdown["images"] = this.imageExecutorAgent.estimateDuration(
          input.options?.maxImages || 5,
          true
        );
        break;

      case "quick-prototype":
        breakdown["parallel-quick"] = 1000; // 并行执行
        break;

      default:
        throw new Error(`Unknown workflow type: ${input.workflowType}`);
    }

    const estimated = Object.values(breakdown).reduce((sum, time) => sum + time, 0);

    return { estimated, breakdown };
  }
}
