/**
 * RepairAgent
 * --------------------------------------------------------------
 * 接收一页 CanvasPage 与该页的 CritiqueReport，让 LLM 输出修复版页面。
 * 失败返回 null，由 orchestrator 决定是否继续用原页。
 *
 * 与 LayoutAgent 的差别：
 *   - 输入是单页（不是 brief → 多页）
 *   - 修复目标驱动 prompt（issues 列表 + 改进建议）
 *   - 输出 schema 是单页 LlmCanvasPage（不是 LlmLayoutOutput）
 */

import type { Agent, AgentContext } from "./types";
import { z } from "zod";
import type { ProductBrief } from "@/lib/project/schema";
import {
  CanvasPageSchema,
  type CanvasNode,
  type CanvasPage,
} from "@/lib/canvas/schema";
import type { CritiqueReport } from "./critic-schema";
import { stripJsonFence } from "@/lib/providers/llm/openai-compatible";
import { isMockLlmText } from "@/lib/providers/llm/utils";
import { LlmCanvasPageSchema, type LlmCanvasPage } from "@/lib/canvas/llm-schema";
import { materializePage } from "@/lib/canvas/materialize";
import {
  buildRepairPatchSystemPrompt,
  buildRepairSystemPrompt,
} from "@/lib/skills/prompt-stack";
import { readDesignContextFromScratch } from "@/lib/project/design-context";

const RepairPatchSchema = z.object({
  operations: z.array(
    z.discriminatedUnion("op", [
      z.object({
        op: z.literal("updatePage"),
        patch: z
          .object({
            name: z.string().optional(),
            background: z.string().optional(),
          })
          .strict(),
      }),
      z.object({
        op: z.literal("updateNode"),
        nodeId: z.string(),
        patch: z.record(z.string(), z.unknown()),
      }),
      z.object({
        op: z.literal("deleteNode"),
        nodeId: z.string(),
      }),
    ])
  ),
});

type RepairPatch = z.infer<typeof RepairPatchSchema>;

export const RepairAgent: Agent<
  { brief: ProductBrief; page: CanvasPage; report: CritiqueReport },
  CanvasPage | null
> = {
  name: "repair-agent",
  async run({ brief, page, report }, ctx) {
    if (report.issues.length === 0) return null;

    const patched = await tryLlmRepairPatch(brief, page, report, ctx).catch(
      () => null
    );
    if (patched) return patched;

    const llmPage = await tryLlmRepair(brief, page, report, ctx).catch(
      () => null
    );
    if (!llmPage) return null;

    return materializePage(llmPage, brief, ctx.providers.image, {
      source: "repair-agent-llm",
      pageId: page.id, // 保留原 id 让 critic / UI 能对齐
      fallbackId: page.id,
    });
  },
};

async function tryLlmRepairPatch(
  brief: ProductBrief,
  page: CanvasPage,
  report: CritiqueReport,
  ctx: AgentContext
): Promise<CanvasPage | null> {
  const system = buildRepairPatchSystemPrompt({
    skill: ctx.skill,
    designSystem: ctx.designSystem,
    brief,
    designContext: readDesignContextFromScratch(ctx.scratch),
    page,
    report,
  });
  const out = await ctx.providers.llm.generateText({
    system,
    prompt: `输出最小 RepairPatch JSON（评分 ${report.score}/10 → 目标 ≥8）：`,
    schema: { type: "object" },
  });

  if (isMockLlmText(out.text)) return null;

  let json: unknown;
  try {
    json = JSON.parse(stripJsonFence(out.text));
  } catch {
    return null;
  }
  const parsed = RepairPatchSchema.safeParse(json);
  if (!parsed.success) return null;
  return applyRepairPatch(page, parsed.data);
}

async function tryLlmRepair(
  brief: ProductBrief,
  page: CanvasPage,
  report: CritiqueReport,
  ctx: AgentContext
): Promise<LlmCanvasPage | null> {
  // 所有现场上下文（当前页 / issues / summary）都被 buildRepairSystemPrompt
  // 当作 extra 内嵌进 system，这样 user prompt 只需一句触发。
  const system = buildRepairSystemPrompt({
    skill: ctx.skill,
    designSystem: ctx.designSystem,
    brief,
    designContext: readDesignContextFromScratch(ctx.scratch),
    page,
    report,
  });
  const out = await ctx.providers.llm.generateText({
    system,
    prompt: `输出修复后的单页 LlmCanvasPage JSON（评分 ${report.score}/10 → 目标 ≥8）：`,
    schema: { type: "object" },
  });

  if (isMockLlmText(out.text)) return null;

  let json: unknown;
  try {
    json = JSON.parse(stripJsonFence(out.text));
  } catch {
    return null;
  }
  const parsed = LlmCanvasPageSchema.safeParse(json);
  if (!parsed.success) return null;
  return parsed.data;
}

function applyRepairPatch(page: CanvasPage, patch: RepairPatch): CanvasPage | null {
  let next: CanvasPage = JSON.parse(JSON.stringify(page)) as CanvasPage;

  for (const op of patch.operations) {
    if (op.op === "updatePage") {
      next = {
        ...next,
        ...op.patch,
        id: page.id,
        width: page.width,
        height: page.height,
      };
      continue;
    }

    if (op.op === "deleteNode") {
      next = {
        ...next,
        nodes: next.nodes.filter((node) => node.id !== op.nodeId),
      };
      continue;
    }

    const nodeExists = next.nodes.some((node) => node.id === op.nodeId);
    if (!nodeExists) return null;

    next = {
      ...next,
      nodes: next.nodes.map((node) =>
        node.id === op.nodeId ? patchNode(node, op.patch) : node
      ),
    };
  }

  const parsed = CanvasPageSchema.safeParse(next);
  return parsed.success ? parsed.data : null;
}

function patchNode(
  node: CanvasNode,
  patch: Record<string, unknown>
): CanvasNode {
  const { id, type, ...safePatch } = patch;
  void id;
  void type;
  return {
    ...node,
    ...safePatch,
    id: node.id,
    type: node.type,
  } as CanvasNode;
}
