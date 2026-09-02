import type { Agent } from "./types";
import { ProductBriefSchema, type ProductBrief } from "@/lib/project/schema";
import { stripJsonFence } from "@/lib/providers/llm/openai-compatible";
import { isMockLlmText } from "@/lib/providers/llm/utils";
import { buildBriefSystemPrompt } from "@/lib/skills/prompt-stack";
import {
  heuristicBriefForTarget,
  mergeBriefWithTargetSlots,
} from "@/lib/targets/brief";
import { parseTargetId, type TargetId } from "@/lib/targets/resolve";

/**
 * BriefAgent
 * --------------------------------------------------------------
 * 把用户一句话想法翻译成结构化 ProductBrief。
 * 字段按 project.targetId 裁剪：游戏原画存资产/渲染/世界观，不写落地页 vs App。
 *
 * 优先调用 ctx.providers.llm 走真实模型；如果模型输出无法被 schema 校验，
 * 则回退到启发式规则版本，保证整条 pipeline 永远能产出可用结果。
 */
export const BriefAgent: Agent<{ idea: string; targetId?: string }, ProductBrief> = {
  name: "brief-agent",
  async run({ idea, targetId }, ctx) {
    const id = parseTargetId(targetId);
    const llmBrief = await tryLlmBrief(idea, id, ctx).catch(() => null);
    if (llmBrief) return mergeBriefWithTargetSlots(llmBrief, idea, id);
    return heuristicBriefForTarget(idea, id);
  },
};

async function tryLlmBrief(
  idea: string,
  targetId: TargetId,
  ctx: import("./types").AgentContext
): Promise<ProductBrief | null> {
  const system = buildBriefSystemPrompt({
    skill: ctx.skill,
    designSystem: ctx.designSystem,
    targetId,
  });
  const out = await ctx.providers.llm.generateText({
    system,
    prompt: `用户想法："""${idea.trim()}"""\n当前目标：${targetId}\n输出 JSON：`,
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
