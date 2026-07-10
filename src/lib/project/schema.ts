/**
 * Project Schema
 * --------------------------------------------------------------
 * 一个 Visual Agent Designer 项目在本地的顶层数据结构。
 * 对应 .vad/projects/<slug>/project.json。
 */

import { z } from "zod";
import { CanvasPageSchema } from "@/lib/canvas/schema";
import {
  ProjectCritiqueSchema,
  CritiqueHistoryEntrySchema,
} from "@/lib/agents/critic-schema";
import { ImageAssetSchema, ReferenceAssetSchema } from "./assets-schema";

export const ProductBriefSchema = z.object({
  productName: z.string(),
  positioning: z.string(),
  targetUser: z.string(),
  scenarios: z.array(z.string()),
  coreFeatures: z.array(z.string()),
  platform: z.enum(["app", "web", "miniapp", "extension", "landing", "other"]),
  visualStyle: z.string(),
  outputTargets: z.array(z.enum(["cursor", "claude-code", "codex", "markdown"])),
});

export const PrototypeFlowSchema = z.object({
  flows: z.array(z.string()),
  pages: z.array(z.string()),
});

/** Product Architect 产出的信息架构。 */
export const ProductArchitectureSchema = z.object({
  userFlows: z.array(z.string()),
  pages: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      purpose: z.string(),
      priority: z.enum(["primary", "secondary", "utility"]).optional(),
    })
  ),
  summary: z.string().optional(),
});

/** Design Director 产出的视觉方向（不替代 DESIGN.md token，是语义层摘要）。 */
export const DesignDirectionSchema = z.object({
  summary: z.string(),
  moodKeywords: z.array(z.string()),
  typographyNotes: z.string().optional(),
  layoutNotes: z.string().optional(),
  /** 若与项目 designSystemId 不同，记录 Director 建议切换的系统 id。 */
  recommendedDesignSystemId: z.string().optional(),
});

/** 项目级设计记忆：用于跨轮次保持品牌、视觉与内容一致性。 */
export const DesignContextSchema = z.object({
  version: z.literal(1),
  source: z.enum(["derived", "user", "agent"]).default("derived"),
  brandVoice: z.string(),
  moodKeywords: z.array(z.string()),
  colorTokens: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
      usage: z.string(),
    })
  ),
  typography: z.object({
    heading: z.string(),
    body: z.string(),
    notes: z.string().optional(),
  }),
  layoutPrinciples: z.array(z.string()),
  componentPrinciples: z.array(z.string()),
  imageStyle: z.string(),
  doList: z.array(z.string()),
  avoidList: z.array(z.string()),
  updatedAt: z.string(),
});

export const CanvasSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.string(),
  shapes: z.array(z.record(z.string(), z.unknown())),
});

export const ProjectFileSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  /** 用户原始一句话产品想法。 */
  rawIdea: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  brief: ProductBriefSchema.optional(),
  /** Product Architect Agent 产出。 */
  architecture: ProductArchitectureSchema.optional(),
  /** Design Director Agent 产出。 */
  designDirection: DesignDirectionSchema.optional(),
  /** Lovart-style 项目级设计上下文记忆。 */
  designContext: DesignContextSchema.optional(),
  prototype: PrototypeFlowSchema.optional(),
  pages: z.array(CanvasPageSchema),
  critique: ProjectCritiqueSchema.optional(),
  /** 评审迭代历史；末项的 accepted=true 即当前 critique 对应轮次。 */
  critiqueHistory: z.array(CritiqueHistoryEntrySchema).optional(),
  /** 生成本项目时使用的 SKILL.md id（追溯用）。 */
  skillId: z.string().optional(),
  /** 生成本项目时使用的 DESIGN.md id（追溯用）。 */
  designSystemId: z.string().optional(),
  /**
   * Image Workspace 候选图库。
   * 每张图带完整 model run metadata，可追溯到具体模型/prompt/seed。
   * Handoff 时单独导出到 design/assets/*。
   */
  assets: z.array(ImageAssetSchema).optional(),
  /**
   * 参考素材库。
   * 与 Image Workspace 生成图不同，ReferenceAsset 代表用户上传 / URL /
   * 截图 / 剪贴板导入的参考图，用于再设计、风格参考和竞品分析。
   */
  references: z.array(ReferenceAssetSchema).optional(),
  canvasSnapshot: CanvasSnapshotSchema.optional(),
});

export type ProductBrief = z.infer<typeof ProductBriefSchema>;
export type ProductArchitecture = z.infer<typeof ProductArchitectureSchema>;
export type DesignDirection = z.infer<typeof DesignDirectionSchema>;
export type DesignContext = z.infer<typeof DesignContextSchema>;
export type PrototypeFlow = z.infer<typeof PrototypeFlowSchema>;
export type CanvasSnapshot = z.infer<typeof CanvasSnapshotSchema>;
export type ProjectFile = z.infer<typeof ProjectFileSchema>;
