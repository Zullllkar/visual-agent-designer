/**
 * OpenAI 兼容生图配置类型（客户端可安全导入）
 * --------------------------------------------------------------
 * 与 openai-compatible.ts 分离，避免 UI 组件误打包 undici / node:net。
 *
 * @author：wangjunhua
 */

export type OpenAIImageQuality = "low" | "medium" | "high" | "auto";
export type OpenAIImageOutputFormat = "png" | "jpeg" | "webp";
export type OpenAIImageBackground = "transparent" | "opaque" | "auto";

export interface OpenAIImageConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  defaultSize?: string;
  quality?: OpenAIImageQuality;
  outputFormat?: OpenAIImageOutputFormat;
  background?: OpenAIImageBackground;
}

/** 是否为 gpt-image-1 / gpt-image-* 系列（展示高级参数表单用）。 */
export function isGptImageModel(model: string): boolean {
  return /^gpt-image/i.test(model);
}
