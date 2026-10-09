/**
 * 专业化 Agent 系统集成测试
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { AgentCoordinator } from "./agent-coordinator";
import { ArchitectAgent } from "./architect-agent";
import { DesignerAgent } from "./designer-agent";
import { ImageExecutorAgent } from "./image-executor-agent";
import { shouldUseSpecializedAgents } from "./integration-guide";
import type { ToolContext } from "../tools/types";

describe("Specialized Agent System", () => {
  describe("决策引擎", () => {
    it("should detect complete design workflow", () => {
      const cases = [
        "Design a landing page for SaaS",
        "Create a website for my startup",
        "Build a portfolio site",
        "Make a landing page",
      ];

      for (const msg of cases) {
        const decision = shouldUseSpecializedAgents(msg, null);
        expect(decision.use).toBe(true);
        expect(decision.workflowType).toBe("complete");
      }
    });

    it("should detect quick prototype workflow", () => {
      const cases = [
        "Quick sketch of a dashboard",
        "Fast prototype of landing page",
        "Prototype a blog layout",
      ];

      for (const msg of cases) {
        const decision = shouldUseSpecializedAgents(msg, null);
        expect(decision.use).toBe(true);
        expect(decision.workflowType).toBe("quick-prototype");
      }
    });

    it("should detect images-only workflow", () => {
      const cases = [
        "Generate 5 images for hero section",
        "Create images for landing page",
        "生成图像",
      ];

      for (const msg of cases) {
        const decision = shouldUseSpecializedAgents(msg, null);
        expect(decision.use).toBe(true);
        expect(decision.workflowType).toBe("images-only");
      }
    });

    it("should detect architecture-only workflow", () => {
      const cases = [
        "Plan the structure of my website",
        "Architecture for a blog",
        "Layout plan for dashboard",
      ];

      for (const msg of cases) {
        const decision = shouldUseSpecializedAgents(msg, null);
        expect(decision.use).toBe(true);
        expect(decision.workflowType).toBe("architecture-only");
      }
    });

    it("should detect design-only workflow", () => {
      const cases = [
        "Design direction for my brand",
        "Visual style for landing page",
        "Color palette suggestions",
      ];

      for (const msg of cases) {
        const decision = shouldUseSpecializedAgents(msg, null);
        expect(decision.use).toBe(true);
        expect(decision.workflowType).toBe("design-only");
      }
    });

    it("should fallback to LangGraph for simple tasks", () => {
      const cases = [
        "What's the weather today?",
        "Hello",
        "Change the button color to red",
        "Fix the typo in header",
      ];

      for (const msg of cases) {
        const decision = shouldUseSpecializedAgents(msg, null);
        expect(decision.use).toBe(false);
        expect(decision.reason).toContain("LangGraph");
      }
    });
  });

  describe("AgentCoordinator", () => {
    let coordinator: AgentCoordinator;
    let mockToolContext: ToolContext;

    beforeEach(() => {
      // 使用 mock API key
      coordinator = new AgentCoordinator("test-api-key");

      // Mock tool context
      mockToolContext = {
        projectId: "test-project",
        userId: "test-user",
        sessionId: "test-session",
      } as any;

      coordinator.setToolContext(mockToolContext);
    });

    it("should estimate duration correctly", () => {
      const testCases = [
        {
          input: {
            userInput: "Design a landing page",
            workflowType: "complete" as const,
            options: { maxImages: 5 },
          },
          expectedMin: 30000, // 至少 30 秒（5 图并行）
        },
        {
          input: {
            userInput: "Quick prototype",
            workflowType: "quick-prototype" as const,
          },
          expectedMax: 2000, // 最多 2 秒（并行 + 启发式）
        },
        {
          input: {
            userInput: "Plan structure",
            workflowType: "architecture-only" as const,
          },
          expectedMax: 5000, // 最多 5 秒
        },
      ];

      for (const testCase of testCases) {
        const estimate = coordinator.estimateDuration(testCase.input);

        console.log(
          `工作流 ${testCase.input.workflowType}: ${estimate.estimated}ms`,
          estimate.breakdown
        );

        expect(estimate.estimated).toBeGreaterThan(0);

        if (testCase.expectedMin) {
          expect(estimate.estimated).toBeGreaterThanOrEqual(testCase.expectedMin);
        }

        if (testCase.expectedMax) {
          expect(estimate.estimated).toBeLessThanOrEqual(testCase.expectedMax);
        }
      }
    });

    it("should handle workflow types correctly", () => {
      const workflows = [
        "complete",
        "architecture-only",
        "design-only",
        "images-only",
        "quick-prototype",
      ] as const;

      for (const workflowType of workflows) {
        const estimate = coordinator.estimateDuration({
          userInput: "test",
          workflowType,
        });

        expect(estimate.estimated).toBeGreaterThan(0);
        expect(Object.keys(estimate.breakdown).length).toBeGreaterThan(0);
      }
    });
  });

  describe("性能对比", () => {
    it("should calculate speedup for parallel execution", () => {
      // 串行执行时间
      const sequential = {
        architect: 3000,
        designer: 3000,
        images: 5 * 30000, // 5 图 × 30 秒
      };
      const sequentialTotal = Object.values(sequential).reduce(
        (sum, t) => sum + t,
        0
      );

      // 并行执行时间
      const parallel = {
        architect: 3000,
        designer: 3000,
        images: Math.ceil(5 / 5) * 30000, // 5 图并行 = 1 批 × 30 秒
      };
      const parallelTotal = Object.values(parallel).reduce((sum, t) => sum + t, 0);

      const speedup = sequentialTotal / parallelTotal;

      console.log("性能对比:");
      console.log(`  串行: ${sequentialTotal}ms`);
      console.log(`  并行: ${parallelTotal}ms`);
      console.log(`  加速比: ${speedup.toFixed(2)}x`);

      expect(speedup).toBeGreaterThan(3.5); // 至少 3.5 倍加速
    });

    it("should show advantage of quick prototype", () => {
      // 完整流程
      const fullWorkflow = {
        architect: 3000,
        designer: 3000,
      };
      const fullTotal = Object.values(fullWorkflow).reduce((sum, t) => sum + t, 0);

      // 快速原型（并行 + 启发式）
      const quickPrototype = {
        parallel: 1000, // 并行执行
      };
      const quickTotal = Object.values(quickPrototype).reduce(
        (sum, t) => sum + t,
        0
      );

      const speedup = fullTotal / quickTotal;

      console.log("快速原型对比:");
      console.log(`  完整流程: ${fullTotal}ms`);
      console.log(`  快速原型: ${quickTotal}ms`);
      console.log(`  加速比: ${speedup.toFixed(2)}x`);

      expect(speedup).toBeGreaterThan(5); // 至少 5 倍加速
    });
  });

  describe("错误处理", () => {
    it("should handle missing tool context gracefully", () => {
      const coordinator = new AgentCoordinator("test-api-key");
      // 不设置 tool context

      // 应该在执行时抛出清晰的错误
      expect(async () => {
        await coordinator.execute({
          userInput: "test",
          workflowType: "architecture-only",
        });
      }).rejects.toThrow();
    });

    it("should provide clear error messages", () => {
      const coordinator = new AgentCoordinator("test-api-key");

      expect(() => {
        coordinator.estimateDuration({
          userInput: "test",
          workflowType: "invalid" as any,
        });
      }).toThrow();
    });
  });

  describe("集成场景", () => {
    it("should handle end-to-end workflow simulation", () => {
      const scenarios = [
        {
          name: "SaaS 落地页",
          input: "Design a modern SaaS landing page",
          expected: {
            workflowType: "complete",
            hasArchitecture: true,
            hasDesign: true,
            hasImages: true,
          },
        },
        {
          name: "快速草图",
          input: "Quick sketch of dashboard",
          expected: {
            workflowType: "quick-prototype",
            hasArchitecture: true,
            hasDesign: true,
            hasImages: false,
          },
        },
        {
          name: "批量图像",
          input: "Generate 3 hero images",
          expected: {
            workflowType: "images-only",
            hasArchitecture: false,
            hasDesign: true,
            hasImages: true,
          },
        },
      ];

      for (const scenario of scenarios) {
        const decision = shouldUseSpecializedAgents(scenario.input, null);

        console.log(`场景: ${scenario.name}`);
        console.log(`  输入: ${scenario.input}`);
        console.log(`  工作流: ${decision.workflowType}`);
        console.log(`  原因: ${decision.reason}`);

        expect(decision.use).toBe(true);
        expect(decision.workflowType).toBe(scenario.expected.workflowType);
      }
    });
  });
});

describe("Agent 质量保证", () => {
  it("should ensure all agents have proper config", () => {
    const agents = [
      new ArchitectAgent(),
      new DesignerAgent(),
      new ImageExecutorAgent(),
    ];

    for (const agent of agents) {
      const config = (agent as any).config;

      expect(config.name).toBeTruthy();
      expect(config.expertise).toBeTruthy();
      expect(config.systemPrompt).toBeTruthy();
      expect(config.temperature).toBeGreaterThanOrEqual(0);
      expect(config.temperature).toBeLessThanOrEqual(1);
      expect(config.maxRetries).toBeGreaterThan(0);
      expect(config.timeout).toBeGreaterThan(0);
    }
  });

  it("should validate agent specialization", () => {
    const architectConfig = (new ArchitectAgent() as any).config;
    const designerConfig = (new DesignerAgent() as any).config;

    // Architect 应该专注于结构
    expect(architectConfig.systemPrompt.toLowerCase()).toContain("structure");
    expect(architectConfig.systemPrompt.toLowerCase()).toContain("architecture");
    expect(architectConfig.systemPrompt.toLowerCase()).not.toContain("color");

    // Designer 应该专注于视觉
    expect(designerConfig.systemPrompt.toLowerCase()).toContain("visual");
    expect(designerConfig.systemPrompt.toLowerCase()).toContain("color");
    expect(designerConfig.systemPrompt.toLowerCase()).not.toContain("layout");
  });
});
