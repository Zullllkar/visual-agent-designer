/**
 * 性能监控测试
 * --------------------------------------------------------------
 * 测试性能监控器的指标收集和统计功能
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  performanceMonitor,
  createMetricsFromSummary,
  type ParallelExecutionMetrics,
} from "./performance-monitor";

describe("Performance Monitor", () => {
  beforeEach(() => {
    performanceMonitor.clear();
  });

  describe("recordParallelExecution", () => {
    it("should record metrics", () => {
      const metrics: ParallelExecutionMetrics = {
        sessionId: "test-session",
        projectId: "project-1",
        totalTools: 5,
        successCount: 4,
        errorCount: 1,
        timeoutCount: 0,
        totalDuration: 1000,
        avgDuration: 200,
        maxDuration: 500,
        minDuration: 100,
        maxParallelism: 3,
        layerCount: 2,
        layerStats: [
          { layer: 0, toolCount: 3, duration: 500 },
          { layer: 1, toolCount: 2, duration: 500 },
        ],
        toolMetrics: [],
        timestamp: new Date().toISOString(),
      };

      performanceMonitor.recordParallelExecution(metrics);

      const all = performanceMonitor.getAllMetrics();
      expect(all).toHaveLength(1);
      expect(all[0]).toEqual(metrics);
    });

    it("should keep only last 100 records", () => {
      for (let i = 0; i < 150; i++) {
        const metrics: ParallelExecutionMetrics = {
          sessionId: `session-${i}`,
          projectId: null,
          totalTools: 1,
          successCount: 1,
          errorCount: 0,
          timeoutCount: 0,
          totalDuration: 100,
          avgDuration: 100,
          maxDuration: 100,
          minDuration: 100,
          maxParallelism: 1,
          layerCount: 1,
          layerStats: [{ layer: 0, toolCount: 1, duration: 100 }],
          toolMetrics: [],
          timestamp: new Date().toISOString(),
        };
        performanceMonitor.recordParallelExecution(metrics);
      }

      const all = performanceMonitor.getAllMetrics();
      expect(all).toHaveLength(100);
      expect(all[0].sessionId).toBe("session-50"); // 前 50 个被删除
    });
  });

  describe("getStatistics", () => {
    it("should return empty stats when no metrics", () => {
      const stats = performanceMonitor.getStatistics();
      expect(stats.totalExecutions).toBe(0);
      expect(stats.totalTools).toBe(0);
      expect(stats.avgToolsPerExecution).toBe(0);
      expect(stats.avgDuration).toBe(0);
      expect(stats.avgParallelism).toBe(0);
      expect(stats.successRate).toBe(0);
    });

    it("should calculate correct statistics", () => {
      // 记录 3 次执行
      const metrics1: ParallelExecutionMetrics = {
        sessionId: "s1",
        projectId: null,
        totalTools: 5,
        successCount: 5,
        errorCount: 0,
        timeoutCount: 0,
        totalDuration: 1000,
        avgDuration: 200,
        maxDuration: 300,
        minDuration: 100,
        maxParallelism: 3,
        layerCount: 2,
        layerStats: [],
        toolMetrics: [],
        timestamp: new Date().toISOString(),
      };

      const metrics2: ParallelExecutionMetrics = {
        ...metrics1,
        sessionId: "s2",
        totalTools: 3,
        successCount: 2,
        errorCount: 1,
        totalDuration: 500,
        maxParallelism: 2,
      };

      const metrics3: ParallelExecutionMetrics = {
        ...metrics1,
        sessionId: "s3",
        totalTools: 7,
        successCount: 7,
        errorCount: 0,
        totalDuration: 1500,
        maxParallelism: 4,
      };

      performanceMonitor.recordParallelExecution(metrics1);
      performanceMonitor.recordParallelExecution(metrics2);
      performanceMonitor.recordParallelExecution(metrics3);

      const stats = performanceMonitor.getStatistics();
      expect(stats.totalExecutions).toBe(3);
      expect(stats.totalTools).toBe(15); // 5 + 3 + 7
      expect(stats.avgToolsPerExecution).toBe(5); // 15 / 3
      expect(stats.avgDuration).toBe(1000); // (1000 + 500 + 1500) / 3
      expect(stats.avgParallelism).toBe(3); // (3 + 2 + 4) / 3
      expect(stats.successRate).toBe((14 / 15) * 100); // 93.33%
    });
  });

  describe("getRecentMetrics", () => {
    it("should return most recent metrics", () => {
      for (let i = 0; i < 20; i++) {
        const metrics: ParallelExecutionMetrics = {
          sessionId: `session-${i}`,
          projectId: null,
          totalTools: 1,
          successCount: 1,
          errorCount: 0,
          timeoutCount: 0,
          totalDuration: 100,
          avgDuration: 100,
          maxDuration: 100,
          minDuration: 100,
          maxParallelism: 1,
          layerCount: 1,
          layerStats: [],
          toolMetrics: [],
          timestamp: new Date().toISOString(),
        };
        performanceMonitor.recordParallelExecution(metrics);
      }

      const recent = performanceMonitor.getRecentMetrics(5);
      expect(recent).toHaveLength(5);
      expect(recent[0].sessionId).toBe("session-15");
      expect(recent[4].sessionId).toBe("session-19");
    });
  });

  describe("createMetricsFromSummary", () => {
    it("should create metrics from execution summary", () => {
      const summary = {
        totalCalls: 3,
        successCount: 2,
        errorCount: 1,
        timeoutCount: 0,
        totalDuration: 1500,
        results: [
          {
            call: { id: "1", name: "tool1" },
            status: "success" as const,
            duration: 500,
          },
          {
            call: { id: "2", name: "tool2" },
            status: "success" as const,
            duration: 400,
          },
          {
            call: { id: "3", name: "tool3" },
            status: "error" as const,
            duration: 600,
            error: new Error("Test error"),
          },
        ],
        layerStats: [
          { layer: 0, toolCount: 2, duration: 500 },
          { layer: 1, toolCount: 1, duration: 1000 },
        ],
      };

      const metrics = createMetricsFromSummary(summary, "session-1", "project-1");

      expect(metrics.sessionId).toBe("session-1");
      expect(metrics.projectId).toBe("project-1");
      expect(metrics.totalTools).toBe(3);
      expect(metrics.successCount).toBe(2);
      expect(metrics.errorCount).toBe(1);
      expect(metrics.totalDuration).toBe(1500);
      expect(metrics.avgDuration).toBe(500); // (500 + 400 + 600) / 3
      expect(metrics.maxDuration).toBe(600);
      expect(metrics.minDuration).toBe(400);
      expect(metrics.maxParallelism).toBe(2); // max(2, 1)
      expect(metrics.layerCount).toBe(2);
      expect(metrics.toolMetrics).toHaveLength(3);
      expect(metrics.toolMetrics[0].toolName).toBe("tool1");
      expect(metrics.toolMetrics[2].error).toBe("Test error");
    });
  });

  describe("exportJSON", () => {
    it("should export metrics as JSON", () => {
      const metrics: ParallelExecutionMetrics = {
        sessionId: "test",
        projectId: null,
        totalTools: 1,
        successCount: 1,
        errorCount: 0,
        timeoutCount: 0,
        totalDuration: 100,
        avgDuration: 100,
        maxDuration: 100,
        minDuration: 100,
        maxParallelism: 1,
        layerCount: 1,
        layerStats: [],
        toolMetrics: [],
        timestamp: new Date().toISOString(),
      };

      performanceMonitor.recordParallelExecution(metrics);

      const json = performanceMonitor.exportJSON();
      const parsed = JSON.parse(json);

      expect(parsed.metrics).toHaveLength(1);
      expect(parsed.statistics).toBeDefined();
      expect(parsed.exportTime).toBeDefined();
    });
  });
});
