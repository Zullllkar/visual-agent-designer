"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ProviderConfig } from "@/lib/providers/registry";
import { createBrowserJsonStorage } from "@/lib/storage/idb-storage";

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
      skipHydration: true,
      storage: createJSONStorage(() => createBrowserJsonStorage()),
      partialize: (s) => ({ config: s.config }),
    },
  ),
);

/** 常用 LLM 服务目录，供设置面板展示品牌、能力与推荐模型。 */
export type LlmPresetId =
  | "openai"
  | "anthropic"
  | "gemini"
  | "deepseek"
  | "qwen"
  | "openrouter"
  | "ollama";

export interface LlmProviderPreset {
  id: LlmPresetId;
  label: string;
  company: string;
  description: string;
  badge: string;
  baseURL: string;
  apiKeyHint: string;
  models: Array<{ id: string; label: string; note: string }>;
  modelHint: string;
}

export const LLM_PRESETS: LlmProviderPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    company: "OpenAI",
    badge: "通用",
    description: "GPT 系列，适合工具调用、视觉理解与复杂编排。",
    baseURL: "https://api.openai.com/v1",
    apiKeyHint: "sk-...",
    models: [
      { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", note: "旗舰推理与编码" },
      { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", note: "质量与成本均衡" },
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", note: "高并发低成本" },
      { id: "gpt-5.6", label: "GPT-5.6", note: "指向 Sol 的别名" },
      { id: "gpt-5.2", label: "GPT-5.2", note: "上一代旗舰" },
      { id: "gpt-4.1", label: "GPT-4.1", note: "稳定工具调用" },
      { id: "gpt-4o-mini", label: "GPT-4o mini", note: "轻量兼容" },
    ],
    modelHint: "gpt-5.6-sol / gpt-5.6-terra / gpt-4o-mini",
  },
  {
    id: "anthropic",
    label: "Claude",
    company: "Anthropic",
    badge: "推理",
    description: "长上下文与设计推理表现稳定，适合复杂 Agent 任务。",
    baseURL: "https://api.anthropic.com",
    apiKeyHint: "sk-ant-...",
    models: [
      { id: "claude-opus-5", label: "Claude Opus 5", note: "最强 Agent 与复杂任务" },
      { id: "claude-sonnet-5", label: "Claude Sonnet 5", note: "质量与速度均衡" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", note: "快速、低成本" },
      { id: "claude-opus-4-8", label: "Claude Opus 4.8", note: "上一代 Opus" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", note: "上一代 Sonnet" },
    ],
    modelHint: "claude-opus-5 / claude-sonnet-5 / claude-haiku-4-5",
  },
  {
    id: "gemini",
    label: "Gemini",
    company: "Google",
    badge: "多模态",
    description: "Google 多模态模型，支持长上下文与视觉任务。",
    baseURL: "https://generativelanguage.googleapis.com",
    apiKeyHint: "AIza...",
    models: [
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", note: "复杂推理与 Agent" },
      { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", note: "最新高速 GA" },
      { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", note: "稳定高速" },
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", note: "低延迟低成本" },
      { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite", note: "轻量子代理" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", note: "上一代通用" },
    ],
    modelHint: "gemini-3.6-flash / gemini-3.1-pro-preview / gemini-3.5-flash",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    company: "DeepSeek",
    badge: "推理",
    description: "中文任务与推理能力突出，官方接口开箱即用。",
    baseURL: "https://api.deepseek.com/v1",
    apiKeyHint: "sk-...",
    models: [
      { id: "deepseek-chat", label: "DeepSeek Chat", note: "通用对话" },
      { id: "deepseek-reasoner", label: "DeepSeek Reasoner", note: "深度推理" },
    ],
    modelHint: "deepseek-chat / deepseek-reasoner",
  },
  {
    id: "qwen",
    label: "通义千问",
    company: "Alibaba Cloud",
    badge: "国内",
    description: "DashScope OpenAI 兼容接口，中文与工具调用友好。",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKeyHint: "sk-...",
    models: [
      { id: "qwen3-max", label: "Qwen3 Max", note: "旗舰复杂任务" },
      { id: "qwen3.5-plus", label: "Qwen3.5 Plus", note: "均衡推荐" },
      { id: "qwen3-coder-plus", label: "Qwen3 Coder Plus", note: "代码与工具调用" },
    ],
    modelHint: "qwen3-max / qwen3.5-plus / qwen3-coder-plus",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    company: "OpenRouter",
    badge: "聚合",
    description: "通过一个兼容接口访问多家模型并灵活切换。",
    baseURL: "https://openrouter.ai/api/v1",
    apiKeyHint: "sk-or-v1-...",
    models: [
      { id: "openai/gpt-5.6-sol", label: "GPT-5.6 Sol", note: "OpenAI 路由" },
      { id: "openai/gpt-5.6-terra", label: "GPT-5.6 Terra", note: "均衡路由" },
      { id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5", note: "Anthropic 路由" },
      { id: "anthropic/claude-opus-5", label: "Claude Opus 5", note: "Anthropic 旗舰" },
      { id: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", note: "Google 路由" },
    ],
    modelHint: "openai/gpt-5.6-sol / anthropic/claude-sonnet-5",
  },
  {
    id: "ollama",
    label: "Ollama",
    company: "Local",
    badge: "本地",
    description: "模型完全运行在本机，适合隐私优先与离线开发。",
    baseURL: "http://localhost:11434/v1",
    apiKeyHint: "ollama（任意非空值）",
    models: [
      { id: "qwen3:14b", label: "Qwen3 14B", note: "中文与工具调用" },
      { id: "llama3.3:70b", label: "Llama 3.3 70B", note: "高质量本地部署" },
      { id: "gemma3:12b", label: "Gemma 3 12B", note: "轻量多模态" },
    ],
    modelHint: "qwen3:14b / llama3.3:70b / gemma3:12b",
  },
];

/** 生图预设 — 见 @/lib/providers/image/catalog */
export {
  getImagePreset,
  IMAGE_PRESETS,
  IMAGE_PROVIDER_CATALOG,
  type ImageModelOption,
  type ImagePresetId,
  type ImageProviderPreset,
} from "@/lib/providers/image/catalog";
