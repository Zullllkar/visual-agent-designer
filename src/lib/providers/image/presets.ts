/**
 * 生图 Provider 预设与推荐模型列表
 * --------------------------------------------------------------
 * 默认模型依据 2026-05 公开文档整理；用户可在设置面板自定义 Base URL 与 Model ID。
 *
 * @author：wangjunhua
 */

export type ImagePresetId =
  | "openai-dalle"
  | "openai-gpt-image"
  | "siliconflow"
  | "gemini-image"
  | "replicate";

export type ImageProviderKind =
  | "openai-compatible"
  | "siliconflow"
  | "gemini-image"
  | "replicate";

export interface ImageModelOption {
  id: string;
  label: string;
  /** 简短说明，渲染在模型下拉旁 */
  note?: string;
}

export interface ImageProviderPreset {
  id: ImagePresetId;
  label: string;
  kind: ImageProviderKind;
  /** 一键填充的默认接口地址（用户可改） */
  defaultBaseURL: string;
  baseURLPlaceholder: string;
  /** 一键填充的默认模型 */
  defaultModel: string;
  modelPlaceholder: string;
  /** 推荐模型列表（下拉可选） */
  models: ImageModelOption[];
}

/** 生图预设清单 — 按服务商分组。 */
export const IMAGE_PROVIDER_PRESETS: ImageProviderPreset[] = [
  {
    id: "openai-dalle",
    label: "OpenAI DALL-E 3",
    kind: "openai-compatible",
    defaultBaseURL: "https://api.openai.com/v1",
    baseURLPlaceholder: "https://api.openai.com/v1",
    defaultModel: "dall-e-3",
    modelPlaceholder: "dall-e-3",
    models: [{ id: "dall-e-3", label: "dall-e-3", note: "经典 DALL-E 3" }],
  },
  {
    id: "openai-gpt-image",
    label: "OpenAI GPT Image",
    kind: "openai-compatible",
    defaultBaseURL: "https://api.openai.com/v1",
    baseURLPlaceholder: "https://api.openai.com/v1",
    /** 2026-04 GA：gpt-image-2 为当前最新旗舰生图模型 */
    defaultModel: "gpt-image-2",
    modelPlaceholder: "gpt-image-2 / gpt-image-1.5 / gpt-image-1",
    models: [
      {
        id: "gpt-image-2",
        label: "gpt-image-2",
        note: "最新 · 2026-04 GA · 更强文字与布局",
      },
      {
        id: "gpt-image-1.5",
        label: "gpt-image-1.5",
        note: "上一代 GPT Image",
      },
      {
        id: "gpt-image-1",
        label: "gpt-image-1",
        note: "稳定版 · 支持 quality/format",
      },
      {
        id: "gpt-image-1-mini",
        label: "gpt-image-1-mini",
        note: "轻量 · 低成本",
      },
    ],
  },
  {
    id: "siliconflow",
    label: "SiliconFlow FLUX",
    kind: "siliconflow",
    defaultBaseURL: "https://api.siliconflow.cn/v1",
    baseURLPlaceholder: "https://api.siliconflow.cn/v1 或 https://api.siliconflow.com/v1",
    defaultModel: "black-forest-labs/FLUX.1-Kontext-pro",
    modelPlaceholder: "black-forest-labs/FLUX.1-Kontext-pro",
    models: [
      {
        id: "black-forest-labs/FLUX.1-Kontext-pro",
        label: "FLUX.1-Kontext-pro",
        note: "推荐 · 编辑/变体能力强",
      },
      {
        id: "black-forest-labs/FLUX.1-Kontext-max",
        label: "FLUX.1-Kontext-max",
        note: "最高质量 Kontext",
      },
      {
        id: "black-forest-labs/FLUX-1.1-pro",
        label: "FLUX-1.1-pro",
        note: "Pro 系列",
      },
      {
        id: "black-forest-labs/FLUX-1.1-pro-Ultra",
        label: "FLUX-1.1-pro-Ultra",
        note: "Ultra 高细节",
      },
      {
        id: "black-forest-labs/FLUX.1-dev",
        label: "FLUX.1-dev",
        note: "开发/实验",
      },
      {
        id: "black-forest-labs/FLUX.1-schnell",
        label: "FLUX.1-schnell",
        note: "最快 · 低成本",
      },
    ],
  },
  {
    id: "gemini-image",
    label: "Gemini Image (Nano Banana)",
    kind: "gemini-image",
    defaultBaseURL: "https://generativelanguage.googleapis.com",
    baseURLPlaceholder:
      "https://generativelanguage.googleapis.com（或 Vertex / 代理地址）",
    /** 2026-05 GA：Nano Banana 2 */
    defaultModel: "gemini-3.1-flash-image",
    modelPlaceholder: "gemini-3.1-flash-image / gemini-3-pro-image",
    models: [
      {
        id: "gemini-3.1-flash-image",
        label: "gemini-3.1-flash-image",
        note: "Nano Banana 2 · 最新 GA · 高速",
      },
      {
        id: "gemini-3-pro-image",
        label: "gemini-3-pro-image",
        note: "Nano Banana Pro · 高精度",
      },
      {
        id: "gemini-2.5-flash-image",
        label: "gemini-2.5-flash-image",
        note: "Nano Banana · 上一代 GA",
      },
    ],
  },
  {
    id: "replicate",
    label: "Replicate (Flux/SDXL)",
    kind: "replicate",
    defaultBaseURL: "https://api.replicate.com/v1",
    baseURLPlaceholder: "https://api.replicate.com/v1",
    defaultModel: "black-forest-labs/flux-1.1-pro",
    modelPlaceholder: "black-forest-labs/flux-1.1-pro",
    models: [
      {
        id: "black-forest-labs/flux-1.1-pro",
        label: "Flux 1.1 Pro",
        note: "高质量 · 推荐",
      },
      {
        id: "black-forest-labs/flux-1.1-pro-ultra",
        label: "Flux 1.1 Pro Ultra",
        note: "最高细节",
      },
      {
        id: "black-forest-labs/flux-schnell",
        label: "Flux Schnell",
        note: "最快 · 低成本",
      },
      {
        id: "stability-ai/sdxl",
        label: "SDXL",
        note: "Stable Diffusion XL",
      },
    ],
  },
];

export function getImagePreset(id: ImagePresetId): ImageProviderPreset {
  return (
    IMAGE_PROVIDER_PRESETS.find((p) => p.id === id) ?? IMAGE_PROVIDER_PRESETS[0]
  );
}

/** 根据已保存 kind + model 推断最接近的预设（用于恢复 UI）。 */
export function inferImagePresetId(input: {
  kind: ImageProviderKind;
  model: string;
}): ImagePresetId {
  if (input.kind === "gemini-image") return "gemini-image";
  if (input.kind === "replicate") return "replicate";
  if (input.kind === "siliconflow") return "siliconflow";
  if (/^gpt-image/i.test(input.model)) return "openai-gpt-image";
  return "openai-dalle";
}

/** gpt-image-2 不支持 transparent background（OpenAI 文档 2026-04）。 */
export function supportsTransparentBackground(model: string): boolean {
  return /^gpt-image/i.test(model) && !/^gpt-image-2/i.test(model);
}
