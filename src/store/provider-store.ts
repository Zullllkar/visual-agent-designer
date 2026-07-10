"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ProviderConfig } from "@/lib/providers/registry";

/**
 * Provider 配置 store（localStorage 持久化）
 * --------------------------------------------------------------
 * 保存用户的 LLM 接入配置：API Key / baseURL / model。
 *
 * 安全说明：本工具是本地优先开发工具，apiKey 仅写入当前浏览器
 * localStorage，不上传任何外部服务器。每次生成请求由本机的 Next API
 * 代为转发到目标 LLM 服务。
 */

interface ProviderStoreState {
  config: ProviderConfig;
  setConfig: (cfg: ProviderConfig) => void;
  clear: () => void;
}

const DEFAULT: ProviderConfig = {
  llm: { kind: "mock" },
  image: { kind: "mock" },
  sliders: {
    pageCount: 3,
    uiDensity: 60,
    styleIntensity: 5,
    repairThreshold: 8,
    contentTone: "professional",
    contentLocale: "zh-CN",
  },
};

export const useProviderStore = create<ProviderStoreState>()(
  persist(
    (set) => ({
      config: DEFAULT,
      setConfig: (cfg) => set({ config: cfg }),
      clear: () => set({ config: DEFAULT }),
    }),
    {
      name: "vad.providers.v2",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ config: s.config }),
    }
  )
);

/** 常用预设，给 UI 一键填充。 */
export const LLM_PRESETS: Array<{
  id: string;
  label: string;
  baseURL: string;
  modelHint: string;
}> = [
  {
    id: "openai",
    label: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    modelHint: "gpt-4o-mini / gpt-4o",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    baseURL: "https://api.anthropic.com",
    modelHint: "claude-3-5-sonnet-20241022 / claude-3-5-haiku-latest",
  },
  {
    id: "gemini",
    label: "Gemini",
    baseURL: "https://generativelanguage.googleapis.com",
    modelHint: "gemini-1.5-flash / gemini-1.5-pro / gemini-2.0-flash",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseURL: "https://api.deepseek.com/v1",
    modelHint: "deepseek-chat / deepseek-reasoner",
  },
  {
    id: "qwen",
    label: "通义千问",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    modelHint: "qwen-plus / qwen-max",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    modelHint: "anthropic/claude-3.5-sonnet",
  },
  {
    id: "ollama",
    label: "Ollama (本地)",
    baseURL: "http://localhost:11434/v1",
    modelHint: "qwen2.5:14b / llama3.1:8b",
  },
];

/** 生图预设 — 见 @/lib/providers/image/catalog */
export {
  IMAGE_PROVIDER_CATALOG,
  IMAGE_PRESETS,
  getImagePreset,
  type ImagePresetId,
  type ImageProviderPreset,
  type ImageModelOption,
} from "@/lib/providers/image/catalog";
