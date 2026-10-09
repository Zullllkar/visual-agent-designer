/**
 * Image Executor Agent - 图像生成执行专家
 * --------------------------------------------------------------
 * 职责：
 * 1. 并行执行所有图像生成任务
 * 2. 管理图像生成的并发控制
 * 3. 处理生成失败和重试
 *
 * 特点：
 * - 专注于执行效率（并行 > 串行）
 * - 使用 ParallelToolExecutor 实现并行
 * - 智能重试策略
 */

import { SpecializedAgent, type AgentResult } from "./base-agent";
import type { DesignDirection } from "./designer-agent";
import type { ArchitectureSpec } from "./architect-agent";

/**
 * 图像规格
 */
export interface ImageSpec {
  id: string;
  screenId: string;
  purpose: "hero" | "illustration" | "icon" | "background" | "product";
  prompt: string;
  size?: { width: number; height: number };
  style?: string;
}

/**
 * 输入：图像规划
 */
export interface ImageExecutorInput {
  images: ImageSpec[];
  designDirection: DesignDirection;
  architectureSpec?: ArchitectureSpec;
}

/**
 * 输出：生成的图像
 */
export interface GeneratedImages {
  images: Array<{
    id: string;
    screenId: string;
    assetId: string;
    url: string;
    status: "success" | "failed";
    error?: string;
    retries: number;
  }>;
  stats: {
    totalRequested: number;
    successCount: number;
    failedCount: number;
    totalDuration: number;
    averageDuration: number;
  };
}

/**
 * Image Executor Agent 实现
 */
export class ImageExecutorAgent extends SpecializedAgent<
  ImageExecutorInput,
  GeneratedImages
> {
  constructor() {
    super(
      {
        name: "ImageExecutorAgent",
        expertise: "Parallel Image Generation & Execution Management",
        systemPrompt: `You are an image generation execution specialist.

Your role is purely operational - you execute image generation tasks efficiently.
You do NOT make creative decisions about what images to generate or how they should look.
That's already been decided by upstream agents.

Your responsibilities:
1. Execute image generation tasks in parallel
2. Handle failures gracefully with retries
3. Report status clearly`,
        temperature: 0.1, // 极低温度 = 纯执行
      }
    );
  }

  async execute(input: ImageExecutorInput): Promise<AgentResult<GeneratedImages>> {
    this.log("info", "开始并行图像生成", {
      imageCount: input.images.length,
    });

    if (!this.toolContext) {
      return this.createErrorResult("Tool context not set", 0);
    }

    const startTime = Date.now();

    try {
      // 1. 准备所有图像生成任务
      const tasks = input.images.map(spec => this.enrichPrompt(spec, input.designDirection));

      // 2. 并行执行所有任务
      const results = await this.executeParallel(tasks);

      // 3. 统计结果
      const duration = Date.now() - startTime;
      const stats = this.calculateStats(results, duration);

      this.log("info", "图像生成完成", stats);

      return this.createSuccessResult(
        {
          images: results,
          stats,
        },
        duration
      );
    } catch (error) {
      this.log("error", "图像生成失败", error);
      return this.createErrorResult(error as Error, Date.now() - startTime);
    }
  }

  /**
   * 丰富 prompt（融入设计方向）
   */
  private enrichPrompt(spec: ImageSpec, direction: DesignDirection): ImageSpec {
    let enhancedPrompt = spec.prompt;

    // 添加视觉风格
    enhancedPrompt += `, ${direction.visualStyle} style`;

    // 添加情绪关键词
    if (direction.mood.length > 0) {
      enhancedPrompt += `, ${direction.mood.slice(0, 2).join(" and ")} mood`;
    }

    // 添加配色提示
    enhancedPrompt += `, primary color ${direction.colorPalette.primary}`;

    return {
      ...spec,
      prompt: enhancedPrompt,
    };
  }

  /**
   * 并行执行所有图像生成任务
   */
  private async executeParallel(
    specs: ImageSpec[]
  ): Promise<GeneratedImages["images"]> {
    // 构建工具调用
    const toolCalls = specs.map(spec => ({
      name: "generate_images",
      args: {
        prompt: spec.prompt,
        count: 1,
        size: spec.size,
        style: spec.style,
      },
    }));

    // 使用并行执行器
    const toolResults = await this.executeToolsParallel(toolCalls);

    // 映射结果
    return specs.map((spec, index) => {
      const result = toolResults[index];

      if (!result || (result as any).error) {
        return {
          id: spec.id,
          screenId: spec.screenId,
          assetId: "",
          url: "",
          status: "failed" as const,
          error: (result as any)?.error || "Unknown error",
          retries: 0,
        };
      }

      // 假设结果包含 assetId 和 url
      const assetData = (result as any).assets?.[0] || {};

      return {
        id: spec.id,
        screenId: spec.screenId,
        assetId: assetData.assetId || "",
        url: assetData.url || "",
        status: "success" as const,
        retries: 0,
      };
    });
  }

  /**
   * 批量生成（简化接口）
   */
  async generateBatch(
    prompts: string[],
    designDirection: DesignDirection
  ): Promise<AgentResult<GeneratedImages>> {
    const images: ImageSpec[] = prompts.map((prompt, i) => ({
      id: `img-${i}`,
      screenId: "main",
      purpose: "illustration",
      prompt,
    }));

    return await this.execute({ images, designDirection });
  }

  /**
   * 单张生成（快捷方法）
   */
  async generateSingle(
    prompt: string,
    designDirection: DesignDirection
  ): Promise<AgentResult<GeneratedImages>> {
    return await this.generateBatch([prompt], designDirection);
  }

  /**
   * 计算统计信息
   */
  private calculateStats(
    results: GeneratedImages["images"],
    totalDuration: number
  ): GeneratedImages["stats"] {
    const successCount = results.filter(r => r.status === "success").length;
    const failedCount = results.filter(r => r.status === "failed").length;

    return {
      totalRequested: results.length,
      successCount,
      failedCount,
      totalDuration,
      averageDuration: results.length > 0 ? totalDuration / results.length : 0,
    };
  }

  /**
   * 重试失败的图像
   */
  async retryFailed(
    previousResult: GeneratedImages,
    designDirection: DesignDirection,
    maxRetries: number = 3
  ): Promise<AgentResult<GeneratedImages>> {
    this.log("info", "重试失败的图像生成", {
      failedCount: previousResult.stats.failedCount,
    });

    const failedImages = previousResult.images.filter(img => img.status === "failed");

    if (failedImages.length === 0) {
      this.log("info", "没有失败的图像需要重试");
      return this.createSuccessResult(previousResult, 0);
    }

    // 构建重试任务（只重试失败的）
    const retrySpecs: ImageSpec[] = failedImages.map(failed => ({
      id: failed.id,
      screenId: failed.screenId,
      purpose: "illustration", // 默认
      prompt: `retry: ${failed.error}`, // TODO: 从原始 spec 恢复
    }));

    // 执行重试
    const retryResult = await this.execute({
      images: retrySpecs,
      designDirection,
    });

    if (!retryResult.success || !retryResult.data) {
      return retryResult;
    }

    // 合并结果
    const retryData = retryResult.data;
    if (!retryData) return retryResult;
    const mergedImages = previousResult.images.map(img => {
      if (img.status === "success") {
        return img; // 保留成功的
      }

      // 查找重试结果
      const retried = retryData.images.find(r => r.id === img.id);
      return retried || { ...img, retries: img.retries + 1 };
    });

    const mergedResult: GeneratedImages = {
      images: mergedImages,
      stats: this.calculateStats(
        mergedImages,
        previousResult.stats.totalDuration + retryResult.duration
      ),
    };

    return this.createSuccessResult(mergedResult, retryResult.duration);
  }

  /**
   * 估算生成时间
   */
  estimateDuration(imageCount: number, parallel: boolean = true): number {
    const singleImageTime = 30000; // 30 秒
    const maxConcurrency = 5;

    if (parallel) {
      const batches = Math.ceil(imageCount / maxConcurrency);
      return batches * singleImageTime;
    } else {
      return imageCount * singleImageTime;
    }
  }
}
