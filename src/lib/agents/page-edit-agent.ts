/**
 * PageEditAgent
 * --------------------------------------------------------------
 * 对指定页面/元素执行自然语言最小编辑，不依赖 critique。
 */

import { z } from "zod";
import type { Agent, AgentContext } from "./types";
import type { ProductBrief } from "@/lib/project/schema";
import {
  CanvasPageSchema,
  type CanvasNode,
  type CanvasPage,
} from "@/lib/canvas/schema";
import { stripJsonFence } from "@/lib/providers/llm/openai-compatible";
import { isMockLlmText } from "@/lib/providers/llm/utils";
import { buildSystemPrompt } from "@/lib/skills/prompt-stack";
import { readDesignContextFromScratch } from "@/lib/project/design-context";

const PageEditPatchSchema = z.object({
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

type PageEditPatch = z.infer<typeof PageEditPatchSchema>;

const EDIT_OUTPUT_SHAPE = `# Page Edit Patch 输出 JSON
\`\`\`json
{
  "operations": [
    { "op": "updatePage", "patch": { "name": "...", "background": "#..." } },
    { "op": "updateNode", "nodeId": "<现有节点 id>", "patch": { "content": "...", "fill": "#...", "x": 12 } },
    { "op": "deleteNode", "nodeId": "<现有节点 id>" }
  ]
}
\`\`\`
严格 JSON，不要 markdown。`;

export const PageEditAgent: Agent<
  {
    brief: ProductBrief;
    page: CanvasPage;
    instruction: string;
    targetNodeId?: string;
    targetNodeLabel?: string;
  },
  CanvasPage | null
> = {
  name: "page-edit-agent",
  async run({ brief, page, instruction, targetNodeId, targetNodeLabel }, ctx) {
    const targetNode = targetNodeId
      ? page.nodes.find((node) => node.id === targetNodeId) ?? null
      : null;

    const llmPage = await tryLlmEdit(
      { brief, page, instruction, targetNode, targetNodeLabel },
      ctx
    ).catch(() => null);
    if (llmPage) return llmPage;

    return heuristicEdit(page, instruction, targetNode);
  },
};

async function tryLlmEdit(
  input: {
    brief: ProductBrief;
    page: CanvasPage;
    instruction: string;
    targetNode: CanvasNode | null;
    targetNodeLabel?: string;
  },
  ctx: AgentContext
): Promise<CanvasPage | null> {
  const system = buildSystemPrompt({
    skill: ctx.skill,
    designSystem: ctx.designSystem,
    brief: input.brief,
    designContext: readDesignContextFromScratch(ctx.scratch),
    extra: {
      instruction: input.instruction,
      currentPage: input.page,
      targetNode: input.targetNode,
      targetNodeLabel: input.targetNodeLabel,
    },
    technicalAddendum: [
      "# 任务：Page Edit Agent",
      "按用户 instruction 对当前页做最小必要修改。",
      "优先 updateNode，只有用户明确要求删除时才 deleteNode。",
      "只能引用 currentPage.nodes 中已经存在的 nodeId。",
      "updateNode.patch 不要包含 id / type。",
      "保持页面 width/height 不变，节点必须留在页面边界内。",
      "如果用户引用了 targetNode，优先只改该节点；不要顺手重排整页。",
      EDIT_OUTPUT_SHAPE,
    ].join("\n\n"),
  });

  const out = await ctx.providers.llm.generateText({
    system,
    prompt: `执行页面编辑指令：${input.instruction}`,
    schema: { type: "object" },
  });

  if (isMockLlmText(out.text)) return null;

  let json: unknown;
  try {
    json = JSON.parse(stripJsonFence(out.text));
  } catch {
    return null;
  }

  const parsed = PageEditPatchSchema.safeParse(json);
  if (!parsed.success) return null;
  return applyPageEditPatch(input.page, parsed.data);
}

function heuristicEdit(
  page: CanvasPage,
  instruction: string,
  targetNode: CanvasNode | null
): CanvasPage | null {
  if (!targetNode) return null;

  const textValue = inferQuotedText(instruction);
  const colorValue = instruction.match(/#[0-9a-fA-F]{3,8}\b/)?.[0];
  const patch: Record<string, unknown> = {};

  if (textValue) {
    if (targetNode.type === "text") patch.content = textValue;
    else if (targetNode.type === "button") patch.label = textValue;
    else if (targetNode.type === "card") patch.title = textValue;
  }

  if (colorValue) {
    if (targetNode.type === "text") patch.color = colorValue;
    else if (
      targetNode.type === "button" ||
      targetNode.type === "card" ||
      targetNode.type === "frame"
    ) {
      patch.fill = colorValue;
    }
  }

  if (Object.keys(patch).length === 0) return null;
  return applyPageEditPatch(page, {
    operations: [{ op: "updateNode", nodeId: targetNode.id, patch }],
  });
}

function inferQuotedText(instruction: string): string | null {
  const quoted = instruction.match(/[「“"]([^」”"]{1,80})[」”"]/);
  if (quoted) return quoted[1].trim();
  const changed = instruction.match(/(?:改成|改为|换成|替换为)\s*([^，。,.]{1,80})/);
  return changed?.[1]?.trim() || null;
}

function applyPageEditPatch(
  page: CanvasPage,
  patch: PageEditPatch
): CanvasPage | null {
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

  if (!nodesStayInBounds(next)) return null;
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
    source: "page-edit-agent",
  } as CanvasNode;
}

function nodesStayInBounds(page: CanvasPage): boolean {
  return page.nodes.every(
    (node) =>
      node.width > 0 &&
      node.height > 0 &&
      node.x >= 0 &&
      node.y >= 0 &&
      node.x + node.width <= page.width &&
      node.y + node.height <= page.height
  );
}
