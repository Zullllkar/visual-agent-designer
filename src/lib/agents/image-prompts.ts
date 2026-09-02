/**
 * 生图多方案 prompt 规范化
 * --------------------------------------------------------------
 * - prompts/variants：一张图一条提示词
 * - 单 prompt + count：count 作废，只出一张；要多张须先展开成不同 prompt
 *
 * @author：wangjunhua
 */

export type ImagePromptVariant = {
  prompt: string;
  role?: string;
  width?: number;
  height?: number;
};

export type NormalizedImagePrompts = {
  /** 至少 1 条 */
  prompts: string[];
  variants: ImagePromptVariant[];
  /** 永远等于去重后的 prompts.length */
  count: number;
  /** multi = 多条不同提示词；same = 只有一条 */
  mode: "multi" | "same";
};

const ROLES = new Set([
  "hero",
  "illustration",
  "product-shot",
  "background",
  "avatar",
]);

/** 从工具参数 / 确认载荷解析 prompts */
export function normalizeImagePrompts(input: {
  prompt?: unknown;
  prompts?: unknown;
  variants?: unknown;
  count?: unknown;
  n?: unknown;
}): NormalizedImagePrompts {
  const variants = parseVariants(input.variants, input.prompts, input.prompt);
  const prompts = variants.map((v) => v.prompt);
  if (prompts.length > 1) {
    return {
      prompts,
      variants,
      count: prompts.length,
      mode: "multi",
    };
  }

  const single = prompts[0] ?? "";
  return {
    prompts: single ? [single] : [],
    variants: single
      ? [{ ...(variants[0] ?? {}), prompt: single }]
      : [],
    count: single ? 1 : 0,
    mode: "same",
  };
}

export function formatImageConfirmMarker(input: {
  count: number;
  prompt: string;
  prompts?: string[];
}): string {
  const prompts =
    input.prompts && input.prompts.length > 0
      ? input.prompts.map((p) => p.trim()).filter(Boolean)
      : [input.prompt.trim()].filter(Boolean);
  const lines = [
    "[IMAGE_GENERATION_CONFIRMED]",
    `Count: ${input.count}`,
  ];
  if (prompts.length > 1) {
    lines.push(`Prompts-JSON: ${JSON.stringify(prompts)}`);
  }
  lines.push(`Prompt: ${prompts[0] ?? input.prompt}`);
  return lines.join("\n");
}

export function parsePromptsFromConfirmText(text: string): string[] | undefined {
  const jsonMatch = text.match(/^Prompts-JSON:\s*(\[[\s\S]*?\])\s*$/m);
  if (jsonMatch?.[1]) {
    try {
      const parsed = JSON.parse(jsonMatch[1]) as unknown;
      if (Array.isArray(parsed)) {
        const prompts = parsed
          .filter((p): p is string => typeof p === "string")
          .map((p) => p.trim())
          .filter(Boolean);
        if (prompts.length > 0) return prompts;
      }
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

function parseVariants(
  variantsRaw: unknown,
  promptsRaw: unknown,
  promptRaw: unknown
): ImagePromptVariant[] {
  if (Array.isArray(variantsRaw) && variantsRaw.length > 0) {
    const fromVariants = variantsRaw
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const rec = item as Record<string, unknown>;
        const prompt =
          typeof rec.prompt === "string" ? rec.prompt.trim() : "";
        if (!prompt) return null;
        const role =
          typeof rec.role === "string" && ROLES.has(rec.role)
            ? rec.role
            : undefined;
        const width =
          typeof rec.width === "number" && Number.isFinite(rec.width)
            ? Math.round(rec.width)
            : undefined;
        const height =
          typeof rec.height === "number" && Number.isFinite(rec.height)
            ? Math.round(rec.height)
            : undefined;
        const variant: ImagePromptVariant = { prompt, role, width, height };
        return variant;
      })
      .filter((v): v is ImagePromptVariant => v != null);
    if (fromVariants.length > 0) return fromVariants.slice(0, 8);
  }

  if (Array.isArray(promptsRaw) && promptsRaw.length > 0) {
    const prompts = promptsRaw
      .filter((p): p is string => typeof p === "string")
      .map((p) => p.trim())
      .filter(Boolean)
      .slice(0, 8);
    if (prompts.length > 0) {
      return prompts.map((prompt) => ({ prompt }));
    }
  }

  if (typeof promptRaw === "string" && promptRaw.trim()) {
    return [{ prompt: promptRaw.trim() }];
  }

  return [];
}
