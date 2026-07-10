/**
 * Image Planner Agent
 * --------------------------------------------------------------
 * 扫描 Canvas 页面中的 image 节点（含 pending 占位），
 * 为每个节点生成/优化生图 prompt 计划，供 Image Executor 调用生图模型。
 *
 * @author：wangjunhua
 */

import { z } from "zod";
import type { Agent } from "./types";
import type { ProductBrief, DesignDirection } from "@/lib/project/schema";
import type { CanvasPage } from "@/lib/canvas/schema";
import { stripJsonFence } from "@/lib/providers/llm/openai-compatible";
import { isMockLlmText } from "@/lib/providers/llm/utils";
import { buildSystemPrompt } from "@/lib/skills/prompt-stack";
import { readDesignContextFromScratch } from "@/lib/project/design-context";

export const ImagePlanTaskSchema = z.object({
  pageId: z.string(),
  nodeId: z.string(),
  imagePrompt: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  role: z
    .enum(["hero", "illustration", "product-shot", "background", "avatar"])
    .optional(),
});

export const ImagePlanSchema = z.object({
  tasks: z.array(ImagePlanTaskSchema),
});

export type ImagePlan = z.infer<typeof ImagePlanSchema>;
export type ImagePlanTask = z.infer<typeof ImagePlanTaskSchema>;

const PLANNER_OUTPUT_SHAPE = `# 输出 JSON
\`\`\`json
{
  "tasks": [
    {
      "pageId": "home",
      "nodeId": "abc123",
      "imagePrompt": "English prompt for image model",
      "width": 640,
      "height": 480,
      "role": "hero"
    }
  ]
}
\`\`\`
严格 JSON。必须为每个待生成 image 节点各写一条 task。`;

export const ImagePlannerAgent: Agent<
  {
    brief: ProductBrief;
    pages: CanvasPage[];
    designDirection?: DesignDirection | null;
    /** 无页面结构时，直接按 Brief 规划独立视觉素材 */
    standaloneCount?: number;
  },
  ImagePlan
> = {
  name: "image-planner-agent",
  async run({ brief, pages, designDirection, standaloneCount }, ctx) {
    const pending = collectPendingImageNodes(pages);
    if (pending.length === 0) {
      // Lovart 式：不依赖网页结构，直接为画布规划独立生图任务
      return planStandaloneAssets(brief, designDirection, standaloneCount ?? 4);
    }

    const fromLlm = await tryLlmPlan(
      brief,
      pages,
      pending,
      designDirection,
      ctx
    ).catch(() => null);
    if (fromLlm && fromLlm.tasks.length > 0) return fromLlm;

    return heuristicPlan(brief, pending);
  },
};

/** 独立素材板：不挂在 canvas-page 节点上 */
export const STANDALONE_BOARD_ID = "asset-board";

function planStandaloneAssets(
  brief: ProductBrief,
  designDirection: DesignDirection | null | undefined,
  count: number
): ImagePlan {
  const n = Math.min(8, Math.max(2, count));
  const mood =
    designDirection?.moodKeywords?.slice(0, 4).join(", ") ||
    brief.visualStyle ||
    "modern, clean";
  const product = brief.productName || "product";
  const audience = brief.targetUser || "users";
  const roles = [
    "hero",
    "illustration",
    "product-shot",
    "background",
    "illustration",
    "product-shot",
    "hero",
    "avatar",
  ] as const;

  const sizes: Array<{ w: number; h: number }> = [
    { w: 1280, h: 720 },
    { w: 1024, h: 1024 },
    { w: 1024, h: 768 },
    { w: 768, h: 1024 },
  ];

  const tasks: ImagePlanTask[] = Array.from({ length: n }, (_, i) => {
    const role = roles[i % roles.length];
    const size = sizes[i % sizes.length];
    const focus =
      role === "hero"
        ? `hero visual for ${product}, cinematic composition`
        : role === "product-shot"
          ? `product UI detail shot for ${product}`
          : role === "background"
            ? `abstract brand background for ${product}`
            : `supporting illustration for ${product}`;
    return {
      pageId: STANDALONE_BOARD_ID,
      nodeId: `asset-${i + 1}`,
      imagePrompt: `${focus}, for ${audience}, ${mood}, high-fidelity design asset, no browser chrome, no code UI wireframe`,
      width: size.w,
      height: size.h,
      role,
    };
  });

  return { tasks };
}

interface PendingNode {
  pageId: string;
  nodeId: string;
  width: number;
  height: number;
  alt?: string;
  existingPrompt?: string;
}

function collectPendingImageNodes(pages: CanvasPage[]): PendingNode[] {
  const out: PendingNode[] = [];
  for (const page of pages) {
    for (const node of page.nodes) {
      if (node.type !== "image") continue;
      const needsGen =
        node.generation?.model === "pending" ||
        !node.src ||
        node.src.startsWith("data:image/svg+xml");
      if (!needsGen && node.generation?.model && node.generation.model !== "pending") {
        continue;
      }
      out.push({
        pageId: page.id,
        nodeId: node.id,
        width: Math.max(64, Math.round(node.width)),
        height: Math.max(64, Math.round(node.height)),
        alt: node.alt,
        existingPrompt: node.generation?.prompt,
      });
    }
  }
  return out;
}

async function tryLlmPlan(
  brief: ProductBrief,
  pages: CanvasPage[],
  pending: PendingNode[],
  designDirection: DesignDirection | null | undefined,
  ctx: import("./types").AgentContext
): Promise<ImagePlan | null> {
  const system = buildSystemPrompt({
    skill: ctx.skill,
    designSystem: ctx.designSystem,
    brief,
    designContext: readDesignContextFromScratch(ctx.scratch),
    extra: {
      designDirection,
      pendingNodes: pending,
      pageSummaries: pages.map((p) => ({
        id: p.id,
        name: p.name,
        imageCount: p.nodes.filter((n) => n.type === "image").length,
      })),
    },
    technicalAddendum: [
      "# 任务：Image Planner",
      "为每个 image 节点写英文 imagePrompt，供生图模型使用。",
      "风格必须体现 brief.visualStyle 与 designDirection。",
      PLANNER_OUTPUT_SHAPE,
    ].join("\n\n"),
  });

  const out = await ctx.providers.llm.generateText({
    system,
    prompt: `为 ${pending.length} 个 image 节点规划生图任务，输出 JSON：`,
    schema: { type: "object" },
  });

  if (isMockLlmText(out.text)) return null;

  let json: unknown;
  try {
    json = JSON.parse(stripJsonFence(out.text));
  } catch {
    return null;
  }
  const parsed = ImagePlanSchema.safeParse(json);
  if (!parsed.success) return null;

  // 只保留真实存在的 nodeId
  const valid = new Set(pending.map((p) => `${p.pageId}:${p.nodeId}`));
  const tasks = parsed.data.tasks.filter((t) =>
    valid.has(`${t.pageId}:${t.nodeId}`)
  );
  return { tasks };
}

function heuristicPlan(
  brief: ProductBrief,
  pending: PendingNode[]
): ImagePlan {
  const style = brief.visualStyle;
  const tasks: ImagePlanTask[] = pending.map((p, i) => ({
    pageId: p.pageId,
    nodeId: p.nodeId,
    width: p.width,
    height: p.height,
    imagePrompt:
      p.existingPrompt ??
      p.alt ??
      `${style}, high quality UI illustration, scene ${i + 1}, no text overlay`,
    role: i === 0 ? "hero" : "illustration",
  }));
  return { tasks };
}
