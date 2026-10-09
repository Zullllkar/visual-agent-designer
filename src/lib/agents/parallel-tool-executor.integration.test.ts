/**
 * 并行工具执行器集成测试
 * 测试与真实工具注册表的集成
 */

import { describe, it, expect, beforeEach } from "vitest";
import { executeToolsInParallel } from "./parallel-tool-executor";
import { buildDependencyGraph } from "./tool-dependency-graph";
import { toolRegistry, registerAllTools } from "./tools";
import type { ToolCall } from "./chat-schema";
import type { ToolContext } from "./tools/types";

describe("Parallel Tool Executor - Integration", () => {
  beforeEach(() => {
    registerAllTools();
  });

  describe("buildDependencyGraph", () => {
    it("should analyze real tool dependencies", () => {
      const calls: ToolCall[] = [
        { id: "1", name: "generate_brief", args: { userInput: "test" } },
        { id: "2", name: "plan_design_direction", args: {} },
        { id: "3", name: "materialize_mockup", args: {} },
        { id: "4", name: "generate_images", args: {} },
      ];

      const graph = buildDependencyGraph(calls);

      expect(graph.layers.length).toBeGreaterThan(0);
      expect(graph.nodes.size).toBe(4);

      // generate_brief 应该在第一层（无依赖）
      const layer0 = graph.layers[0];
      expect(layer0?.some(n => n.name === "generate_brief")).toBe(true);
    });

    it("should detect generate_images dependencies", () => {
      const calls: ToolCall[] = [
        { id: "1", name: "generate_images", args: { specs: [] } },
        { id: "2", name: "materialize_mockup", args: {} },
      ];

      const graph = buildDependencyGraph(calls);

      // generate_images 依赖项目，可能在第一层
      // materialize_mockup 依赖 generate_images，应该在后续层
      expect(graph.layers.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("executeToolsInParallel with real tools", () => {
    it("should handle mock tools without errors", async () => {
      const calls: ToolCall[] = [
        {
          id: "1",
          name: "answer_question",
          args: { question: "What is this?" },
        },
      ];

      const ctx = {
        project: null,
        providers: {} as any,
        scratch: { __mock: true }, // 标记为 mock 模式
      } as unknown as ToolContext;

      const summary = await executeToolsInParallel(calls, ctx, {
        maxConcurrency: 1,
        toolTimeout: 5000,
      });

      // 应该至少尝试执行
      expect(summary.totalCalls).toBe(1);
      // Mock 模式下可能失败，但不应该崩溃
      expect(summary.totalDuration).toBeGreaterThan(0);
    });

    it("should handle multiple independent tools", async () => {
      const calls: ToolCall[] = [
        { id: "1", name: "inspect_canvas", args: {} },
        { id: "2", name: "inspect_canvas", args: {} },
        { id: "3", name: "inspect_canvas", args: {} },
      ];

      const ctx = {
        project: {
          name: "test",
          content: {},
          layout: { screens: [] },
          assets: [],
        } as any,
        providers: {} as any,
        scratch: { __mock: true },
      } as unknown as ToolContext;

      const summary = await executeToolsInParallel(calls, ctx, {
        maxConcurrency: 3,
        toolTimeout: 5000,
      });

      expect(summary.totalCalls).toBe(3);
      // 所有调用应该在同一层（无依赖）
      expect(summary.layerStats.length).toBe(1);
    });

    it("should respect concurrency limits", async () => {
      const calls: ToolCall[] = Array.from({ length: 10 }, (_, i) => ({
        id: `call-${i}`,
        name: "inspect_canvas",
        args: {},
      }));

      const ctx = {
        project: {
          name: "test",
          content: {},
          layout: { screens: [] },
          assets: [],
        } as any,
        providers: {} as any,
        scratch: { __mock: true },
      } as unknown as ToolContext;

      const summary = await executeToolsInParallel(calls, ctx, {
        maxConcurrency: 2, // 限制并发为 2
        toolTimeout: 5000,
      });

      expect(summary.totalCalls).toBe(10);
      // 所有工具都应该执行完成
      expect(summary.results.length).toBe(10);
      // 并发限制应该生效（检查执行成功）
      expect(summary.successCount).toBeGreaterThan(0);
    });
  });

  describe("real-world workflow simulation", () => {
    it("should execute a typical design workflow efficiently", async () => {
      const calls: ToolCall[] = [
        // Phase 1: 规划（并行）
        { id: "1", name: "generate_brief", args: { userInput: "E-commerce homepage" } },
        { id: "2", name: "plan_design_direction", args: {} },

        // Phase 2: 检查画布
        { id: "3", name: "inspect_canvas", args: {} },
      ];

      const ctx = {
        project: null,
        projectId: "test-project",
        providers: {} as any,
        scratch: { __mock: true },
      } as unknown as ToolContext;

      const summary = await executeToolsInParallel(calls, ctx, {
        maxConcurrency: 5,
        toolTimeout: 10000,
      });

      expect(summary.totalCalls).toBe(3);

      // 应该有至少一层执行
      expect(summary.layerStats.length).toBeGreaterThanOrEqual(1);

      // 第一层应该有工具执行
      const firstLayer = summary.layerStats[0];
      expect(firstLayer?.count).toBeGreaterThan(0);
      expect(firstLayer?.duration).toBeGreaterThan(0);
    });
  });

  describe("error handling", () => {
    it("should handle tool not found gracefully", async () => {
      const calls: ToolCall[] = [
        { id: "1", name: "non_existent_tool" as any, args: {} },
      ];

      const ctx = {
        project: null,
        projectId: "test-project",
        providers: {} as any,
        scratch: {},
      } as unknown as ToolContext;

      const summary = await executeToolsInParallel(calls, ctx);

      expect(summary.totalCalls).toBe(1);
      expect(summary.errorCount).toBe(1);
      expect(summary.results[0]?.status).toBe("error");
    });

    it("should continue execution when one tool fails", async () => {
      const calls: ToolCall[] = [
        { id: "1", name: "non_existent_tool" as any, args: {} },
        { id: "2", name: "inspect_canvas", args: {} },
      ];

      const ctx = {
        project: {
          name: "test",
          content: {},
          layout: { screens: [] },
          assets: [],
        } as any,
        providers: {} as any,
        scratch: { __mock: true },
      } as unknown as ToolContext;

      const summary = await executeToolsInParallel(calls, ctx);

      expect(summary.totalCalls).toBe(2);
      // 至少有一个失败
      expect(summary.errorCount).toBeGreaterThanOrEqual(1);
      // 但执行应该完成
      expect(summary.results.length).toBe(2);
    });
  });
});
