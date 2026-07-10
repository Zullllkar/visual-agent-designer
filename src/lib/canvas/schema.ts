/**
 * Canvas Schema
 * --------------------------------------------------------------
 * 一切设计稿的中间表达。LLM / Layout Agent 产出此结构，
 * 渲染层（SVG / Konva）只是消费者。后续也可被转成 Figma / HTML / Tailwind。
 *
 * Schema 不绑定某个画布库；每个 AI 生成节点记录来源（source）。
 */

import { z } from "zod";

const Color = z.string(); // 暂不强约束 hex/rgba，后续可改成 regex
const NonNeg = z.number().min(0);

const NodeBase = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  width: NonNeg,
  height: NonNeg,
  /** 由哪个 Agent 生成；便于 Handoff 追溯。 */
  source: z.string().optional(),
});

export const FrameNodeSchema = NodeBase.extend({
  type: z.literal("frame"),
  fill: Color.optional(),
  radius: NonNeg.optional(),
});

export const TextNodeSchema = NodeBase.extend({
  type: z.literal("text"),
  content: z.string(),
  color: Color.optional(),
  fontSize: NonNeg.optional(),
  fontWeight: z.number().int().min(100).max(900).optional(),
  align: z.enum(["left", "center", "right"]).optional(),
});

export const ImageNodeSchema = NodeBase.extend({
  type: z.literal("image"),
  src: z.string(), // url 或 data:URL
  alt: z.string().optional(),
  radius: NonNeg.optional(),
  /** 关联的图像生成元数据（prompt / model / seed），便于 Handoff。 */
  generation: z
    .object({
      prompt: z.string(),
      model: z.string(),
      seed: z.string().optional(),
    })
    .optional(),
});

export const ButtonNodeSchema = NodeBase.extend({
  type: z.literal("button"),
  label: z.string(),
  fill: Color.optional(),
  color: Color.optional(),
  radius: NonNeg.optional(),
});

export const CardNodeSchema = NodeBase.extend({
  type: z.literal("card"),
  fill: Color.optional(),
  radius: NonNeg.optional(),
  /** 卡片内的文本片段；保持简单，后续可改成 children: CanvasNode[]。 */
  title: z.string().optional(),
  body: z.string().optional(),
});

export const CanvasNodeSchema = z.discriminatedUnion("type", [
  FrameNodeSchema,
  TextNodeSchema,
  ImageNodeSchema,
  ButtonNodeSchema,
  CardNodeSchema,
]);

export const CanvasPageSchema = z.object({
  id: z.string(),
  name: z.string(),
  width: NonNeg,
  height: NonNeg,
  background: Color.optional(),
  nodes: z.array(CanvasNodeSchema),
});

export type FrameNode = z.infer<typeof FrameNodeSchema>;
export type TextNode = z.infer<typeof TextNodeSchema>;
export type ImageNode = z.infer<typeof ImageNodeSchema>;
export type ButtonNode = z.infer<typeof ButtonNodeSchema>;
export type CardNode = z.infer<typeof CardNodeSchema>;
export type CanvasNode = z.infer<typeof CanvasNodeSchema>;
export type CanvasPage = z.infer<typeof CanvasPageSchema>;
export type CanvasNodeType = CanvasNode["type"];
