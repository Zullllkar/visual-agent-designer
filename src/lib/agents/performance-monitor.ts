/**
 * 性能监控工具
 * --------------------------------------------------------------
 * 收集和报告工具执行性能指标
 */

export interface PerformanceMetric {
  /** 工具名称 */
  toolName: string;
  /** 工具调用 ID */
  callId: string;
  /** 开始时间（毫秒） */
  startTime: number;
  /** 结束时间（毫秒） */
  endTime: number;
  /** 执行时长（毫秒） */
  duration: number;
  /** 执行状态 */
  status: "success" | "error" | "timeout";
  /** 错误信息（如果失败） */
  error?: string;
}

export interface ParallelExecutionMetrics {
  /** 会话 ID */
  sessionId: string;
  /** 项目 ID */
  projectId: string | null;
  /** 总工具数 */
  totalTools: number;
  /** 成功数 */
  successCount: number;
  /** 失败数 */
  errorCount: number;
  /** 超时数 */
  timeoutCount: number;
  /** 总耗时（毫秒） */
  totalDuration: number;
  /** 平均耗时（毫秒） */
  avgDuration: number;
  /** 最长耗时（毫秒） */
  maxDuration: number;
  /** 最短耗时（毫秒） */
  minDuration: number;
  /** 并行度（实际同时执行的最大工具数） */
  maxParallelism: number;
  /** 层数 */
  layerCount: number;
  /** 每层的统计 */
  layerStats: Array<{
    layer: number;
    toolCount: number;
    duration: number;
  }>;
  /** 各工具的详细指标 */
  toolMetrics: PerformanceMetric[];
  /** 记录时间 */
  timestamp: string;
}

class PerformanceMonitor {
  private metrics: ParallelExecutionMetrics[] = [];
  private currentSession: string | null = null;

  /**
   * 开始新的监控会话
   */
  startSession(sessionId: string): void {
    this.currentSession = sessionId;
  }

  /**
   * 记录并行执行指标
   */
  recordParallelExecution(metrics: ParallelExecutionMetrics): void {
    this.metrics.push(metrics);

    // 只保留最近 100 条记录
    if (this.metrics.length > 100) {
      this.metrics.shift();
    }

    // 打印摘要
    this.logSummary(metrics);
  }

  /**
   * 打印性能摘要
   */
  private logSummary(metrics: ParallelExecutionMetrics): void {
    console.log(`\n=== 并行执行性能报告 ===`);
    console.log(`项目: ${metrics.projectId || '未知'}`);
    console.log(`工具总数: ${metrics.totalTools}`);
    console.log(`成功: ${metrics.successCount} | 失败: ${metrics.errorCount} | 超时: ${metrics.timeoutCount}`);
    console.log(`总耗时: ${Math.round(metrics.totalDuration)}ms`);
    console.log(`平均耗时: ${Math.round(metrics.avgDuration)}ms`);
    console.log(`最大并行度: ${metrics.maxParallelism}`);
    console.log(`分层执行: ${metrics.layerCount} 层`);

    // 打印每层统计
    for (const layer of metrics.layerStats) {
      console.log(
        `  Layer ${layer.layer}: ${layer.toolCount} 个工具, 耗时 ${Math.round(layer.duration)}ms`
      );
    }

    // 打印最慢的工具
    const slowestTools = [...metrics.toolMetrics]
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 3);

    if (slowestTools.length > 0) {
      console.log(`\n最慢的工具:`);
      for (const tool of slowestTools) {
        console.log(
          `  ${tool.toolName}: ${Math.round(tool.duration)}ms (${tool.status})`
        );
      }
    }

    console.log(`========================\n`);
  }

  /**
   * 获取所有指标
   */
  getAllMetrics(): ParallelExecutionMetrics[] {
    return [...this.metrics];
  }

  /**
   * 获取最近的指标
   */
  getRecentMetrics(count: number = 10): ParallelExecutionMetrics[] {
    return this.metrics.slice(-count);
  }

  /**
   * 获取统计摘要
   */
  getStatistics(): {
    totalExecutions: number;
    totalTools: number;
    avgToolsPerExecution: number;
    avgDuration: number;
    avgParallelism: number;
    successRate: number;
  } {
    if (this.metrics.length === 0) {
      return {
        totalExecutions: 0,
        totalTools: 0,
        avgToolsPerExecution: 0,
        avgDuration: 0,
        avgParallelism: 0,
        successRate: 0,
      };
    }

    const totalExecutions = this.metrics.length;
    const totalTools = this.metrics.reduce((sum, m) => sum + m.totalTools, 0);
    const totalSuccesses = this.metrics.reduce((sum, m) => sum + m.successCount, 0);
    const totalDuration = this.metrics.reduce((sum, m) => sum + m.totalDuration, 0);
    const totalParallelism = this.metrics.reduce((sum, m) => sum + m.maxParallelism, 0);

    return {
      totalExecutions,
      totalTools,
      avgToolsPerExecution: totalTools / totalExecutions,
      avgDuration: totalDuration / totalExecutions,
      avgParallelism: totalParallelism / totalExecutions,
      successRate: totalTools > 0 ? (totalSuccesses / totalTools) * 100 : 0,
    };
  }

  /**
   * 清空所有指标
   */
  clear(): void {
    this.metrics = [];
    this.currentSession = null;
  }

  /**
   * 导出为 JSON
   */
  exportJSON(): string {
    return JSON.stringify(
      {
        metrics: this.metrics,
        statistics: this.getStatistics(),
        exportTime: new Date().toISOString(),
      },
      null,
      2
    );
  }
}

/**
 * 全局性能监控器实例
 */
export const performanceMonitor = new PerformanceMonitor();

/**
 * 从并行执行摘要创建性能指标
 */
export function createMetricsFromSummary(
  summary: {
    totalCalls: number;
    successCount: number;
    errorCount: number;
    timeoutCount: number;
    totalDuration: number;
    results: Array<{
      call: { id: string; name: string };
      status: "success" | "error" | "timeout";
      duration: number;
      error?: Error;
    }>;
    layerStats: Array<{
      layer: number;
      toolCount?: number;
      count?: number;
      duration: number;
    }>;
  },
  sessionId: string,
  projectId: string | null
): ParallelExecutionMetrics {
  const durations = summary.results.map((r) => r.duration);
  const maxDuration = Math.max(...durations);
  const minDuration = Math.min(...durations);
  const avgDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;

  // 计算最大并行度（每层的最大工具数）
  const maxParallelism = Math.max(...summary.layerStats.map((s) => s.toolCount ?? s.count ?? 0), 1);

  const toolMetrics: PerformanceMetric[] = summary.results.map((result) => ({
    toolName: result.call.name,
    callId: result.call.id,
    startTime: 0, // 未记录
    endTime: 0, // 未记录
    duration: result.duration,
    status: result.status,
    error: result.error?.message,
  }));

  return {
    sessionId,
    projectId,
    totalTools: summary.totalCalls,
    successCount: summary.successCount,
    errorCount: summary.errorCount,
    timeoutCount: summary.timeoutCount,
    totalDuration: summary.totalDuration,
    avgDuration,
    maxDuration,
    minDuration,
    maxParallelism,
    layerCount: summary.layerStats.length,
    layerStats: summary.layerStats.map((layer) => ({
      layer: layer.layer,
      toolCount: layer.toolCount ?? layer.count ?? 0,
      duration: layer.duration,
    })),
    toolMetrics,
    timestamp: new Date().toISOString(),
  };
}
