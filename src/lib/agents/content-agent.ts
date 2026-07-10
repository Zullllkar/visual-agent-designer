/**
 * Content Agent
 * --------------------------------------------------------------
 * 在 Layout 之后润色文案：text / button / card 节点内容，
 * 不改变几何布局；生图仍由 Image Executor 负责。
 *
 * @author：wangjunhua
 */

import { z } from "zod";
import type { Agent } from "./types";
import type { ProductBrief } from "@/lib/project/schema";
import type { CanvasPage, CanvasNode } from "@/lib/canvas/schema";
import { stripJsonFence } from "@/lib/providers/llm/openai-compatible";
import { isMockLlmText } from "@/lib/providers/llm/utils";
import { buildSystemPrompt } from "@/lib/skills/prompt-stack";
import { readContentPrefs } from "./content-preferences";
import { readDesignContextFromScratch } from "@/lib/project/design-context";

const ContentPatchSchema = z.object({
  updates: z.array(
    z.object({
      pageId: z.string(),
      nodes: z.array(
        z.object({
          nodeId: z.string(),
          content: z.string().optional(),
          label: z.string().optional(),
          title: z.string().optional(),
          body: z.string().optional(),
        })
      ),
    })
  ),
});

const CONTENT_OUTPUT_SHAPE = `# 输出 JSON
\`\`\`json
{
  "updates": [
    {
      "pageId": "home",
      "nodes": [
        { "nodeId": "<id>", "content": "润色后的文案" },
        { "nodeId": "<id>", "label": "按钮文案" },
        { "nodeId": "<id>", "title": "卡片标题", "body": "卡片正文" }
      ]
    }
  ]
}
\`\`\`
只修改需要润色的节点；严格 JSON。`;

export const ContentAgent: Agent<
  { brief: ProductBrief; pages: CanvasPage[] },
  CanvasPage[]
> = {
  name: "content-agent",
  async run({ brief, pages }, ctx) {
    const patched = await tryLlmPolish(brief, pages, ctx).catch(() => null);
    if (patched) return patched;
    return pages;
  },
};

async function tryLlmPolish(
  brief: ProductBrief,
  pages: CanvasPage[],
  ctx: import("./types").AgentContext
): Promise<CanvasPage[] | null> {
  const digest = pages.map((p) => ({
    pageId: p.id,
    name: p.name,
    nodes: p.nodes
      .filter((n) => n.type === "text" || n.type === "button" || n.type === "card")
      .map((n) => ({
        nodeId: n.id,
        type: n.type,
        ...(n.type === "text"
          ? { content: n.content }
          : n.type === "button"
            ? { label: n.label }
            : { title: n.title, body: n.body }),
      })),
  }));

  const prefs = readContentPrefs(ctx.scratch);
  const system = buildSystemPrompt({
    skill: ctx.skill,
    designSystem: ctx.designSystem,
    brief,
    designContext: readDesignContextFromScratch(ctx.scratch),
    extra: { pagesDigest: digest, contentPrefs: prefs },
    technicalAddendum: [
      "# 任务：Content Agent",
      "润色 UI 文案，使其专业、具体、符合 brief；禁止 Lorem 与占位符。",
      "不要修改坐标与尺寸。",
      `# 文案偏好\n${prefs.directives}`,
      CONTENT_OUTPUT_SHAPE,
    ].join("\n\n"),
  });

  const out = await ctx.providers.llm.generateText({
    system,
    prompt: `润色以下页面的文案，输出 JSON：`,
    schema: { type: "object" },
  });

  if (isMockLlmText(out.text)) return null;

  let json: unknown;
  try {
    json = JSON.parse(stripJsonFence(out.text));
  } catch {
    return null;
  }

  const parsed = ContentPatchSchema.safeParse(json);
  if (!parsed.success) return null;

  return applyContentPatches(pages, parsed.data.updates);
}

function applyContentPatches(
  pages: CanvasPage[],
  updates: z.infer<typeof ContentPatchSchema>["updates"]
): CanvasPage[] {
  const byPage = new Map(updates.map((u) => [u.pageId, u.nodes]));

  return pages.map((page) => {
    const nodePatches = byPage.get(page.id);
    if (!nodePatches?.length) return page;

    const patchMap = new Map(nodePatches.map((n) => [n.nodeId, n]));
    const nodes: CanvasNode[] = page.nodes.map((node) => {
      const patch = patchMap.get(node.id);
      if (!patch) return node;
      if (node.type === "text" && patch.content !== undefined) {
        return { ...node, content: patch.content, source: "content-agent" };
      }
      if (node.type === "button" && patch.label !== undefined) {
        return { ...node, label: patch.label, source: "content-agent" };
      }
      if (node.type === "card") {
        return {
          ...node,
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.body !== undefined ? { body: patch.body } : {}),
          source: "content-agent",
        };
      }
      return node;
    });

    return { ...page, nodes };
  });
}
