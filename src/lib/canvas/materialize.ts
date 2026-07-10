/**
 * Canvas Materialize
 * --------------------------------------------------------------
 * 把 LLM 输出的 LlmCanvasPage / LlmCanvasNode 转换为运行时 CanvasPage：
 *   - 为每个 image 节点调用 ImageProvider 把 imagePrompt → src
 *   - 为所有节点分配 nanoid + source 标签
 *   - 终态过 CanvasPageSchema 二次校验，防止 LLM 输出越界字段值
 *
 * 由 LayoutAgent（生成）与 RepairAgent（修复）共用。
 */

import { nanoid } from "nanoid";
import type { CanvasNode, CanvasPage } from "./schema";
import { CanvasPageSchema } from "./schema";
import type { LlmCanvasPage } from "./llm-schema";
import type { ProductBrief } from "@/lib/project/schema";
import type { ImageProvider } from "@/lib/providers/image/types";

/** Layout 阶段占位图：生图由 Image Executor 后续填充。 */
export const IMAGE_PLACEHOLDER_SRC =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect fill="#E4E4E7" width="100%" height="100%"/><text x="50%" y="50%" text-anchor="middle" fill="#71717A" font-size="14" font-family="sans-serif">pending image</text></svg>'
  );

export interface MaterializeOptions {
  /** 节点的 source 标签，用于追溯产出来源（layout-agent-llm / repair-agent-llm 等）。 */
  source: string;
  /** 强制使用的 page id；缺省则由 fallbackId 决定。 */
  pageId?: string;
  /** 当 pageId 缺失时使用的兜底 id（例如首次生成传 "home"，或 slug-derived）。 */
  fallbackId: string;
  /**
   * true：image 节点只写 imagePrompt 占位，不调生图模型。
   * 生图由 Orchestrator 显式调度 generate_images / ImageExecutorAgent。
   */
  skipImageGeneration?: boolean;
}

export async function materializePage(
  llmPage: LlmCanvasPage,
  brief: ProductBrief,
  image: ImageProvider,
  opts: MaterializeOptions
): Promise<CanvasPage | null> {
  const nodes: CanvasNode[] = [];
  for (const n of llmPage.nodes) {
    if (n.type === "image") {
      const prompt = `${brief.visualStyle}, ${n.imagePrompt}`;
      if (opts.skipImageGeneration) {
        nodes.push({
          id: nanoid(8),
          type: "image",
          x: n.x,
          y: n.y,
          width: n.width,
          height: n.height,
          src: IMAGE_PLACEHOLDER_SRC,
          alt: n.imagePrompt,
          radius: n.radius,
          generation: { prompt, model: "pending" },
          source: opts.source,
        });
        continue;
      }
      const gen = await image.generateImage({
        prompt,
        width: Math.max(1, Math.round(n.width)),
        height: Math.max(1, Math.round(n.height)),
      });
      nodes.push({
        id: nanoid(8),
        type: "image",
        x: n.x,
        y: n.y,
        width: n.width,
        height: n.height,
        src: gen.imageUrl,
        alt: n.imagePrompt,
        radius: n.radius,
        generation: { prompt, model: gen.model, seed: gen.seed },
        source: opts.source,
      });
      continue;
    }
    nodes.push({ ...n, id: nanoid(8), source: opts.source });
  }

  const candidate = {
    id: opts.pageId ?? opts.fallbackId,
    name: llmPage.name,
    width: llmPage.width,
    height: llmPage.height,
    background: llmPage.background,
    nodes,
  };

  const parsed = CanvasPageSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function slugForPage(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 30);
}
