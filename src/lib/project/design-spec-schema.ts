/**
 * 素材设计规格（图 → 结构化中间层，供 Handoff / coding agent 使用）
 * 不是 HTML，而是布局 / token / 区块 / 组件清单。
 * @author：wangjunhua
 */

import { z } from "zod";

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
  notes: z.string().optional(),
  /** 媒体槽专用英文生图 prompt（拆素材时使用） */
  materialPrompt: z.string().optional(),
  /** Vision 判定：media=独立生图零件；code=用组件/HTML 实现 */
  delivery: z.enum(["media", "code"]).optional(),
});

export const DesignSpecTokensSchema = z.object({
  colors: z
    .array(
      z.object({
        name: z.string(),
        value: z.string(),
        usage: z.string().optional(),
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
