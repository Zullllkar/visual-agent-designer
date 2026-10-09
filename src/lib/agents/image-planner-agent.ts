/**
 * Image planner agent.
 *
 * Produces concrete image generation tasks for either existing pending canvas
 * image nodes or standalone asset generation.
 */

import { z } from "zod";
import type { Agent } from "./types";
import type { ProductBrief, DesignDirection } from "@/lib/project/schema";
import type { CanvasPage } from "@/lib/canvas/schema";
import { CopyPlanItemSchema } from "@/lib/project/design-spec-schema";
import { stripJsonFence } from "@/lib/providers/llm/openai-compatible";
import { isMockLlmText } from "@/lib/providers/llm/utils";
import { buildSystemPrompt } from "@/lib/skills/prompt-stack";
import { readDesignContextFromScratch } from "@/lib/project/design-context";
import { parseTargetId } from "@/lib/targets/resolve";

export const ImagePlanTaskSchema = z.object({
  pageId: z.string(),
  nodeId: z.string(),
  imagePrompt: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  role: z
    .enum(["hero", "illustration", "product-shot", "background", "avatar"])
    .optional(),
  /** UI 屏才有：生图前定好的 headline / CTA / 导航文案，随资产进 handoff */
  copyPlan: z.array(CopyPlanItemSchema).optional(),
  /** 短中文名，如「训练首页」；缺省时由 prompt 推导。 */
  title: z.string().optional(),
});

export const ImagePlanSchema = z.object({
  tasks: z.array(ImagePlanTaskSchema),
});

export type ImagePlan = z.infer<typeof ImagePlanSchema>;
export type ImagePlanTask = z.infer<typeof ImagePlanTaskSchema>;

export const STANDALONE_BOARD_ID = "asset-board";

export const ImagePlannerAgent: Agent<
  {
    brief: ProductBrief;
    pages: CanvasPage[];
    designDirection?: DesignDirection | null;
    standaloneCount?: number;
    standalonePrompt?: string;
    /** 多类型：每条一个不同任务；优先于 standalonePrompt×count 复制 */
    standalonePrompts?: string[];
    standaloneWidth?: number;
    standaloneHeight?: number;
    standaloneRole?: ImagePlanTask["role"];
  },
  ImagePlan
> = {
  name: "image-planner-agent",
  async run(input, ctx) {
    const pending = collectPendingImageNodes(input.pages);

    if (pending.length === 0) {
      const multiPrompts = (input.standalonePrompts ?? [])
        .map((p) => p.trim())
        .filter(Boolean);
      if (multiPrompts.length > 0 || input.standalonePrompt?.trim()) {
        return planFromConfirmedPrompt({
          prompt: (multiPrompts[0] || input.standalonePrompt || "").trim(),
          prompts: multiPrompts.length > 0 ? multiPrompts : undefined,
          count: input.standaloneCount ?? 1,
          width: input.standaloneWidth,
          height: input.standaloneHeight,
          role: input.standaloneRole,
        });
      }

      const fromLlm = await tryLlmStandalonePlan(
        input.brief,
        input.designDirection,
        input.standaloneCount ?? 1,
        ctx
      ).catch(() => null);
      if (fromLlm && fromLlm.tasks.length > 0) return fromLlm;
      return planStandaloneAssetsFallback(
        input.brief,
        input.designDirection,
        input.standaloneCount ?? 1
      );
    }

    const fromLlm = await tryLlmPlan(
      input.brief,
      input.pages,
      pending,
      input.designDirection,
      ctx
    ).catch(() => null);
    if (fromLlm && fromLlm.tasks.length > 0) return fromLlm;

    return heuristicPlan(input.brief, pending);
  },
};

function planFromConfirmedPrompt({
  prompt,
  prompts,
  count,
  width,
  height,
  role,
}: {
  prompt: string;
  prompts?: string[];
  count: number;
  width?: number;
  height?: number;
  role?: ImagePlanTask["role"];
}): ImagePlan {
  const distinct = (prompts ?? [])
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 8);

  // 多条不同提示词 → 每种一张（不再把第一条复制 N 次）
  if (distinct.length > 1) {
    return {
      tasks: distinct.map((imagePrompt, index) => ({
        pageId: STANDALONE_BOARD_ID,
        nodeId: "asset-" + (index + 1),
        imagePrompt,
        width: width ?? 1280,
        height: height ?? 720,
        role: role ?? (index === 0 ? "hero" : "illustration"),
      })),
    };
  }

  const single = distinct[0] || prompt;
  const n = Math.min(6, Math.max(1, count));
  return {
    tasks: Array.from({ length: n }, (_, index) => ({
      pageId: STANDALONE_BOARD_ID,
      nodeId: "asset-" + (index + 1),
      imagePrompt: single,
      width: width ?? 1280,
      height: height ?? 720,
      role: role ?? "hero",
    })),
  };
}

async function tryLlmStandalonePlan(
  brief: ProductBrief,
  designDirection: DesignDirection | null | undefined,
  count: number,
  ctx: import("./types").AgentContext
): Promise<ImagePlan | null> {
  const n = Math.min(6, Math.max(1, count));
  const targetId =
    typeof ctx.scratch.targetId === "string" ? ctx.scratch.targetId : undefined;
  const system = buildSystemPrompt({
    skill: ctx.skill,
    designSystem: ctx.designSystem,
    brief,
    designContext: readDesignContextFromScratch(ctx.scratch),
    extra: { designDirection },
    targetId,
    technicalAddendum: [
      "# Task: Image Planner (Standalone)",
      "Plan standalone visual image assets for the canvas.",
      "Return strict JSON with tasks only.",
      `Return exactly ${n} task(s). Do not increase the count.`,
      "Each task needs nodeId, imagePrompt, width, height, role, and a short human title (Chinese ≤12 chars, like 训练首页). Never use an id as the title.",
      parseTargetId(targetId) === "ui-visual"
        ? [
            "For app UI requests, produce a UI mockup prompt, not a poster or promo banner.",
            "Also decide the real UI copy BEFORE the image exists: add `copyPlan` to each UI task — an array of {id, role, text} where role ∈ headline|subhead|cta|nav|label|body|caption|other. 3–10 items: the headline, subhead, primary CTA, nav items and key labels the screen must show. Use the product's language (match the brief). Keep each text short and final (no placeholders like 'Lorem' or 'Your text here').",
            "Quote every copyPlan text verbatim inside imagePrompt so the image model renders it, e.g. headline \"Plan your week in one glance\". This copy becomes the source of truth for the coding agent.",
          ].join("\n")
        : "Follow the Goal prompt contract. Do not apply the UI poster ban unless targetId is ui-visual.",
      typeof ctx.scratch.citedAssetId === "string"
        ? "The user cited a canvas asset. Match that attached image's palette, materials, lighting, typography, and UI chrome. Do not reuse Design context or other recent canvas prompts."
        : Array.isArray(ctx.scratch.referenceLabels) &&
            (ctx.scratch.referenceLabels as string[]).length > 0
          ? `User attached reference images: ${(ctx.scratch.referenceLabels as string[]).join(", ")}. Reflect their style/mood/palette in every imagePrompt.`
          : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  });

  const out = await ctx.providers.llm.generateText({
    system,
    prompt: `Plan ${n} standalone image asset(s) for ${brief.productName}. Output JSON: {"tasks":[...]}`,
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

  const tasks = parsed.data.tasks.slice(0, n).map((task, index) =>
    withCopyPlanInPrompt({
      ...task,
      pageId: task.pageId || STANDALONE_BOARD_ID,
      nodeId: task.nodeId || "asset-" + (index + 1),
    })
  );
  return { tasks };
}

/**
 * 规划好的文案必须原样出现在 imagePrompt 里，图模型才有机会画对；
 * 模型漏引用时在这里补一句。同时给 copyPlan 项补 id。
 */
export function withCopyPlanInPrompt(task: ImagePlanTask): ImagePlanTask {
  const plan = (task.copyPlan ?? [])
    .map((c, i) => ({ ...c, id: c.id?.trim() || `copy-${i + 1}`, text: c.text.trim() }))
    .filter((c) => c.text.length > 0);
  if (plan.length === 0) return { ...task, copyPlan: undefined };
  const missing = plan.filter((c) => !task.imagePrompt.includes(c.text));
  const imagePrompt =
    missing.length === 0
      ? task.imagePrompt
      : `${task.imagePrompt.trim()} Render this UI text exactly: ${missing
          .map((c) => `${c.role} "${c.text}"`)
          .join(", ")}.`;
  return { ...task, copyPlan: plan, imagePrompt };
}

function planStandaloneAssetsFallback(
  brief: ProductBrief,
  designDirection: DesignDirection | null | undefined,
  count: number
): ImagePlan {
  const n = Math.min(6, Math.max(1, count));
  const mood =
    designDirection?.moodKeywords?.slice(0, 4).join(", ") ||
    brief.visualStyle ||
    "modern, clean";
  const product = brief.productName || "product";
  const productContext = `${product}; ${brief.positioning}`.slice(0, 240);
  const audience = brief.targetUser || "users";

  return {
    tasks: Array.from({ length: n }, (_, index) => ({
      pageId: STANDALONE_BOARD_ID,
      nodeId: "asset-" + (index + 1),
      imagePrompt: [
        `High-fidelity visual asset for ${productContext}`,
        `Target users: ${audience}`,
        mood,
        "professional composition",
        "no watermark",
      ].join(", "),
      width: index === 0 ? 1280 : 1024,
      height: index === 0 ? 720 : 1024,
      role: index === 0 ? "hero" : "illustration",
    })),
  };
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
  const targetId =
    typeof ctx.scratch.targetId === "string" ? ctx.scratch.targetId : undefined;
  const system = buildSystemPrompt({
    skill: ctx.skill,
    designSystem: ctx.designSystem,
    brief,
    designContext: readDesignContextFromScratch(ctx.scratch),
    extra: {
      designDirection,
      pendingNodes: pending,
      pageSummaries: pages.map((page) => ({
        id: page.id,
        name: page.name,
        imageCount: page.nodes.filter((node) => node.type === "image").length,
      })),
    },
    targetId,
    technicalAddendum: [
      "# Task: Image Planner",
      "Write one English imagePrompt for each pending image node.",
      "Each task also needs a short human title (Chinese ≤12 chars, like 训练首页). Never use an id as the title.",
      "Return strict JSON: {\"tasks\":[...]}",
      "Only include real pending pageId/nodeId pairs from pendingNodes.",
    ].join("\n\n"),
  });

  const out = await ctx.providers.llm.generateText({
    system,
    prompt: `Plan image tasks for ${pending.length} pending image node(s). Output JSON.`,
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

  const valid = new Set(pending.map((item) => `${item.pageId}:${item.nodeId}`));
  const tasks = parsed.data.tasks.filter((task) =>
    valid.has(`${task.pageId}:${task.nodeId}`)
  );
  return { tasks };
}

function heuristicPlan(
  brief: ProductBrief,
  pending: PendingNode[]
): ImagePlan {
  const style = brief.visualStyle;
  const productContext = `${brief.productName}; ${brief.positioning}`.slice(0, 240);
  return {
    tasks: pending.map((node, index) => ({
      pageId: node.pageId,
      nodeId: node.nodeId,
      width: node.width,
      height: node.height,
      imagePrompt: [
        style,
        productContext,
        node.existingPrompt ?? node.alt ?? `high quality UI illustration, scene ${index + 1}`,
        "no text overlay",
        "no watermark",
      ]
        .filter(Boolean)
        .join(", "),
      role: index === 0 ? "hero" : "illustration",
    })),
  };
}
