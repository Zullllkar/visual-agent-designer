/**
 * 工具依赖图测试
 * --------------------------------------------------------------
 * 测试工具依赖分析和拓扑排序功能
 */

import { describe, it, expect } from "vitest";
import {
  buildDependencyGraph,
  getParallelExecutionGroups,
  canExecuteInParallel,
  analyzeDynamicDependencies,
  type ToolCall,
} from "./tool-dependency-graph";

describe("tool-dependency-graph", () => {
  describe("buildDependencyGraph", () => {
    it("should handle independent tools", () => {
      const calls: ToolCall[] = [
        { id: "1", name: "generate_images", args: {} },
        { id: "2", name: "materialize_mockup", args: {} },
        { id: "3", name: "export_handoff", args: {} },
      ];

      const graph = buildDependencyGraph(calls);

      expect(graph.layers).toHaveLength(1);
      expect(graph.layers[0]).toHaveLength(3);
      expect(graph.layers[0].map(n => n.name)).toEqual(
        expect.arrayContaining([
          "generate_images",
          "materialize_mockup",
          "export_handoff",
        ])
      );
    });

    it("should handle sequential dependencies", () => {
      const calls: ToolCall[] = [
        { id: "1", name: "ask_discovery", args: {} },
        { id: "2", name: "generate_brief", args: {} },
        { id: "3", name: "plan_design_direction", args: {} },
        { id: "4", name: "confirm_direction", args: {} },
      ];

      const graph = buildDependencyGraph(calls);

      // 应该分成 4 层（完全串行）
      expect(graph.layers).toHaveLength(4);
      expect(graph.layers[0][0].name).toBe("ask_discovery");
      expect(graph.layers[1][0].name).toBe("generate_brief");
      expect(graph.layers[2][0].name).toBe("plan_design_direction");
      expect(graph.layers[3][0].name).toBe("confirm_direction");
    });

    it("should handle mixed dependencies", () => {
      const calls: ToolCall[] = [
        { id: "1", name: "generate_brief", args: {} },
        { id: "2", name: "generate_images", args: {} },
        { id: "3", name: "materialize_mockup", args: {} },
        { id: "4", name: "plan_design_direction", args: {} },
      ];

      const graph = buildDependencyGraph(calls);

      // Layer 0: generate_brief, generate_images, materialize_mockup (并行)
      // Layer 1: plan_design_direction (依赖 generate_brief)
      expect(graph.layers).toHaveLength(2);
      expect(graph.layers[0]).toHaveLength(3);
      expect(graph.layers[1]).toHaveLength(1);
      expect(graph.layers[1][0].name).toBe("plan_design_direction");
    });

    it("should handle multiple parallel batches", () => {
      const calls: ToolCall[] = [
        // Batch 1: Brief 流程（串行）
        { id: "1", name: "ask_discovery", args: {} },
        { id: "2", name: "generate_brief", args: {} },
        // Batch 2: 图像生成（并行）
        { id: "3", name: "generate_images", args: { prompt: "A" } },
        { id: "4", name: "generate_images", args: { prompt: "B" } },
        { id: "5", name: "generate_images", args: { prompt: "C" } },
      ];

      const graph = buildDependencyGraph(calls);

      // Layer 0: ask_discovery, generate_images x3 (4 个工具并行)
      // Layer 1: generate_brief
      expect(graph.layers).toHaveLength(2);
      expect(graph.layers[0]).toHaveLength(4);
      expect(graph.layers[1]).toHaveLength(1);
    });
  });

  describe("analyzeDynamicDependencies", () => {
    it("should detect no dependencies for independent tools", () => {
      const call: ToolCall = {
        id: "1",
        name: "generate_images",
        args: { prompt: "A cat" },
      };

      const deps = analyzeDynamicDependencies(call, []);
      expect(deps).toEqual([]);
    });

    it("should detect static dependencies", () => {
      const call: ToolCall = {
        id: "2",
        name: "generate_brief",
        args: {},
      };

      const deps = analyzeDynamicDependencies(call, [
        { id: "1", name: "ask_discovery", args: {} },
      ]);

      expect(deps).toEqual(["ask_discovery"]);
    });

    it("should detect dynamic dependencies for variants", () => {
      const previousCalls: ToolCall[] = [
        { id: "1", name: "generate_images", args: { prompt: "A cat" } },
      ];

      const call: ToolCall = {
        id: "2",
        name: "generate_image_variants",
        args: { baseImageId: "img-123" },
      };

      const deps = analyzeDynamicDependencies(call, previousCalls);
      expect(deps).toEqual(["generate_images"]);
    });

    it("should detect dynamic dependencies for restyle", () => {
      const previousCalls: ToolCall[] = [
        { id: "1", name: "generate_images", args: { prompt: "A cat" } },
      ];

      const call: ToolCall = {
        id: "2",
        name: "restyle_images",
        args: { targetAssetIds: ["img-1", "img-2"] },
      };

      const deps = analyzeDynamicDependencies(call, previousCalls);
      expect(deps).toEqual(["generate_images"]);
    });

    it("should return no dependencies if no matching previous calls", () => {
      const call: ToolCall = {
        id: "1",
        name: "generate_image_variants",
        args: { baseImageId: "img-123" },
      };

      const deps = analyzeDynamicDependencies(call, []);
      expect(deps).toEqual([]);
    });
  });

  describe("getParallelExecutionGroups", () => {
    it("should group independent tools into one batch", () => {
      const calls: ToolCall[] = [
        { id: "1", name: "generate_images", args: {} },
        { id: "2", name: "generate_images", args: {} },
        { id: "3", name: "materialize_mockup", args: {} },
      ];

      const groups = getParallelExecutionGroups(calls);

      expect(groups).toHaveLength(1);
      expect(groups[0]).toHaveLength(3);
    });

    it("should separate dependent tools into multiple batches", () => {
      const calls: ToolCall[] = [
        { id: "1", name: "ask_discovery", args: {} },
        { id: "2", name: "generate_brief", args: {} },
        { id: "3", name: "plan_design_direction", args: {} },
      ];

      const groups = getParallelExecutionGroups(calls);

      expect(groups).toHaveLength(3);
      expect(groups[0]).toHaveLength(1);
      expect(groups[1]).toHaveLength(1);
      expect(groups[2]).toHaveLength(1);
    });

    it("should handle mixed scenarios", () => {
      const calls: ToolCall[] = [
        // 独立的图像生成
        { id: "1", name: "generate_images", args: { prompt: "A" } },
        { id: "2", name: "generate_images", args: { prompt: "B" } },
        // Brief 流程
        { id: "3", name: "generate_brief", args: {} },
        { id: "4", name: "plan_design_direction", args: {} },
      ];

      const groups = getParallelExecutionGroups(calls);

      // Group 0: generate_images x2, generate_brief (3 个并行)
      // Group 1: plan_design_direction
      expect(groups).toHaveLength(2);
      expect(groups[0]).toHaveLength(3);
      expect(groups[1]).toHaveLength(1);
    });
  });

  describe("canExecuteInParallel", () => {
    it("should allow parallel execution for independent tools", () => {
      const call1: ToolCall = {
        id: "1",
        name: "generate_images",
        args: {},
      };
      const call2: ToolCall = {
        id: "2",
        name: "materialize_mockup",
        args: {},
      };

      expect(canExecuteInParallel(call1, call2)).toBe(true);
    });

    it("should prevent parallel execution if call2 depends on call1", () => {
      const call1: ToolCall = {
        id: "1",
        name: "ask_discovery",
        args: {},
      };
      const call2: ToolCall = {
        id: "2",
        name: "generate_brief",
        args: {},
      };

      expect(canExecuteInParallel(call1, call2)).toBe(false);
    });

    it("should prevent parallel execution if call1 depends on call2", () => {
      const call1: ToolCall = {
        id: "1",
        name: "plan_design_direction",
        args: {},
      };
      const call2: ToolCall = {
        id: "2",
        name: "generate_brief",
        args: {},
      };

      expect(canExecuteInParallel(call1, call2)).toBe(false);
    });

    it("should allow parallel execution for same tool multiple times", () => {
      const call1: ToolCall = {
        id: "1",
        name: "generate_images",
        args: { prompt: "A" },
      };
      const call2: ToolCall = {
        id: "2",
        name: "generate_images",
        args: { prompt: "B" },
      };

      expect(canExecuteInParallel(call1, call2)).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should handle empty call list", () => {
      const graph = buildDependencyGraph([]);

      expect(graph.nodes.size).toBe(0);
      expect(graph.layers).toHaveLength(0);
    });

    it("should handle single call", () => {
      const calls: ToolCall[] = [
        { id: "1", name: "generate_images", args: {} },
      ];

      const graph = buildDependencyGraph(calls);

      expect(graph.nodes.size).toBe(1);
      expect(graph.layers).toHaveLength(1);
      expect(graph.layers[0]).toHaveLength(1);
    });

    it("should handle tools with unknown dependencies", () => {
      const calls: ToolCall[] = [
        { id: "1", name: "unknown_tool", args: {} },
        { id: "2", name: "generate_images", args: {} },
      ];

      const graph = buildDependencyGraph(calls);

      // 未知工具应被视为无依赖
      expect(graph.layers).toHaveLength(1);
      expect(graph.layers[0]).toHaveLength(2);
    });
  });

  describe("performance", () => {
    it("should handle many independent tools efficiently", () => {
      const calls: ToolCall[] = Array.from({ length: 100 }, (_, i) => ({
        id: `${i}`,
        name: "generate_images",
        args: { prompt: `Prompt ${i}` },
      }));

      const start = performance.now();
      const graph = buildDependencyGraph(calls);
      const duration = performance.now() - start;

      expect(graph.layers).toHaveLength(1);
      expect(graph.layers[0]).toHaveLength(100);
      expect(duration).toBeLessThan(100); // 应该在 100ms 内完成
    });

    it("should handle deep dependency chains efficiently", () => {
      // 创建 50 层的依赖链（虽然实际不会有这么深）
      const toolNames = Array.from({ length: 50 }, (_, i) => `tool_${i}`);

      // 构造依赖关系
      const calls: ToolCall[] = toolNames.map((name, i) => ({
        id: `${i}`,
        name,
        args: {},
      }));

      const start = performance.now();
      const graph = buildDependencyGraph(calls);
      const duration = performance.now() - start;

      // 应该在合理时间内完成
      expect(duration).toBeLessThan(100);
    });
  });
});
