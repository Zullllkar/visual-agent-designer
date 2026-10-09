/**
 * 素材设计规格（图 → 结构化中间层，供 Handoff / coding agent 使用）
 * 不是 HTML，而是布局 / token / 区块 / 组件清单。
 * @author：wangjunhua
 */

import { z } from "zod";

/**
 * 生图前定好的 UI 文案（headline / CTA / 导航项…）。
 * 这是文案的权威来源；Vision 从生成图上读回来的字只是佐证。
 */
export const CopyPlanItemSchema = z.object({
  id: z.string(),
  role: z
    .enum(["headline", "subhead", "cta", "nav", "label", "body", "caption", "other"])
    .default("other"),
  text: z.string().min(1),
});

export type CopyPlanItem = z.infer<typeof CopyPlanItemSchema>;

export const DesignSpecRegionSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z
    .enum([
      "nav",
      "hero",
      "sidebar",
      "main",
      "card",
      "form",
      "cta",
      "footer",
      "illustration",
      "background",
      "avatar",
      "icon",
      "decoration",
      "other",
    ])
    .default("other"),
  /** 相对原图 0–1；媒体区应尽量提供 */
  bbox: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      w: z.number().min(0).max(1),
      h: z.number().min(0).max(1),
    })
    .optional(),
  copy: z.string().optional(),
  /**
   * plan   = 与生图前的 copyPlan 对上了，copy 是权威文案
   * prompt = 与 imagePrompt 里的引号文本对上了
   * vision = 只有 Vision 从生成图上读出来的字，可能有错别字，只当提示
   */
  copySource: z.enum(["plan", "prompt", "vision"]).optional(),
  /** copySource 非 vision 时，Vision 实际读到的原文（便于对照） */
  copyObserved: z.string().optional(),
  notes: z.string().optional(),
  /**
   * 代码区域的交互 / 数据状态（hover、disabled、empty、loading、error…）。
   * 静态图上看不见，由 role + 文案 + 产品语境推断；agent 实现时必须覆盖。
   */
  states: z
    .array(
      z.object({
        name: z.string(),
        notes: z.string(),
        /** 该状态下的替代文案（空态提示、错误信息等） */
        copy: z.string().optional(),
      })
    )
    .optional(),
  /** 媒体槽专用英文生图 prompt（拆素材时使用） */
  materialPrompt: z.string().optional(),
  /** Vision 判定：media=独立生图零件；code=用组件/HTML 实现 */
  delivery: z.enum(["media", "code"]).optional(),
  /** 像素采样得到的区域主色（不是 LLM 猜的），供 coding agent 直接用 */
  swatch: z
    .object({
      dominant: z.string(),
      accent: z.string().optional(),
      dominantShare: z.number().min(0).max(1).optional(),
    })
    .optional(),
});

export const DesignSpecTokensSchema = z.object({
  colors: z
    .array(
      z.object({
        name: z.string(),
        value: z.string(),
        usage: z.string().optional(),
        /** pixels=图片采样；vision=LLM 读图；prompt=从文字里捞的 hex */
        source: z.enum(["pixels", "vision", "prompt"]).optional(),
        /** pixels 来源时的覆盖率 0–1 */
        share: z.number().min(0).max(1).optional(),
      })
    )
    .default([]),
  typography: z
    .array(
      z.object({
        role: z.string(),
        sizePx: z.number().optional(),
        weight: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .default([]),
  radii: z.array(z.number()).default([]),
  spacingHints: z.array(z.string()).default([]),
});

export const DesignSpecComponentSchema = z.object({
  name: z.string(),
  kind: z
    .enum([
      "button",
      "input",
      "card",
      "nav",
      "list",
      "modal",
      "tab",
      "badge",
      "avatar",
      "other",
    ])
    .default("other"),
  variants: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

/**
 * 材质/光感 DNA —— 只描述「长什么样」，禁止页面结构词。
 * 供 StyleLock / 零件生图使用，与 layout summary 解耦。
 */
export const DesignSpecArtStyleSchema = z.object({
  finish: z.string().default(""),
  lighting: z.string().default(""),
  texture: z.string().default(""),
  edge: z.string().default(""),
  accent: z.string().default(""),
});

export const AssetDesignSpecSchema = z.object({
  version: z.literal(1).default(1),
  assetId: z.string(),
  summary: z.string(),
  screenType: z
    .enum([
      "landing",
      "dashboard",
      "mobile-app",
      "desktop-app",
      "marketing",
      "illustration",
      "other",
    ])
    .default("other"),
  layout: z.string(),
  hierarchy: z.array(z.string()).default([]),
  regions: z.array(DesignSpecRegionSchema).default([]),
  tokens: DesignSpecTokensSchema.default({
    colors: [],
    typography: [],
    radii: [],
    spacingHints: [],
  }),
  components: z.array(DesignSpecComponentSchema).default([]),
  /** 视觉材质 DNA（与 layout 无关） */
  artStyle: DesignSpecArtStyleSchema.optional(),
  doNot: z.array(z.string()).default([]),
  implementationNotes: z.array(z.string()).default([]),
  /** 生图前定好的文案（来自 asset.copyPlan），整份随规格交付 */
  copyPlan: z.array(CopyPlanItemSchema).optional(),
  /** copyPlan 里没能对应到任何 region 的文案：图上没画出来，但实现时仍必须有 */
  unplacedCopy: z.array(CopyPlanItemSchema).optional(),
  source: z.enum(["vision", "heuristic"]).default("heuristic"),
  model: z.string().optional(),
  /** Vision 失败 / 回退 heuristic 时的可读告警 */
  extractionWarnings: z.array(z.string()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AssetDesignSpec = z.infer<typeof AssetDesignSpecSchema>;
export type DesignSpecRegion = z.infer<typeof DesignSpecRegionSchema>;
export type DesignSpecTokens = z.infer<typeof DesignSpecTokensSchema>;
export type DesignSpecArtStyle = z.infer<typeof DesignSpecArtStyleSchema>;
