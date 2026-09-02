/**
 * SkillGeneratorAgent 单元测试
 */

import { describe, expect, it } from "vitest";
import { SkillKindSchema } from "@/lib/skills/schema";
import { parseSkillDocument } from "@/lib/skills/storage";
import {
  buildGeneratedSkillDocument,
  deriveSkillKindFromIdea,
  deriveSkillNameFromIdea,
  runSkillGeneratorAgent,
  skillBodyTemplateForKind,
} from "./skill-generator-agent";

describe("SkillGeneratorAgent", () => {
  describe("deriveSkillKindFromIdea", () => {
    it("should detect xhs kind from '小红书封面生成'", () => {
      const result = deriveSkillKindFromIdea("小红书封面生成");
      expect(result).toBe("xhs");
    });

    it("should detect xhs kind from 'xhs cover'", () => {
      const result = deriveSkillKindFromIdea("xhs cover");
      expect(result).toBe("xhs");
    });

    it("should detect landing kind from '落地页'", () => {
      const result = deriveSkillKindFromIdea("SaaS 落地页生成");
      expect(result).toBe("landing");
    });

    it("should detect landing kind from 'landing page'", () => {
      const result = deriveSkillKindFromIdea("create a landing page");
      expect(result).toBe("landing");
    });

    it("should detect game-art kind from '游戏素材'", () => {
      const result = deriveSkillKindFromIdea("游戏角色概念设计");
      expect(result).toBe("game-art");
    });

    it("should detect prototype kind from 'APP 原型'", () => {
      const result = deriveSkillKindFromIdea("移动 APP 原型");
      expect(result).toBe("prototype");
    });

    it("should default to prototype", () => {
      const result = deriveSkillKindFromIdea("随便说点啥");
      expect(result).toBe("prototype");
    });
  });

  describe("deriveSkillNameFromIdea", () => {
    it("should create name for xhs skill", () => {
      const result = deriveSkillNameFromIdea("小红书封面生成技能");
      expect(result).toMatch(/xhs/);
      expect(result).toContain("-");
    });

    it("should create name for landing skill", () => {
      const result = deriveSkillNameFromIdea("创建 saas 落地页");
      expect(result).toMatch(/landing/);
      expect(result).toContain("-");
    });

    it("uses latin tokens as the skill name prefix", () => {
      const result = deriveSkillNameFromIdea("zzz");
      expect(result).toEqual("zzz-prototype");
    });
  });

  describe("skillBodyTemplateForKind", () => {
    it("emits image recipes for every kind", () => {
      for (const kind of SkillKindSchema.options) {
        const body = skillBodyTemplateForKind(kind);
        expect(body).toMatch(/P0/);
        expect(body).not.toMatch(/layout 工具产出/);
        expect(body).not.toMatch(/CanvasPage Schema/);
      }
    });
  });

  describe("runSkillGeneratorAgent", () => {
    it("builds a parseable xhs skill document", () => {
      const { manifest, markdown } = buildGeneratedSkillDocument("帮我创建一个小红书封面生成技能");
      expect(manifest.kind).toBe("xhs");
      expect(manifest.output.defaultPageSize).toEqual({ width: 1080, height: 1440 });
      expect(manifest.recommendedDesignSystem).toBe("xhs-style");
      expect(markdown).not.toMatch(/CanvasPage Schema/);
      expect(parseSkillDocument(markdown).manifest.kind).toBe("xhs");
    });

    it("reports when create_skill is not registered", async () => {
      const result = await runSkillGeneratorAgent("帮我创建一个小红书封面生成技能");
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/未知工具|失败/);
    }, 10000);

    it("should handle error gracefully", async () => {
      const result = await runSkillGeneratorAgent("");
      expect(typeof result.success === "boolean").toBe(true);
      expect(typeof result.message === "string").toBe(true);
    }, 10000);
  });
});
