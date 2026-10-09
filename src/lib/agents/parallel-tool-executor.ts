/**
 * 并行工具执行器
 * --------------------------------------------------------------
 * Phase 2 核心模块：基于依赖图并行执行工具
 *
 * 核心功能：
 * 1. 分析工具依赖关系
 * 2. 按层级并行执行（同一层并行，不同层串行）
 * 3. 收集执行结果
 * 4. 错误处理和回退
 */

import {
  buildDependencyGraph,
  printDependencyGraph,
  type ToolCall,
} from "./tool-dependency-graph";
import { toolRegistry } from "./tools/registry";
import type { ToolContext, ToolResult } from "./tools/types";

export interface ParallelExecutionOptions {
  /** 最大并行度（默认 5） */
  maxConcurrency?: number;
  /** 是否打印依赖图（调试用） */
  printGraph?: boolean;
  /** 单个工具执行超时（毫秒，默认 5 分钟） */
  toolTimeout?: number;
  /** 遇到错误是否继续执行其他工具 */
  continueOnError?: boolean;
}

export interface ToolExecutionResult {
  call: ToolCall;
  result?: ToolResult;
  error?: Error;
  duration: number;
  status: "success" | "error" | "timeout";
}

export interface ParallelExecutionSummary {
  totalCalls: number;
  successCount: number;
  errorCount: number;
  timeoutCount: number;
  totalDuration: number;
  results: ToolExecutionResult[];
  layerStats: Array<{
    layer: number;
    count: number;
    duration: number;
    parallel: boolean;
  }>;
}

/**
 * 并行执行工具（主入口）
 *
 * @param calls - 要执行的工具调用列表
 * @param ctx - 工具执行上下文
 * @param options - 执行选项
 * @returns 执行结果摘要
 *
 * @example
 * ```typescript
 * const calls = [
 *   { id: "1", name: "generate_images", args: { prompt: "A cat" } },
 *   { id: "2", name: "generate_images", args: { prompt: "A dog" } },
 *   { id: "3", name: "materialize_mockup", args: {...} },
 * ];
 *
 * const summary = await executeToolsInParallel(calls, ctx);
 * console.log(`成功: ${summary.successCount}, 失败: ${summary.errorCount}`);
 * console.log(`总耗时: ${summary.totalDuration}ms`);
 * ```
 */
export async function executeToolsInParallel(
  calls: ToolCall[],
  ctx: ToolContext,
  options: ParallelExecutionOptions = {}
): Promise<ParallelExecutionSummary> {
  const {
    maxConcurrency = 5,
    printGraph: shouldPrintGraph = false,
    toolTimeout = 5 * 60 * 1000, // 5 分钟
    continueOnError = true,
  } = options;

  const startTime = performance.now();
  const results: ToolExecutionResult[] = [];
  const layerStats: ParallelExecutionSummary["layerStats"] = [];

  // 1. 构建依赖图
  const graph = buildDependencyGraph(calls);

  if (shouldPrintGraph) {
    printDependencyGraph(graph);
  }

  console.log(
    `[ParallelExecutor] 开始执行 ${calls.length} 个工具，分为 ${graph.layers.length} 层`
  );

  // 2. 按层执行
  for (let layerIndex = 0; layerIndex < graph.layers.length; layerIndex++) {
    const layer = graph.layers[layerIndex];
    const layerStartTime = performance.now();

    console.log(
      `[ParallelExecutor] Layer ${layerIndex}: ${layer.length} 个工具${
        layer.length > 1 ? "并行" : ""
      }执行`
    );
    console.log(
      `  工具: ${layer.map(n => n.name).join(", ")}`
    );

    // 限制并行度
    const layerResults = await executeLayerWithConcurrencyLimit(
      layer.map(n => n.call),
      ctx,
      maxConcurrency,
      toolTimeout
    );

    results.push(...layerResults);

    const layerDuration = performance.now() - layerStartTime;
    layerStats.push({
      layer: layerIndex,
      count: layer.length,
      duration: layerDuration,
      parallel: layer.length > 1,
    });

    console.log(
      `[ParallelExecutor] Layer ${layerIndex} 完成，耗时: ${Math.round(layerDuration)}ms`
    );

    // 检查是否有错误
    const layerErrors = layerResults.filter(r => r.status === "error");
    if (layerErrors.length > 0 && !continueOnError) {
      console.error(
        `[ParallelExecutor] Layer ${layerIndex} 有 ${layerErrors.length} 个错误，停止执行`
      );
      break;
    }
  }

  const totalDuration = performance.now() - startTime;

  // 3. 统计结果
  const summary: ParallelExecutionSummary = {
    totalCalls: calls.length,
    successCount: results.filter(r => r.status === "success").length,
    errorCount: results.filter(r => r.status === "error").length,
    timeoutCount: results.filter(r => r.status === "timeout").length,
    totalDuration,
    results,
    layerStats,
  };

  console.log(
    `[ParallelExecutor] 完成: 成功 ${summary.successCount}, 失败 ${summary.errorCount}, 超时 ${summary.timeoutCount}, 总耗时 ${Math.round(totalDuration)}ms`
  );

  return summary;
}

/**
 * 执行单层工具（带并发限制）
 *
 * 使用信号量模式限制并发数，避免资源耗尽。
 */
async function executeLayerWithConcurrencyLimit(
  calls: ToolCall[],
  ctx: ToolContext,
  maxConcurrency: number,
  toolTimeout: number
): Promise<ToolExecutionResult[]> {
  const results: ToolExecutionResult[] = [];
  const queue = [...calls];
  const executing: Promise<void>[] = [];

  while (queue.length > 0 || executing.length > 0) {
    // 启动新的工具执行（直到达到并发限制）
    while (queue.length > 0 && executing.length < maxConcurrency) {
      const call = queue.shift()!;
      const promise = executeSingleTool(call, ctx, toolTimeout).then(result => {
        results.push(result);
        // 从执行队列中移除
        const index = executing.indexOf(promise);
        if (index > -1) {
          executing.splice(index, 1);
        }
      });
      executing.push(promise);
    }

    // 等待至少一个完成
    if (executing.length > 0) {
      await Promise.race(executing);
    }
  }

  return results;
}

/**
 * 执行单个工具
 */
async function executeSingleTool(
  call: ToolCall,
  ctx: ToolContext,
  timeout: number
): Promise<ToolExecutionResult> {
  const startTime = performance.now();

  console.log(`[ParallelExecutor] 开始执行: ${call.name} (${call.id})`);

  try {
    const result = await Promise.race([
      toolRegistry.execute(call.name, call.args, ctx),
      createTimeoutPromise(timeout, call.name),
    ]);

    const duration = performance.now() - startTime;

    if (result === null) {
      // 超时
      console.warn(
        `[ParallelExecutor] 超时: ${call.name} (${call.id}), 耗时: ${Math.round(duration)}ms`
      );
      return {
        call,
        error: new Error(`Tool execution timeout after ${timeout}ms`),
        duration,
        status: "timeout",
      };
    }

    console.log(
      `[ParallelExecutor] 完成: ${call.name} (${call.id}), 耗时: ${Math.round(duration)}ms`
    );

    return {
      call,
      result,
      duration,
      status: "success",
    };
  } catch (error) {
    const duration = performance.now() - startTime;
    console.error(
      `[ParallelExecutor] 错误: ${call.name} (${call.id}), 耗时: ${Math.round(duration)}ms`,
      error
    );

    return {
      call,
      error: error as Error,
      duration,
      status: "error",
    };
  }
}

/**
 * 创建超时 Promise
 */
function createTimeoutPromise(ms: number, toolName: string): Promise<null> {
  return new Promise(resolve => {
    setTimeout(() => {
      console.warn(`[ParallelExecutor] ${toolName} 执行超时 (${ms}ms)`);
      resolve(null);
    }, ms);
  });
}

/**
 * 串行执行工具（向后兼容）
 *
 * 这是旧的执行方式，保留用于对比和回退。
 */
export async function executeToolsSequentially(
  calls: ToolCall[],
  ctx: ToolContext
): Promise<ParallelExecutionSummary> {
  const startTime = performance.now();
  const results: ToolExecutionResult[] = [];

  console.log(`[SequentialExecutor] 开始串行执行 ${calls.length} 个工具`);

  for (const call of calls) {
    const result = await executeSingleTool(call, ctx, 5 * 60 * 1000);
    results.push(result);
  }

  const totalDuration = performance.now() - startTime;

  return {
    totalCalls: calls.length,
    successCount: results.filter(r => r.status === "success").length,
    errorCount: results.filter(r => r.status === "error").length,
    timeoutCount: results.filter(r => r.status === "timeout").length,
    totalDuration,
    results,
    layerStats: results.map((r, i) => ({
      layer: i,
      count: 1,
      duration: r.duration,
      parallel: false,
    })),
  };
}

/**
 * 获取执行统计信息（用于性能分析）
 */
export function getExecutionStats(summary: ParallelExecutionSummary): string {
  const { totalCalls, successCount, errorCount, timeoutCount, totalDuration, layerStats } =
    summary;

  const lines = [
    "执行统计:",
    "─".repeat(60),
    `总调用: ${totalCalls}`,
    `成功: ${successCount}`,
    `失败: ${errorCount}`,
    `超时: ${timeoutCount}`,
    `总耗时: ${Math.round(totalDuration)}ms`,
    "",
    "分层统计:",
  ];

  layerStats.forEach(stat => {
    lines.push(
      `  Layer ${stat.layer}: ${stat.count} 个工具${
        stat.parallel ? " (并行)" : ""
      }, 耗时: ${Math.round(stat.duration)}ms`
    );
  });

  if (layerStats.length > 0) {
    const avgDuration = totalDuration / layerStats.length;
    lines.push("", `平均每层耗时: ${Math.round(avgDuration)}ms`);
  }

  lines.push("─".repeat(60));

  return lines.join("\n");
}

/**
 * 对比并行和串行执行的性能
 */
export function comparePerformance(
  parallelSummary: ParallelExecutionSummary,
  sequentialSummary: ParallelExecutionSummary
): string {
  const speedup = sequentialSummary.totalDuration / parallelSummary.totalDuration;
  const timeSaved = sequentialSummary.totalDuration - parallelSummary.totalDuration;

  return [
    "性能对比:",
    "─".repeat(60),
    `串行执行: ${Math.round(sequentialSummary.totalDuration)}ms`,
    `并行执行: ${Math.round(parallelSummary.totalDuration)}ms`,
    `加速比: ${speedup.toFixed(2)}x`,
    `节省时间: ${Math.round(timeSaved)}ms (${Math.round((timeSaved / sequentialSummary.totalDuration) * 100)}%)`,
    "─".repeat(60),
  ].join("\n");
}
