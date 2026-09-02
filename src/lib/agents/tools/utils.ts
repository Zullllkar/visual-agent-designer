/**
 * 工具共享辅助函数
 * --------------------------------------------------------------
 * 从 chat-orchestrator.ts 抽取的工具通用 helper。
 */

import { nanoid } from "nanoid";
import { ProjectFileSchema } from "@/lib/project/schema";
import type { ProjectFile } from "@/lib/project/schema";
import type { ImageAsset } from "@/lib/project/assets-schema";
import {
  deriveDesignContext,
  readDesignContextFromScratch,
} from "@/lib/project/design-context";

export function slugify(s: string): string | undefined {
  const r = s
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return r || undefined;
}

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

const COMPOSER_REF_BLOCK =
  /【(?:引用素材|参考图|引用页面|引用元素)[^】]*】/g;

function stripComposerRefBlocks(text: string): string {
  return text.replace(COMPOSER_REF_BLOCK, " ").replace(/\s+/g, " ").trim();
}

const IMAGE_COUNT_UNIT =
  "(?:\u5f20|\u5f35|\u4e2a|\u5e45|\u5f20\u56fe|\u5f35\u5716|images?|pics?|pictures?)";

export function parseRequestedImageCount(text: string): number | undefined {
  const normalized = stripComposerRefBlocks(text).toLowerCase();
  if (!normalized) return undefined;

  const explicitRange = normalized.match(
    new RegExp(
      `(?:only\\s*)?(\\d{1,2})\\s*(?:-|~|to|or|\u6216|\u6216\u8005|\u5230|\u81f3)\\s*\\d{1,2}\\s*${IMAGE_COUNT_UNIT}`
    )
  );
  if (explicitRange) return Number(explicitRange[1]);

  const explicitCount = normalized.match(
    new RegExp(`(?:only\\s*)?(\\d{1,2})\\s*${IMAGE_COUNT_UNIT}`)
  );
  if (explicitCount) return Number(explicitCount[1]);

  if (
    /(?:\u4e00|\u0031)\s*(?:\u6216|\u6216\u8005|\u5230|\u81f3|-|~)\s*(?:\u4e8c|\u4e24|\u5169|\u0032)\s*(?:\u5f20|\u5f35|\u4e2a|\u5e45)?/.test(normalized) ||
    /\u4e00[\u4e24\u5169]\s*(?:\u5f20|\u5f35|\u4e2a|\u5e45)?/.test(normalized)
  ) {
    return 1;
  }

  const digitMatch = normalized.match(
    new RegExp(
      `(?:only\\s*)?(\\d{1,2})(?:\\s*(?:-|~|to|or|或者|或)\\s*\\d{1,2})?\\s*${IMAGE_COUNT_UNIT}`
    )
  );
  if (digitMatch) return Number(digitMatch[1]);
  const digitRangeMatch = normalized.match(
    new RegExp(
      `(?:only\\s*)?(\\d{1,2})\\s*(?:-|~|to|or|或者|或)\\s*\\d{1,2}\\s*${IMAGE_COUNT_UNIT}`
    )
  );
  if (digitRangeMatch) return Number(digitRangeMatch[1]);

  const chineseDigits: Record<string, number> = {
    "\u4e00": 1,
    "\u4e8c": 2,
    "\u4e24": 2,
    "\u5169": 2,
    "\u4e09": 3,
    "\u56db": 4,
    "\u4e94": 5,
    "\u516d": 6,
    "\u4e03": 7,
    "\u516b": 8,
  };
  const chineseMatch = normalized.match(
    /([\u4e00\u4e8c\u4e24\u5169\u4e09\u56db\u4e94\u516d\u4e03\u516b])(?:\s*(?:-|~|到|至|或者|或)\s*[\u4e00\u4e8c\u4e24\u5169\u4e09\u56db\u4e94\u516d\u4e03\u516b])?\s*(?:\u5f20|\u5f35|\u4e2a)/
  );
  if (chineseMatch) return chineseDigits[chineseMatch[1]];

  if (/one\s+(?:or|to)\s+two\s+(?:images?|pics?|pictures?)?/.test(normalized)) return 1;
  if (/\bone\s+(?:image|pic|picture)\b/.test(normalized)) return 1;
  if (/two\s+(?:images?|pics?|pictures?)\b/.test(normalized)) return 2;
  if (/(\u53ea\u8981|\u53ea\u9700|\u4ec5\u9700|\u4e00\u5f20|\u4e00\u5f35|\u5355\u5f20|\u55ae\u5f35)/.test(normalized)) {
    return 1;
  }
  if (/(\u4e00\u4e24|\u4e00\u5169|\u4e00\s*(?:\u6216|\u6216\u8005|\u5230|\u81f3)\s*[\u4e8c\u4e24\u5169])\s*(?:\u5f20|\u5f35|\u4e2a)?/.test(normalized)) {
    return 1;
  }

  return undefined;
}

export function normalizeImageSize(width: number, height: number): {
  width: number;
  height: number;
} {
  const w = Math.max(64, width);
  const h = Math.max(64, height);
  const maxSide = Math.max(w, h);
  const minSide = Math.min(w, h);
  const upScale = minSide < 512 ? 512 / minSide : 1;
  const downScale = maxSide * upScale > 1792 ? 1792 / (maxSide * upScale) : 1;
  const scale = upScale * downScale;
  return {
    width: roundTo64(w * scale),
    height: roundTo64(h * scale),
  };
}

function roundTo64(value: number): number {
  return Math.max(512, Math.round(value / 64) * 64);
}

export function inferImageRole(
  width: number,
  height: number
): NonNullable<ImageAsset["role"]> {
  const ratio = width / Math.max(1, height);
  if (ratio > 2.2) return "background";
  if (width > 480 && height > 260) return "hero";
  return "illustration";
}

export function isUsableReferenceImage(src: string | undefined): src is string {
  if (!src) return false;
  if (src.startsWith("data:image/svg+xml")) return false;
  if (src.startsWith("data:image/")) return true;
  if (/^https?:\/\//i.test(src)) return true;
  return /^\/api\/assets\/[^/]+\/(assets|references)\//.test(src);
}

export function buildNodeImagePrompt({
  project,
  instruction,
  currentPrompt,
  designContextSummary,
}: {
  project: ProjectFile;
  instruction: string;
  currentPrompt?: string;
  designContextSummary?: string;
}): string {
  return [
    designContextSummary ?? project.brief?.visualStyle,
    `Project: ${project.title}`,
    `User instruction: ${instruction}`,
    currentPrompt ? `Current image direction: ${currentPrompt}` : undefined,
    "Create a polished visual asset for a UI canvas node.",
    "Match the product interface style, composition, and color language.",
    "No text overlay, no fake UI labels, no watermark.",
  ]
    .filter(Boolean)
    .join(". ");
}

export function extractCitedAssetId(text: string): string | undefined {
  const match = text.match(/【引用素材\s*[:：]?[^#】]*#([\w-]+)】/);
  return match?.[1];
}

export function isVariantImageInstruction(text: string): boolean {
  return /视觉变体|生成.{0,12}变体|keep (?:the )?(?:subject|composition)|visual variant/i.test(
    text
  );
}

/** 去掉浮动条/Agent 塞进变体指令里的旧场景文案，避免按原文重画。 */
export function stripVariantScenePrompt(instruction: string): string {
  return instruction
    .replace(/【引用素材[^】]*】\s*/g, "")
    .replace(/参考(?:原\s*)?\s*prompt\s*[:：][\s\S]*$/i, "")
    .replace(/\bStyle lock\s*[:：][\s\S]*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildVariantImagePrompt({
  instruction,
  parentPrompt,
}: {
  instruction: string;
  parentPrompt?: string;
}): string {
  const edit = stripVariantScenePrompt(instruction);
  const note = parentPrompt?.replace(/\s+/g, " ").trim().slice(0, 160);
  return [
    "Image-to-image edit of the attached screenshot. The attached image is the only source of truth.",
    "Preserve the same layout, subjects, aspect ratio, and every visible word, number, logo, icon, and UI label in place.",
    "Keep typography readable. Do not replace labels with blank bars, lorem lines, or empty blocks.",
    "Do not invent a different scene, product, or asset set. Do not turn a UI mockup into a photo gallery of one subject.",
    "Only vary style, lighting, color grade, or surface detail as requested.",
    edit
      ? `User edit: ${edit}`
      : "Create a close visual variant of the attached image.",
    note
      ? `Ignore any earlier generation note if it conflicts with the attached pixels (note: ${note}).`
      : undefined,
  ]
    .filter(Boolean)
    .join(" ");
}

export function resolveRunDesignContext(
  project: ProjectFile | null,
  scratch: Record<string, unknown>
): ProjectFile["designContext"] {
  if (!project) return undefined;
  return (
    project.designContext ??
    readDesignContextFromScratch(scratch) ??
    deriveDesignContext(project) ??
    undefined
  );
}

export { nanoid, ProjectFileSchema };
