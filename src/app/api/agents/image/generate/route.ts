import { z } from "zod";
import { nanoid } from "nanoid";
import { resolveProviders } from "@/lib/providers/registry";
import { ProviderConfigSchema } from "@/lib/providers/config-schema";
import type { ImageAsset } from "@/lib/project/assets-schema";

/**
 * POST /api/agents/image/generate
 * --------------------------------------------------------------
 * 输入：{ prompt, n?, width?, height?, visualStyle?, providerConfig? }
 * 输出：{ assets: ImageAsset[] }
 *
 * 行为：
 *   1. resolveProviders(providerConfig) → ImageProvider
 *   2. 并发跑 N 次 generateImage（共享同一 prompt，不同 seed）
 *   3. 每次结果包成 ImageAsset，共享同一 batchId
 *   4. 任一次失败不影响其他成功的，部分失败时仍返回成功的数量
 *
 * 不直接落盘到 server side —— ImageAsset 由客户端写入 project-store /
 * IndexedDB；服务端只是"图像模型代理 + metadata 装配"层。
 */

const InputSchema = z.object({
  prompt: z.string().min(1).max(2000),
  n: z.number().int().min(1).max(8).optional(),
  width: z.number().int().positive().max(4096).optional(),
  height: z.number().int().positive().max(4096).optional(),
  /** 视觉风格前缀，会自动拼到 prompt 前（例如 brief.visualStyle） */
  visualStyle: z.string().max(200).optional(),
  /** 关联到哪个 page 生成；只是元数据，不影响生成行为 */
  sourcePageId: z.string().optional(),
  /** 可选 negative prompt */
  negativePrompt: z.string().max(500).optional(),
  /** 用于图片编辑/风格参考的输入图。 */
  referenceImages: z.array(z.string().min(1).max(8_000_000)).max(4).optional(),
  providerConfig: ProviderConfigSchema,
});

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = InputSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_input", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const {
    prompt,
    n = 4,
    width = 1024,
    height = 1024,
    visualStyle,
    sourcePageId,
    negativePrompt,
    referenceImages,
    providerConfig,
  } = parsed.data;

  const { image } = resolveProviders(providerConfig);
  const fullPrompt = visualStyle ? `${visualStyle}, ${prompt}` : prompt;
  const batchId = nanoid(8);
  const now = new Date().toISOString();

  // 并发调用，部分失败用 settle 兜底
  const settled = await Promise.allSettled(
    Array.from({ length: n }, () =>
      image.generateImage({
        prompt: fullPrompt,
        width,
        height,
        negativePrompt,
        referenceImages,
      })
    )
  );

  const assets: ImageAsset[] = [];
  const errors: string[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") {
      const out = r.value;
      assets.push({
        id: nanoid(10),
        prompt: fullPrompt,
        src: out.imageUrl,
        width,
        height,
        model: out.model,
        seed: out.seed,
        durationMs: out.durationMs,
        costUsd: out.cost,
        createdAt: now,
        batchId,
        variantGroupId: batchId,
        status: "candidate",
        source: referenceImages?.length ? "edited" : "generated",
        ...(sourcePageId ? { usedInPages: [] } : {}),
      });
    } else {
      errors.push(String((r.reason as Error)?.message ?? r.reason));
    }
  }

  if (assets.length === 0) {
    return Response.json(
      { error: "all_failed", errors: errors.slice(0, 5) },
      { status: 502 }
    );
  }

  return Response.json({
    assets,
    batchId,
    requested: n,
    succeeded: assets.length,
    errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
  });
}
