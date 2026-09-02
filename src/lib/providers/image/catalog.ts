/**
 * 生图 Provider 目录（预设 + 最新模型清单）
 * --------------------------------------------------------------
 * 模型 ID 来源：OpenAI / Google Gemini / SiliconFlow 官方文档（2026-05）。
 * 用户可在设置面板自定义 Base URL 与 Model ID。
 *
 * @author：wangjunhua
 */

export type ImagePresetId =
  | "openai-dalle"
  | "openai-gpt-image"
  | "siliconflow"
  | "gemini-image"
  | "replicate";

export interface ImageModelOption {
  id: string;
  label: string;
  /** 简短说明，渲染在 UI 下拉项 */
  note?: string;
}

export interface ImageProviderPreset {
  id: ImagePresetId;
  label: string;
  company: string;
  description: string;
  badge: string;
  kind: "openai-compatible" | "siliconflow" | "gemini-image" | "replicate";
  /** 默认接口地址（可被用户覆盖） */
  defaultBaseURL: string;
  baseURLPlaceholder: string;
  baseURLHint: string;
  /** 选中该预设时的默认模型 */
  defaultModel: string;
  /** 推荐模型列表（下拉快速选择） */
  models: ImageModelOption[];
  modelHint: string;
}

/** 生图服务预设与推荐模型（按官方文档维护）。 */
export const IMAGE_PROVIDER_CATALOG: ImageProviderPreset[] = [
  {
    id: "openai-dalle",
    label: "OpenAI DALL-E",
    company: "OpenAI",
    description: "经典文本生图，兼容 OpenAI 图像接口。",
    badge: "经典",
    kind: "openai-compatible",
    defaultBaseURL: "https://api.openai.com/v1",
    baseURLPlaceholder: "https://api.openai.com/v1",
    baseURLHint: "OpenAI 官方或任意 OpenAI 兼容代理 / 网关",
    defaultModel: "dall-e-3",
    models: [
      { id: "dall-e-3", label: "dall-e-3", note: "经典 DALL-E 3" },
      { id: "dall-e-2", label: "dall-e-2", note: "旧版，价格低" },
    ],
    modelHint: "dall-e-3 / dall-e-2",
  },
  {
    id: "openai-gpt-image",
    label: "OpenAI GPT Image",
    company: "OpenAI",
    description: "高质量生成与编辑，支持质量、格式和背景控制。",
    badge: "推荐",
    kind: "openai-compatible",
    defaultBaseURL: "https://api.openai.com/v1",
    baseURLPlaceholder: "https://api.openai.com/v1",
    baseURLHint: "OpenAI 官方；也支持 OpenRouter 等兼容网关",
    defaultModel: "gpt-image-2",
    models: [
      {
        id: "gpt-image-2",
        label: "gpt-image-2",
        note: "2026-04 最新，推荐",
      },
      {
        id: "gpt-image-1.5",
        label: "gpt-image-1.5",
        note: "上一代 GPT Image",
      },
      {
        id: "gpt-image-1",
        label: "gpt-image-1",
        note: "稳定版",
      },
      {
        id: "gpt-image-1-mini",
        label: "gpt-image-1-mini",
        note: "轻量低成本",
      },
    ],
    modelHint: "gpt-image-2 / gpt-image-1.5 / gpt-image-1",
  },
  {
    id: "siliconflow",
    label: "SiliconFlow FLUX",
    company: "SiliconFlow",
    description: "国内友好的 FLUX 与 Stable Diffusion 模型聚合服务。",
    badge: "国内",
    kind: "siliconflow",
    defaultBaseURL: "https://api.siliconflow.cn/v1",
    baseURLPlaceholder: "https://api.siliconflow.cn/v1",
    baseURLHint: "国内 api.siliconflow.cn；国际可用 api.siliconflow.com/v1",
    defaultModel: "black-forest-labs/FLUX.1-Kontext-pro",
    models: [
      {
        id: "black-forest-labs/FLUX.1-Kontext-pro",
        label: "FLUX.1 Kontext Pro",
        note: "2026 推荐，图文编辑",
      },
      {
        id: "black-forest-labs/FLUX-1.1-pro",
        label: "FLUX 1.1 Pro",
        note: "高质量",
      },
      {
        id: "black-forest-labs/FLUX.1-dev",
        label: "FLUX.1 Dev",
        note: "开发调试",
      },
      {
        id: "black-forest-labs/FLUX.1-schnell",
        label: "FLUX.1 Schnell",
        note: "最快",
      },
      {
        id: "stabilityai/stable-diffusion-3-5-large",
        label: "SD 3.5 Large",
        note: "Stability AI",
      },
    ],
    modelHint: "FLUX.1-Kontext-pro / FLUX.1-dev / FLUX.1-schnell",
  },
  {
    id: "gemini-image",
    label: "Gemini Image",
    company: "Google",
    description: "Nano Banana 系列，多模态生成与图像编辑。",
    badge: "多模态",
    kind: "gemini-image",
    defaultBaseURL: "https://generativelanguage.googleapis.com",
    baseURLPlaceholder: "https://generativelanguage.googleapis.com",
    baseURLHint: "Google AI Studio 官方；Vertex AI 等代理需填对应 generateContent 根地址",
    defaultModel: "gemini-3.1-flash-image",
    models: [
      {
        id: "gemini-3.1-flash-image",
        label: "gemini-3.1-flash-image",
        note: "Nano Banana 2 · GA · 推荐",
      },
      {
        id: "gemini-3.1-flash-lite-image",
        label: "gemini-3.1-flash-lite-image",
        note: "Nano Banana 2 Lite · 更快",
      },
      {
        id: "gemini-3-pro-image",
        label: "gemini-3-pro-image",
        note: "Nano Banana Pro · 高精度",
      },
      {
        id: "gemini-2.5-flash-image",
        label: "gemini-2.5-flash-image",
        note: "Nano Banana · 上一代",
      },
    ],
    modelHint: "gemini-3.1-flash-image / gemini-3-pro-image",
  },
  {
    id: "replicate",
    label: "Replicate",
    company: "Replicate",
    description: "托管 Flux、SDXL 等开源模型，按调用计费。",
    badge: "模型库",
    kind: "replicate",
    defaultBaseURL: "https://api.replicate.com/v1",
    baseURLPlaceholder: "https://api.replicate.com/v1",
    baseURLHint: "Replicate 官方 API；需要 REPLICATE_API_TOKEN",
    defaultModel: "black-forest-labs/flux-1.1-pro",
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
    modelHint: "black-forest-labs/flux-1.1-pro / flux-schnell",
  },
];

export function getImagePreset(id: ImagePresetId): ImageProviderPreset {
  const preset = IMAGE_PROVIDER_CATALOG.find((p) => p.id === id);
  if (!preset) return IMAGE_PROVIDER_CATALOG[0];
  return preset;
}

/** @deprecated 使用 IMAGE_PROVIDER_CATALOG */
export const IMAGE_PRESETS = IMAGE_PROVIDER_CATALOG.map((p) => ({
  id: p.id,
  label: p.label,
  kind: p.kind,
  baseURL: p.defaultBaseURL,
  model: p.defaultModel,
  modelHint: p.modelHint,
}));
