/**
 * Tests for Enhanced System Prompt
 * --------------------------------------------------------------
 * 验证增强版系统提示词包含所有必要的 ReAct 指导
 */

import { describe, expect, it } from "vitest";
import type { ProjectFile } from "@/lib/project/schema";
import { buildEnhancedSystemPrompt } from "./enhanced-system-prompt";
import type { AgentContext } from "./types";
import { createPlaceholderProject } from "@/lib/project/placeholder";
import { SkillManifestSchema, DesignSystemManifestSchema } from "@/lib/skills/schema";

describe("buildEnhancedSystemPrompt", () => {
  const mockAgentContext = (): AgentContext => ({
    projectId: "test-project",
    scratch: {},
    providers: {
      llm: {
        name: "mock-llm",
        generateText: async () => ({ text: "mock" }),
        supportsToolCalling: false,
      },
      image: {
        name: "mock-image",
        generateImage: async () => ({ imageUrl: "mock.png", model: "mock" }),
      },
      visionCritic: false,
    },
    skill: undefined,
    designSystem: undefined,
  });

  describe("Core Sections", () => {
    it("includes Identity section", () => {
      const prompt = buildEnhancedSystemPrompt(null, mockAgentContext());
      expect(prompt).toContain("# Identity");
      expect(prompt).toContain("Vibeboard ReAct Agent");
      expect(prompt).toContain("Reply in Chinese");
    });

    it("includes ReAct Philosophy section", () => {
      const prompt = buildEnhancedSystemPrompt(null, mockAgentContext());
      expect(prompt).toContain("# ReAct Philosophy");
      expect(prompt).toContain("Thought → Action");
      expect(prompt).toContain("Think Before Acting");
      expect(prompt).toContain("One Tool at a Time");
      expect(prompt).toContain("Chat-First for Questions");
    });

    it("includes Project State section", () => {
      const prompt = buildEnhancedSystemPrompt(null, mockAgentContext());
      expect(prompt).toContain("# Current Project State");
      expect(prompt).toContain("Blank project");
    });

    it("includes Workflow Knowledge section", () => {
      const prompt = buildEnhancedSystemPrompt(null, mockAgentContext());
      expect(prompt).toContain("# Workflow Knowledge");
      expect(prompt).toContain("Design Pipeline Understanding");
      expect(prompt).toContain("State-Based Decision Making");
      expect(prompt).toContain("Blank Project Scenarios");
    });

    it("includes Discovery Protocol section", () => {
      const prompt = buildEnhancedSystemPrompt(null, mockAgentContext());
      expect(prompt).toContain("# Discovery Protocol");
      expect(prompt).toContain("When to Ask Discovery Questions");
      expect(prompt).toContain("When to SKIP Discovery");
    });

    it("includes Direction Confirmation section", () => {
      const prompt = buildEnhancedSystemPrompt(null, mockAgentContext());
      expect(prompt).toContain("# Direction Confirmation Protocol");
      expect(prompt).toContain("Mandatory Confirmation");
      expect(prompt).toContain("After plan_design_direction");
    });

    it("includes Image Generation section", () => {
      const prompt = buildEnhancedSystemPrompt(null, mockAgentContext());
      expect(prompt).toContain("# Image Generation Protocol");
      expect(prompt).toContain("Tool Approval Flow");
      expect(prompt).toContain("Count vs Prompts Logic");
    });

    it("includes Available Tools section", () => {
      const prompt = buildEnhancedSystemPrompt(null, mockAgentContext());
      expect(prompt).toContain("# Available Tools");
      // 应该包含一些核心工具
      expect(prompt).toContain("generate_brief");
      expect(prompt).toContain("plan_design_direction");
      expect(prompt).toContain("generate_images");
    });
  });

  describe("Project State Awareness", () => {
    it("shows blank project state", () => {
      const prompt = buildEnhancedSystemPrompt(null, mockAgentContext());
      expect(prompt).toContain("Blank project");
      expect(prompt).toContain("no brief has been generated");
    });

    it("shows project with brief", () => {
      const project = {
        id: "test",
        title: "Test Project",
        brief: {
          productName: "Test App",
          positioning: "A test application",
          targetUser: "Developers",
          scenarios: ["Development", "Testing"],
          coreFeatures: ["Feature 1", "Feature 2"],
          platform: "web" as const,
          visualStyle: "Modern and clean",
          outputTargets: ["cursor"],
        },
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const prompt = buildEnhancedSystemPrompt(project as unknown as ProjectFile, mockAgentContext());
      expect(prompt).toContain("Brief: generated");
      expect(prompt).toContain("Test Project");
    });

    it("shows design direction state", () => {
      const project = {
        id: "test",
        title: "Test Project",
        brief: {
          productName: "Test App",
          positioning: "A test application",
          targetUser: "Developers",
          scenarios: ["Development", "Testing"],
          coreFeatures: ["Feature 1", "Feature 2"],
          platform: "web" as const,
          visualStyle: "Modern and clean",
          outputTargets: ["cursor"],
        },
        designDirection: {
          summary: "Modern minimalist style",
          moodKeywords: ["modern", "minimalist", "clean"],
        },
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const prompt = buildEnhancedSystemPrompt(project as unknown as ProjectFile, mockAgentContext());
      expect(prompt).toContain("Visual direction: generated");
    });

    it("shows assets count", () => {
      const project = {
        id: "test",
        title: "Test Project",
        brief: {
          productName: "Test App",
          positioning: "A test application",
          targetUser: "Developers",
          scenarios: ["Development", "Testing"],
          coreFeatures: ["Feature 1", "Feature 2"],
          platform: "web" as const,
          visualStyle: "Modern and clean",
          outputTargets: ["cursor"],
        },
        designDirection: {
          summary: "Modern minimalist style",
          moodKeywords: ["modern", "minimalist"],
        },
        assets: [
          {
            id: "asset1",
            src: "test.png",
            status: "candidate",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: "asset2",
            src: "test2.png",
            status: "generating",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const prompt = buildEnhancedSystemPrompt(project as unknown as ProjectFile, mockAgentContext());
      expect(prompt).toContain("Assets: 2");
      expect(prompt).toContain("ready 1");
      expect(prompt).toContain("generating 1");
    });
  });

  describe("Workflow Decision Rules", () => {
    it("includes blank project workflow", () => {
      const prompt = buildEnhancedSystemPrompt(null, mockAgentContext());
      expect(prompt).toContain("User provides product type AND visual style");
      expect(prompt).toContain("Skip discovery");
      expect(prompt).toContain("generate_brief");
    });

    it("includes discovery skip conditions", () => {
      const prompt = buildEnhancedSystemPrompt(null, mockAgentContext());
      expect(prompt).toContain("User says 'skip questions'");
      expect(prompt).toContain("直接开始");
    });

    it("includes direction adjustment workflow", () => {
      const prompt = buildEnhancedSystemPrompt(null, mockAgentContext());
      expect(prompt).toContain("视觉方向调整");
      expect(prompt).toContain("ask_discovery with direction-adjust form");
    });

    it("includes style adoption workflow", () => {
      const prompt = buildEnhancedSystemPrompt(null, mockAgentContext());
      expect(prompt).toContain("采用素材风格");
      expect(prompt).toContain("adopt_asset_style");
    });
  });

  describe("Critical Rules", () => {
    it("warns against calling multiple conflicting tools", () => {
      const prompt = buildEnhancedSystemPrompt(null, mockAgentContext());
      expect(prompt).toContain("Never call ask_discovery AND generate_images in the same turn");
      expect(prompt).toContain("Never call confirm_direction AND generate_images in the same turn");
    });

    it("emphasizes stopping after confirm_direction", () => {
      const prompt = buildEnhancedSystemPrompt(null, mockAgentContext());
      expect(prompt).toContain("After confirm_direction, always STOP");
      expect(prompt).toContain("wait for user confirmation");
    });

    it("clarifies output format", () => {
      const prompt = buildEnhancedSystemPrompt(null, mockAgentContext());
      expect(prompt).toContain("outputs high-fidelity IMAGE assets");
      expect(prompt).toContain("not page-structure JSON");
    });
  });

  describe("Image Generation Rules", () => {
    it("explains count vs prompts distinction", () => {
      const prompt = buildEnhancedSystemPrompt(null, mockAgentContext());
      expect(prompt).toContain("Different Types (use prompts:[...])");
      expect(prompt).toContain("Similar Samples (use count + single prompt)");
      expect(prompt).toContain("三种不同类型");
      expect(prompt).toContain("生成3张差不多的");
    });

    it("includes tool approval flow", () => {
      const prompt = buildEnhancedSystemPrompt(null, mockAgentContext());
      expect(prompt).toContain("Tool Approval Flow");
      expect(prompt).toContain("UI renders an approval card");
      expect(prompt).toContain("NEVER show prompt preview in text");
    });

    it("includes reference image handling", () => {
      const prompt = buildEnhancedSystemPrompt(null, mockAgentContext());
      expect(prompt).toContain("Reference Image Handling");
      expect(prompt).toContain("User attached refs");
      expect(prompt).toContain("cited canvas asset");
    });
  });

  describe("Optional Sections", () => {
    it("includes skill section when skill is present", () => {
      const ctx = mockAgentContext();
      ctx.skill = {
        sourcePath: "skills/test-skill/SKILL.md",
        raw: "Test skill instructions",
        origin: "builtin",
        enabled: true,
        manifest: SkillManifestSchema.parse({
          name: "test-skill",
          description: "Test skill",
          kind: "prototype",
          version: "1.0.0",
          output: { artifact: "canvas-pages", defaultPageSize: { width: 1920, height: 1080 } },
          agent: { repairThreshold: 8 },
        }),
        body: "Test skill instructions",
      };

      const prompt = buildEnhancedSystemPrompt(null, ctx);
      expect(prompt).toContain("# Design Skill");
      expect(prompt).toContain("Test skill instructions");
    });

    it("includes design system when present", () => {
      const ctx = mockAgentContext();
      ctx.designSystem = {
        sourcePath: "design-systems/test-system/DESIGN.md",
        manifest: DesignSystemManifestSchema.parse({
          name: "test-system",
          description: "Test design system",
          atmosphere: "Calm",
          version: "1.0.0",
        }),
        body: "Test design system guidelines",
      };

      const prompt = buildEnhancedSystemPrompt(null, ctx);
      expect(prompt).toContain("# Design System: test-system");
      expect(prompt).toContain("Test design system guidelines");
    });

    it("includes brand kit when present in project", () => {
      const project = {
        id: "test",
        title: "Test Project",
        brandKit: {
          id: "test-brand",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          name: "Test Brand",
          colors: [
            { name: "Primary", value: "#0066FF", usage: "CTA buttons" },
            { name: "Secondary", value: "#FF6600" },
          ],
          typography: {
            heading: "Inter Bold",
            body: "Inter Regular",
          },
        },
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const prompt = buildEnhancedSystemPrompt(project as unknown as ProjectFile, mockAgentContext());
      expect(prompt).toContain("# Brand Kit: Test Brand");
      expect(prompt).toContain("Primary: #0066FF (CTA buttons)");
      expect(prompt).toContain("Heading: Inter Bold");
    });

    it("includes workspace rules when provided", () => {
      const rules = "Custom workspace rule: Always use dark mode";
      const prompt = buildEnhancedSystemPrompt(null, mockAgentContext(), rules);
      expect(prompt).toContain("## Workspace Rules");
      expect(prompt).toContain(rules);
    });
  });

  describe("Prompt Structure", () => {
    it("uses proper section separators", () => {
      const prompt = buildEnhancedSystemPrompt(null, mockAgentContext());
      // 各章节应该用 --- 分隔
      expect(prompt.split("\n---\n").length).toBeGreaterThan(5);
    });

    it("is comprehensive enough", () => {
      const prompt = buildEnhancedSystemPrompt(null, mockAgentContext());
      // 系统提示词应该足够长，包含完整的指导
      expect(prompt.length).toBeGreaterThan(3000);
    });

    it("includes all critical keywords", () => {
      const prompt = buildEnhancedSystemPrompt(null, mockAgentContext());
      const keywords = [
        "ReAct",
        "Thought",
        "Action",
        "Observation",
        "generate_brief",
        "plan_design_direction",
        "confirm_direction",
        "generate_images",
        "ask_discovery",
      ];

      for (const keyword of keywords) {
        expect(prompt).toContain(keyword);
      }
    });
  });
});
