import type { LlmProvider } from "./llm/types";
import type { ImageProvider } from "./image/types";
import { MockLlmProvider } from "./llm/mock";
import { MockImageProvider } from "./image/mock";
import {
  createOpenAICompatibleProvider,
  type OpenAICompatibleConfig,
} from "./llm/openai-compatible";
import { createOpenAICompatibleImageProvider } from "./image/openai-compatible";
import type { OpenAIImageConfig } from "./image/openai-image-types";
import { createGeminiImageProvider, type GeminiAspectRatio } from "./image/gemini";
import { createAnthropicProvider } from "./llm/anthropic";
import { createGeminiProvider } from "./llm/gemini";
/**
 * Provider 注册表
 * --------------------------------------------------------------
 * 根据用户运行时配置解析出当前激活的 LLM / Image Provider。
 * 未配置或配置无效时回退到 Mock。
 */

export interface ProviderConfig {
  llm?:
    | { kind: "mock" }
    | ({ kind: "openai-compatible" } & OpenAICompatibleConfig)
    | { kind: "anthropic"; baseURL?: string; apiKey: string; model: string }
    | { kind: "gemini"; baseURL?: string; apiKey: string; model: string }
    | { kind: "deepseek"; apiKey: string; model: string };
  image?:
    | { kind: "mock" }
    | ({ kind: "openai-compatible" } & OpenAIImageConfig)
    | {
        kind: "siliconflow";
        apiKey: string;
        model: string;
        baseURL?: string;
        defaultSize?: string;
      }
    | {
        kind: "gemini-image";
        apiKey: string;
        model: string;
        baseURL?: string;
        aspectRatio?: string;
      };
  /**
   * 是否启用 Vision Critic：把每页 rasterize 成 PNG 喂给视觉模型。
   * 默认关闭。要求 LLM provider 支持 vision（GPT-4o, Claude, Qwen-VL, Gemini）。
   */
  visionCritic?: boolean;
  /** 当前激活的 SKILL.md id；缺省走 registry 第一个。 */
  skillId?: string;
  /** 当前激活的 DESIGN.md id；缺省走 skill.recommendedDesignSystem 或 registry 第一个。 */
  designSystemId?: string;
  /**
   * 开发模式：允许 Mock LLM/Image（默认 false）。
   * 也可通过环境变量 VAD_ALLOW_MOCK_DEV=true 开启。
   */
  allowMockDev?: boolean;
  /** 高级控制滑块 */
  sliders?: {
    pageCount?: number;
    uiDensity?: number;
    styleIntensity?: number;
    repairThreshold?: number;
    /** Content Agent 文案语调 */
    contentTone?: "professional" | "friendly" | "playful" | "luxury" | "technical";
    /** Content Agent 输出语言 */
    contentLocale?: "zh-CN" | "en-US" | "bilingual";
  };
}

export interface ResolvedProviders {
  llm: LlmProvider;
  image: ImageProvider;
  visionCritic: boolean;
}

export function resolveProviders(cfg?: ProviderConfig): ResolvedProviders {
  return {
    llm: resolveLlm(cfg?.llm),
    image: resolveImage(cfg?.image),
    // 仅在 LLM 是真实 provider 时才允许 vision；mock LLM 即使开了也无意义
    visionCritic:
      cfg?.visionCritic === true && cfg?.llm?.kind !== "mock" && cfg?.llm?.kind !== undefined,
  };
}

function resolveLlm(cfg?: ProviderConfig["llm"]): LlmProvider {
  if (!cfg || cfg.kind === "mock") return MockLlmProvider;
  if (cfg.kind === "openai-compatible") {
    if (!cfg.apiKey || !cfg.baseURL || !cfg.model) return MockLlmProvider;
    return createOpenAICompatibleProvider({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseURL,
      model: cfg.model,
    });
  }
  if (cfg.kind === "anthropic") {
    if (!cfg.apiKey || !cfg.model) return MockLlmProvider;
    return createAnthropicProvider({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseURL,
      model: cfg.model,
    });
  }
  if (cfg.kind === "gemini") {
    if (!cfg.apiKey || !cfg.model) return MockLlmProvider;
    return createGeminiProvider({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseURL,
      model: cfg.model,
    });
  }
  if (cfg.kind === "deepseek") {
    if (!cfg.apiKey || !cfg.model) return MockLlmProvider;
    return createOpenAICompatibleProvider({
      apiKey: cfg.apiKey,
      baseURL: "https://api.deepseek.com/v1",
      model: cfg.model,
    });
  }
  return MockLlmProvider;
}

function resolveImage(cfg?: ProviderConfig["image"]): ImageProvider {
  if (!cfg || cfg.kind === "mock") return MockImageProvider;
  if (cfg.kind === "openai-compatible") {
    if (!cfg.apiKey || !cfg.baseURL || !cfg.model) return MockImageProvider;
    return createOpenAICompatibleImageProvider({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseURL,
      model: cfg.model,
      defaultSize: cfg.defaultSize,
    });
  }
  if (cfg.kind === "siliconflow") {
    if (!cfg.apiKey || !cfg.model) return MockImageProvider;
    return createOpenAICompatibleImageProvider({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseURL ?? "https://api.siliconflow.cn/v1",
      model: cfg.model,
      defaultSize: cfg.defaultSize,
    });
  }
  if (cfg.kind === "gemini-image") {
    if (!cfg.apiKey || !cfg.model) return MockImageProvider;
    return createGeminiImageProvider({
      apiKey: cfg.apiKey,
      model: cfg.model,
      baseURL: cfg.baseURL,
      aspectRatio: cfg.aspectRatio as GeminiAspectRatio | undefined,
    });
  }
  return MockImageProvider;
}
