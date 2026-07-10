import type { Agent } from "./types";
import { ProductBriefSchema, type ProductBrief } from "@/lib/project/schema";
import { stripJsonFence } from "@/lib/providers/llm/openai-compatible";
import { isMockLlmText } from "@/lib/providers/llm/utils";
import { buildBriefSystemPrompt } from "@/lib/skills/prompt-stack";

/**
 * BriefAgent
 * --------------------------------------------------------------
 * 把用户一句话想法翻译成结构化 ProductBrief。
 *
 * 优先调用 ctx.providers.llm 走真实模型；如果模型输出无法被 schema 校验，
 * 则回退到启发式规则版本，保证整条 pipeline 永远能产出可用结果。
 */
export const BriefAgent: Agent<{ idea: string }, ProductBrief> = {
  name: "brief-agent",
  async run({ idea }, ctx) {
    // 1) 先尝试真实 LLM（带 active skill / design-system 注入）
    const llmBrief = await tryLlmBrief(idea, ctx).catch(() => null);
    if (llmBrief) return llmBrief;

    // 2) 启发式回退
    return heuristicBrief(idea);
  },
};

async function tryLlmBrief(
  idea: string,
  ctx: import("./types").AgentContext
): Promise<ProductBrief | null> {
  const system = buildBriefSystemPrompt({
    skill: ctx.skill,
    designSystem: ctx.designSystem,
  });
  const out = await ctx.providers.llm.generateText({
    system,
    prompt: `用户想法："""${idea.trim()}"""\n输出 JSON：`,
    schema: { type: "object" },
  });

  if (isMockLlmText(out.text)) return null;

  let json: unknown;
  try {
    json = JSON.parse(stripJsonFence(out.text));
  } catch {
    return null;
  }
  const parsed = ProductBriefSchema.safeParse(json);
  if (!parsed.success) return null;
  return parsed.data;
}

/* ────────────── 启发式 fallback ────────────── */

function heuristicBrief(idea: string): ProductBrief {
  const lower = idea.toLowerCase();
  return {
    productName: inferProductName(idea),
    positioning: idea.trim(),
    targetUser: lower.includes("学生")
      ? "学生群体"
      : lower.includes("开发")
        ? "独立开发者"
        : "通用用户",
    scenarios: [
      "用户首次打开产品并完成引导",
      "核心任务的快速操作",
      "查看历史与个人设置",
    ],
    coreFeatures: extractFeatures(idea),
    platform: pickPlatform(lower),
    visualStyle: pickStyle(lower),
    outputTargets: ["cursor", "claude-code", "markdown"],
  };
}

function pickPlatform(lower: string): ProductBrief["platform"] {
  if (lower.includes("小程序") || lower.includes("miniapp")) return "miniapp";
  if (lower.includes("插件") || lower.includes("extension")) return "extension";
  if (lower.includes("官网") || lower.includes("landing")) return "landing";
  if (lower.includes("web") || lower.includes("网页") || lower.includes("dashboard"))
    return "web";
  return "app";
}

function pickStyle(lower: string): string {
  if (lower.includes("高端") || lower.includes("saas")) return "modern minimal SaaS";
  if (lower.includes("年轻") || lower.includes("生活")) return "bright lifestyle";
  if (lower.includes("ai") || lower.includes("智能")) return "calm AI productivity";
  return "clean modern product";
}

function inferProductName(idea: string): string {
  const m = idea.match(/(?:做一个|开发一个|想做)([\s\S]{2,12}?)(?:的|，|。|$)/);
  return m ? m[1].trim() : idea.slice(0, 8);
}

function extractFeatures(idea: string): string[] {
  const parts = idea
    .split(/[，,。.;；]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length >= 2) return parts.slice(0, 4);
  return ["核心功能 A", "核心功能 B", "核心功能 C"];
}
