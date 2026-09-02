/**
 * create_skill - 根据用户需求自动生成并保存新的 Skill
 * --------------------------------------------------------------
 */

import { z } from "zod";
import type { AgentTool, ToolContext, ToolResult } from "./types";
import { parseSkillDocument, writeUserSkillDocument } from "@/lib/skills/storage";

export const createSkillTool: AgentTool = {
  name: "create_skill",
  description: "根据用户需求自动生成并保存一个新的 Skill（SKILL.md 文件）到 .vad/skills/",
  parameters: {
    type: "object",
    properties: {
      idea: {
        type: "string",
        description: "用户原始需求描述",
      },
      rawMarkdown: {
        type: "string",
        description: "完整的 SKILL.md 内容（frontmatter + body）",
      },
    },
    required: ["idea", "rawMarkdown"],
  },
  execute: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const { idea, rawMarkdown } = args as { idea: string; rawMarkdown: string };
    try {
      // 解析并验证 SKILL.md
      const parsed = parseSkillDocument(rawMarkdown);

      // 保存到用户技能目录
      const created = await writeUserSkillDocument(rawMarkdown, {
        userSkillsDir: ".vad/skills",
      });

      return {
        summary: `✅ Skill 已创建：${created.manifest.description}`,
        data: {
          success: true,
          skillId: created.manifest.name,
          path: `.vad/skills/${created.manifest.name}/SKILL.md`,
          manifest: created.manifest,
          note: idea,
        },
        fileWrites: [`.vad/skills/${created.manifest.name}/SKILL.md`],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "未知错误";
      console.error("[create_skill] 失败", { error: errorMessage, idea });
      return {
        summary: `❌ Skill 创建失败：${errorMessage}`,
        data: {
          success: false,
          error: errorMessage,
          note: idea,
        },
      };
    }
  },
};
