/**
 * Brand Kit Schema
 * --------------------------------------------------------------
 * 品牌套件数据模型：定义项目的品牌颜色、字体、Logo、语气和设计原则。
 * 可被 Agent 工具查询，也可注入到 DesignContext 中保持视觉一致性。
 */

import { z } from "zod";

export const BrandColorSchema = z.object({
  name: z.string(),
  value: z.string(),
  usage: z.string().optional(),
});

export const BrandTypographySchema = z.object({
  heading: z.string(),
  body: z.string(),
  mono: z.string().optional(),
  notes: z.string().optional(),
});

export const BrandAssetSchema = z.object({
  id: z.string(),
  type: z.enum(["logo", "icon", "illustration", "texture"]),
  label: z.string(),
  src: z.string(),
  mimeType: z.string().optional(),
});

export const BrandKitSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  colors: z.array(BrandColorSchema),
  typography: BrandTypographySchema,
  assets: z.array(BrandAssetSchema).optional(),
  brandVoice: z.string().optional(),
  doList: z.array(z.string()).optional(),
  avoidList: z.array(z.string()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type BrandColor = z.infer<typeof BrandColorSchema>;
export type BrandTypography = z.infer<typeof BrandTypographySchema>;
export type BrandAsset = z.infer<typeof BrandAssetSchema>;
export type BrandKit = z.infer<typeof BrandKitSchema>;
