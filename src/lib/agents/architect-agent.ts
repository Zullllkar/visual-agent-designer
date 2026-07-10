/**
 * Product Architect Agent
 * --------------------------------------------------------------
 * 根据 Brief 产出信息架构：用户流、页面清单、每页目标。
 * 为 Layout Agent 提供页面范围约束。
 *
 * @author：wangjunhua
 */

import { z } from "zod";
import type { Agent } from "./types";
import type { ProductBrief, ProductArchitecture } from "@/lib/project/schema";
import { ProductArchitectureSchema } from "@/lib/project/schema";
import { stripJsonFence } from "@/lib/providers/llm/openai-compatible";
import { isMockLlmText } from "@/lib/providers/llm/utils";
import { buildSystemPrompt } from "@/lib/skills/prompt-stack";

const ARCHITECT_OUTPUT_SHAPE = `# 输出 JSON
\`\`\`json
{
  "userFlows": ["首次启动 → 主功能 → 设置"],
  "pages": [
    { "id": "home", "name": "首页", "purpose": "一句话说明该页目标", "priority": "primary" }
  ],
  "summary": "一两句信息架构总述"
}
\`\`\`
严格 JSON，不要 markdown 围栏。`;

export const ArchitectAgent: Agent<
  { brief: ProductBrief },
  ProductArchitecture
> = {
  name: "architect-agent",
  async run({ brief }, ctx) {
    const fromLlm = await tryLlmArchitecture(brief, ctx).catch(() => null);
    if (fromLlm) return fromLlm;
    return heuristicArchitecture(brief, ctx);
  },
};

async function tryLlmArchitecture(
  brief: ProductBrief,
  ctx: import("./types").AgentContext
): Promise<ProductArchitecture | null> {
  const pageCount = ctx.skill?.manifest.output.pageCountHint ?? 3;
  const system = buildSystemPrompt({
    skill: ctx.skill,
    designSystem: ctx.designSystem,
    brief,
    technicalAddendum: [
      "# 任务：Product Architect",
      "根据 Brief 设计信息架构，不要画 UI，只输出页面清单与用户流。",
      `建议 ${pageCount} 个页面，与平台 ${brief.platform} 匹配。`,
      ARCHITECT_OUTPUT_SHAPE,
    ].join("\n\n"),
  });

  const out = await ctx.providers.llm.generateText({
    system,
    prompt: `为产品「${brief.productName}」设计信息架构，输出 JSON：`,
    schema: { type: "object" },
  });

  if (isMockLlmText(out.text)) return null;

  let json: unknown;
  try {
    json = JSON.parse(stripJsonFence(out.text));
  } catch {
    return null;
  }
  const parsed = ProductArchitectureSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

function heuristicArchitecture(
  brief: ProductBrief,
  ctx: import("./types").AgentContext
): ProductArchitecture {
  const hint = ctx.skill?.manifest.output.pageCountHint ?? 3;
  const names =
    hint <= 1
      ? [{ id: "home", name: "首页", purpose: brief.positioning, priority: "primary" as const }]
      : [
          { id: "home", name: "首页", purpose: "展示价值主张与核心 CTA", priority: "primary" as const },
          {
            id: "features",
            name: "功能",
            purpose: `呈现：${brief.coreFeatures.slice(0, 3).join("、")}`,
            priority: "primary" as const,
          },
          {
            id: "settings",
            name: "设置",
            purpose: "账户与偏好",
            priority: "utility" as const,
          },
        ].slice(0, hint);

  return ProductArchitectureSchema.parse({
    userFlows: ["首次启动 → 主功能 → 设置"],
    pages: names,
    summary: `${brief.productName}：${brief.positioning}`,
  });
}
