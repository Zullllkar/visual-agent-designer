/**
 * Image Asset Schema
 * --------------------------------------------------------------
 * 项目级图像资产库（ImageWorkspace 的数据模型）。
 *
 * 每个 ImageAsset 代表一次"图像模型 run"产出的单张候选图，
 * 含完整可追溯元信息（prompt / model / seed / 耗时 / 来源）。
 *
 * 与 CanvasPage 内的 image node 关系：
 *   - 用户先在 ImagePane 用 prompt 跑出 N 张候选 → 写入 project.assets[]
 *   - 之后可"拖入"某个 page → 在该 page 创建一个 image node，
 *     node.generation 字段引用 asset.id 形成 1:N 关系
 *
 * 不直接 inline 进 image node 是因为：
 *   - 同一张候选图可能被多个 page 复用
 *   - 候选图未被采纳前不应"污染" page 的 nodes 列表
 *   - Handoff 阶段可以把 assets 单独导出到 design/assets/*.png
 */

import { z } from "zod";

export const ImageAssetSchema = z.object({
  id: z.string(),
  /** 调用图像模型时使用的 prompt（包含 visualStyle 前缀） */
  prompt: z.string(),
  /** 候选图：data:image/png;base64,... 或 https://... */
  src: z.string(),
  /** 像素宽高（由请求 size 推断或 image natural size） */
  width: z.number(),
  height: z.number(),
  /** 图像模型 id */
  model: z.string(),
  seed: z.string().optional(),
  durationMs: z.number().optional(),
  costUsd: z.number().optional(),
  createdAt: z.string(),
  /** 同一轮 generate 请求生成的多张候选共享 batchId */
  batchId: z.string().optional(),
  /**
   * 状态机：
   *   generating — 流水线生图中（占位卡片）
   *   candidate  — 刚生成，待选
   *   starred    — 用户收藏
   *   used       — 已拖入某个 page
   *   discarded  — 用户主动丢弃（仍保留在 assets 用于追溯）
   */
  status: z
    .enum(["generating", "candidate", "starred", "used", "discarded"])
    .optional()
    .default("candidate"),
  /** 如果 status=used，记录被哪些 page 引用 */
  usedInPages: z.array(z.string()).optional(),
  /** 可选标签 */
  tags: z.array(z.string()).optional(),
  /** 来源类型：生成、编辑、上传或参考图。 */
  source: z.enum(["generated", "edited", "uploaded", "reference"]).optional(),
  /** 派生图的父资产。 */
  parentAssetId: z.string().optional(),
  /** 同一组候选或变体共享的 id。 */
  variantGroupId: z.string().optional(),
  /** 图片在设计中的角色。 */
  role: z
    .enum(["hero", "illustration", "product-shot", "background", "icon", "avatar"])
    .optional(),
  /** 被哪些具体节点使用。 */
  usedInNodes: z
    .array(
      z.object({
        pageId: z.string(),
        nodeId: z.string(),
      })
    )
    .optional(),
  /** 用于生成编辑版本的自然语言指令。 */
  editInstruction: z.string().optional(),
  /** 框选重绘区域（相对原图 0–1）。 */
  editRegion: z
    .object({
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
    })
    .optional(),
  /** 参考图 id 列表。 */
  referenceAssetIds: z.array(z.string()).optional(),
  /** 生成时所使用的设计记忆版本。 */
  designContextVersion: z.number().optional(),
});

export type ImageAsset = z.infer<typeof ImageAssetSchema>;

export const ReferenceAssetSchema = z.object({
  id: z.string(),
  /** 用户可读名称：文件名、URL 标题或手动命名。 */
  label: z.string(),
  /** 参考图：data:image/...;base64,... 或 https://... */
  src: z.string(),
  width: z.number(),
  height: z.number(),
  /** 来源类型：上传、URL、截图、粘贴板等。 */
  source: z.enum(["upload", "url", "screenshot", "clipboard"]).default("upload"),
  createdAt: z.string(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export type ReferenceAsset = z.infer<typeof ReferenceAssetSchema>;
