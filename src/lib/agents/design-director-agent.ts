/**
 * Design Director Agent
 * --------------------------------------------------------------
 * 在 Brief + 信息架构基础上，产出视觉方向摘要，约束 Layout / 生图 prompt。
 *
 * @author：wangjunhua
 */

import { z } from "zod";
import type { Agent } from "./types";
import type {
  ProductBrief,
  ProductArchitecture,
  DesignDirection,
} from "@/lib/project/schema";
import { DesignDirectionSchema } from "@/lib/project/schema";
import { stripJsonFence } from "@/lib/providers/llm/openai-compatible";
import { isMockLlmText } from "@/lib/providers/llm/utils";
import { buildSystemPrompt } from "@/lib/skills/prompt-stack";

const DIRECTOR_OUTPUT_SHAPE = `# 输出 JSON
\`\`\`json
{
  "summary": "视觉方向一段话",
  "moodKeywords": ["minimal", "dark"],
  "typographyNotes": "标题与正文字号层次",
  "layoutNotes": "栅格、留白、圆角风格",
  "recommendedDesignSystemId": "linear-like"
}
\`\`\`
严格 JSON，不要 markdown 围栏。recommendedDesignSystemId 可选。`;

export const DesignDirectorAgent: Agent<
  { brief: ProductBrief; architecture?: ProductArchitecture | null },
  DesignDirection
> = {
  name: "design-director-agent",
  async run({ brief, architecture }, ctx) {
    const fromLlm = await tryLlmDirection(brief, architecture, ctx).catch(
      () => null
    );
    if (fromLlm) return fromLlm;
    return heuristicDirection(brief, ctx);
  },
};

async function tryLlmDirection(
  brief: ProductBrief,
  architecture: ProductArchitecture | null | undefined,
  ctx: import("./types").AgentContext
): Promise<DesignDirection | null> {
  const system = buildSystemPrompt({
    skill: ctx.skill,
    designSystem: ctx.designSystem,
    brief,
    extra: architecture ? { architecture } : undefined,
    targetId:
      typeof ctx.scratch.targetId === "string" ? ctx.scratch.targetId : undefined,
    technicalAddendum: [
      "# 任务：Design Director",
      "定义视觉方向，遵循 active DESIGN.md；不要输出 Canvas 节点。",
      DIRECTOR_OUTPUT_SHAPE,
    ].join("\n\n"),
  });

  const out = await ctx.providers.llm.generateText({
    system,
    prompt: `为「${brief.productName}」定义视觉方向，输出 JSON：`,
    schema: { type: "object" },
  });

  if (isMockLlmText(out.text)) return null;

  let json: unknown;
  try {
    json = JSON.parse(stripJsonFence(out.text));
  } catch {
    return null;
  }
  const parsed = DesignDirectionSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

function heuristicDirection(
  brief: ProductBrief,
  ctx: import("./types").AgentContext
): DesignDirection {
  const recommended =
    ctx.designSystem?.manifest.name ??
    ctx.skill?.manifest.recommendedDesignSystem ??
    "linear-like";

  return DesignDirectionSchema.parse({
    summary: brief.visualStyle,
    moodKeywords: brief.visualStyle
      .split(/[,，、\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 6),
    typographyNotes: "标题 22-32px，正文 14-16px，说明 11-12px",
    layoutNotes: "充足留白，卡片圆角 12-16px，主 CTA 使用品牌主色",
    recommendedDesignSystemId: recommended,
  });
}
