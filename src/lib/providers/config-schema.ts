import { z } from "zod";

/**
 * ProviderConfig 的运行时校验 schema（多个 route 共用）
 * --------------------------------------------------------------
 * 客户端 zustand store 里的 ProviderConfig 通过 fetch body 送达后端，
 * 后端用这个 schema 校验后再传给 resolveProviders()。
 *
 * 字段必须与 @/lib/providers/registry.ts ProviderConfig 接口保持同步。
 */
/** 与 registry.ProviderConfig 同步；请求体必须为完整对象（不可省略）。 */
export const ProviderConfigSchema = z.object({
  llm: z
    .union([
      z.object({ kind: z.literal("mock") }),
      z.object({
        kind: z.literal("openai-compatible"),
        baseURL: z.string().url(),
        apiKey: z.string().min(1),
        model: z.string().min(1),
      }),
      z.object({
        kind: z.literal("anthropic"),
        baseURL: z.string().url().optional(),
        apiKey: z.string().min(1),
        model: z.string().min(1),
      }),
      z.object({
        kind: z.literal("gemini"),
        baseURL: z.string().url().optional(),
        apiKey: z.string().min(1),
        model: z.string().min(1),
      }),
      z.object({
        kind: z.literal("deepseek"),
        apiKey: z.string().min(1),
        model: z.string().min(1),
      }),
    ])
    .optional(),
  image: z
    .union([
      z.object({ kind: z.literal("mock") }),
      z.object({
        kind: z.literal("openai-compatible"),
        baseURL: z.string().url(),
        apiKey: z.string().min(1),
        model: z.string().min(1),
        defaultSize: z.string().optional(),
        quality: z.enum(["low", "medium", "high", "auto"]).optional(),
        outputFormat: z.enum(["png", "jpeg", "webp"]).optional(),
        background: z.enum(["transparent", "opaque", "auto"]).optional(),
      }),
      z.object({
        kind: z.literal("siliconflow"),
        apiKey: z.string().min(1),
        model: z.string().min(1),
        baseURL: z.string().url().optional(),
        defaultSize: z.string().optional(),
      }),
      z.object({
        kind: z.literal("gemini-image"),
        apiKey: z.string().min(1),
        model: z.string().min(1),
        baseURL: z.string().url().optional(),
        aspectRatio: z
          .enum(["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"])
          .optional(),
      }),
      z.object({
        kind: z.literal("replicate"),
        apiKey: z.string().min(1),
        model: z.string().min(1),
        baseURL: z.string().url().optional(),
      }),
    ])
    .optional(),
  visionCritic: z.boolean().optional(),
  skillId: z.string().optional(),
  designSystemId: z.string().optional(),
  allowMockDev: z.boolean().optional(),
  sliders: z
    .object({
      pageCount: z.number().optional(),
      uiDensity: z.number().optional(),
      styleIntensity: z.number().optional(),
      repairThreshold: z.number().optional(),
      contentTone: z
        .enum(["professional", "friendly", "playful", "luxury", "technical"])
        .optional(),
      contentLocale: z.enum(["zh-CN", "en-US", "bilingual"]).optional(),
    })
    .optional(),
});
