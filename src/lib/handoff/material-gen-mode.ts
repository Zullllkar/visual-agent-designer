/**
 * 素材生成模式决策：slice / refine / regenerate + outputSpec
 * 像素锚定优先；文字重绘仅作回退。
 */

import { z } from "zod";
import type { BBox, MaterialSlot } from "./layout-ir";

export const MaterialGenModeSchema = z.enum([
  "slice",
  "refine",
  "regenerate",
]);

export const MaterialOutputSpecSchema = z.object({
  /** 需要透明底（icon/avatar/decoration 默认 true） */
  alpha: z.boolean().default(false),
  /** 背景类可平铺 */
  tileable: z.boolean().default(false),
  /** 相对 bbox 的出血边（0–0.2） */
  bleed: z.number().min(0).max(0.2).default(0),
});

export type MaterialGenMode = z.infer<typeof MaterialGenModeSchema>;
export type MaterialOutputSpec = z.infer<typeof MaterialOutputSpecSchema>;

export interface GenModeDecision {
  genMode: MaterialGenMode;
  outputSpec: MaterialOutputSpec;
  confidence: number;
  reasons: string[];
}

const ATOMIC = new Set(["icon", "avatar", "decoration"]);
const SCENE = new Set(["hero", "illustration"]);

/** 为媒体槽建议生成模式与交付形态 */
export function suggestGenMode(input: {
  role: MaterialSlot["role"] | string;
  bbox: BBox;
  prompt?: string;
}): GenModeDecision {
  const role = input.role;
  const area = Math.max(0, input.bbox.w) * Math.max(0, input.bbox.h);
  const prompt = (input.prompt ?? "").toLowerCase();
  const reasons: string[] = [];

  const alpha = ATOMIC.has(role) || /transparent|isolated|silhouette|logo|icon/.test(prompt);
  const tileable = role === "background" || /tileable|seamless|平铺/.test(prompt);
  const bleed =
    role === "background" ? 0.02 : ATOMIC.has(role) ? 0.01 : SCENE.has(role) ? 0.03 : 0.02;

  const outputSpec: MaterialOutputSpec = { alpha, tileable, bleed };

  // 小零件：默认直接切片（优先于重绘意图）
  if (ATOMIC.has(role) || area < 0.06) {
    reasons.push(ATOMIC.has(role) ? "atomic-role" : "small-area");
    return {
      genMode: "slice",
      outputSpec: { ...outputSpec, alpha: true },
      confidence: ATOMIC.has(role) ? 0.9 : 0.75,
      reasons,
    };
  }

  // 明确要求重绘时，覆盖背景/场景默认 refine
  if (/redesign|reimagine|different|全新|重绘|换一版/.test(prompt)) {
    reasons.push("prompt-asks-regenerate");
    return {
      genMode: "regenerate",
      outputSpec,
      confidence: 0.65,
      reasons,
    };
  }

  // 背景 / 大纹理：提纯
  if (role === "background" || area > 0.35) {
    reasons.push(role === "background" ? "background-role" : "large-area");
    return {
      genMode: "refine",
      outputSpec: { ...outputSpec, tileable: role === "background" || tileable },
      confidence: 0.8,
      reasons,
    };
  }

  // 插画 / hero：crop 锚定提纯
  if (SCENE.has(role)) {
    reasons.push("scene-role");
    return {
      genMode: "refine",
      outputSpec,
      confidence: 0.78,
      reasons,
    };
  }

  reasons.push("default-refine");
  return { genMode: "refine", outputSpec, confidence: 0.7, reasons };
}

/** 按 outputSpec.bleed 膨胀 bbox（夹紧到 0–1） */
export function expandBBoxForBleed(bbox: BBox, bleed: number): BBox {
  const b = Math.max(0, Math.min(0.2, bleed));
  if (b <= 0) return bbox;
  const x = Math.max(0, bbox.x - b);
  const y = Math.max(0, bbox.y - b);
  const x2 = Math.min(1, bbox.x + bbox.w + b);
  const y2 = Math.min(1, bbox.y + bbox.h + b);
  return { x, y, w: Math.max(0.02, x2 - x), h: Math.max(0.02, y2 - y) };
}

/** icon 类略微收紧，减少周围 chrome */
export function tightenBBoxForAtomic(bbox: BBox, role: string): BBox {
  if (!ATOMIC.has(role)) return bbox;
  const pad = 0.008;
  const x = Math.min(0.98, bbox.x + pad);
  const y = Math.min(0.98, bbox.y + pad);
  const w = Math.max(0.02, bbox.w - pad * 2);
  const h = Math.max(0.02, bbox.h - pad * 2);
  return {
    x,
    y,
    w: Math.min(w, 1 - x),
    h: Math.min(h, 1 - y),
  };
}

export function resolveSlotCropBBox(slot: Pick<MaterialSlot, "role" | "bbox" | "outputSpec">): BBox {
  const bleed = slot.outputSpec?.bleed ?? 0;
  const base = tightenBBoxForAtomic(slot.bbox, slot.role);
  return expandBBoxForBleed(base, bleed);
}

/**
 * 轻量验收：生成结果 data URL 是否像样；
 * 真视觉相似度成本高，此处做体积/格式闸门，失败则降级。
 */
export function acceptGeneratedMaterial(input: {
  imageUrl?: string | null;
  genMode: MaterialGenMode;
  cropPreviewSrc?: string | null;
}): { ok: boolean; reason?: string } {
  const url = input.imageUrl ?? "";
  if (!url) return { ok: false, reason: "empty-image" };
  if (url.startsWith("data:image/")) {
    const payload = url.split(",")[1] ?? "";
    if (payload.length < 80) return { ok: false, reason: "tiny-payload" };
  }
  // regenerate/refine 若与 crop 完全相同字符串，视为模型未改动（少见）
  if (
    input.genMode !== "slice" &&
    input.cropPreviewSrc &&
    url === input.cropPreviewSrc
  ) {
    return { ok: false, reason: "identical-to-crop" };
  }
  return { ok: true };
}

/** 验收失败时的降级路径 */
export function fallbackGenMode(mode: MaterialGenMode): MaterialGenMode | null {
  if (mode === "regenerate") return "refine";
  if (mode === "refine") return "slice";
  return null;
}

export function ensureSlotGenPlan(
  slot: MaterialSlot
): MaterialSlot {
  if (slot.genMode && slot.outputSpec) return slot;
  const decision = suggestGenMode({
    role: slot.role,
    bbox: slot.bbox,
    prompt: slot.prompt,
  });
  return {
    ...slot,
    genMode: slot.genMode ?? decision.genMode,
    outputSpec: slot.outputSpec ?? decision.outputSpec,
    genModeConfidence: slot.genModeConfidence ?? decision.confidence,
    genModeReasons: slot.genModeReasons ?? decision.reasons,
  };
}
