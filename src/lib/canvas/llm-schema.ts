/**
 * LLM 友好的 Canvas 输出 Schema
 * --------------------------------------------------------------
 * 与运行时 Canvas Schema 的差异：
 *   - 不要求 id（由后处理生成 nanoid）
 *   - image 节点用 `imagePrompt`（英文）代替 `src`：
 *     图像 src 由 ImageProvider 产出后写回
 *   - 字段尽量扁平且可选，让模型容易输出合规 JSON
 *
 * 经过 zod 校验后会被 materializePages 转换成 CanvasPage[]。
 */

import { z } from "zod";

const Color = z.string();
const NonNeg = z.number().min(0);

const LlmNodeBase = z.object({
  x: z.number(),
  y: z.number(),
  width: NonNeg,
  height: NonNeg,
});

export const LlmFrameNodeSchema = LlmNodeBase.extend({
  type: z.literal("frame"),
  fill: Color.optional(),
  radius: NonNeg.optional(),
});

export const LlmTextNodeSchema = LlmNodeBase.extend({
  type: z.literal("text"),
  content: z.string(),
  color: Color.optional(),
  fontSize: NonNeg.optional(),
  fontWeight: z.number().int().min(100).max(900).optional(),
  align: z.enum(["left", "center", "right"]).optional(),
});

export const LlmImageNodeSchema = LlmNodeBase.extend({
  type: z.literal("image"),
  imagePrompt: z.string(),
  radius: NonNeg.optional(),
});

export const LlmButtonNodeSchema = LlmNodeBase.extend({
  type: z.literal("button"),
  label: z.string(),
  fill: Color.optional(),
  color: Color.optional(),
  radius: NonNeg.optional(),
});

export const LlmCardNodeSchema = LlmNodeBase.extend({
  type: z.literal("card"),
  fill: Color.optional(),
  radius: NonNeg.optional(),
  title: z.string().optional(),
  body: z.string().optional(),
});

export const LlmCanvasNodeSchema = z.discriminatedUnion("type", [
  LlmFrameNodeSchema,
  LlmTextNodeSchema,
  LlmImageNodeSchema,
  LlmButtonNodeSchema,
  LlmCardNodeSchema,
]);

export const LlmCanvasPageSchema = z.object({
  name: z.string().min(1),
  width: NonNeg,
  height: NonNeg,
  background: Color.optional(),
  nodes: z.array(LlmCanvasNodeSchema),
});

export const LlmLayoutOutputSchema = z.object({
  pages: z.array(LlmCanvasPageSchema).min(1).max(6),
});

export type LlmCanvasNode = z.infer<typeof LlmCanvasNodeSchema>;
export type LlmCanvasPage = z.infer<typeof LlmCanvasPageSchema>;
export type LlmLayoutOutput = z.infer<typeof LlmLayoutOutputSchema>;
