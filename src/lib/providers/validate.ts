/**
 * Provider 运行时校验
 * --------------------------------------------------------------
 * Agent 工作流要求真实 LLM；Mock 仅允许在显式开发模式开启。
 * 生图步骤要求真实 Image Provider（结构层 Layout 仍可在 dev mock 下跑）。
 *
 * @author：wangjunhua
 */

import type { ProviderConfig } from "./registry";

export class ProviderRequiredError extends Error {
  readonly code = "provider_required" as const;
  constructor(message: string) {
    super(message);
    this.name = "ProviderRequiredError";
  }
}

/** 是否配置为 Mock LLM（含未配置）。 */
export function isMockLlmConfig(cfg?: ProviderConfig): boolean {
  return !cfg?.llm || cfg.llm.kind === "mock";
}

/** 是否配置为 Mock 生图。 */
export function isMockImageConfig(cfg?: ProviderConfig): boolean {
  return !cfg?.image || cfg.image.kind === "mock";
}

/** 是否允许 Mock 开发模式（请求体或环境变量）。 */
export function isAllowMockDev(cfg?: ProviderConfig): boolean {
  if (cfg?.allowMockDev === true) return true;
  return process.env.VAD_ALLOW_MOCK_DEV === "true";
}

/**
 * Agent 编排前校验：默认必须配置真实 LLM。
 * 未配置时抛出 ProviderRequiredError，由 API 返回 400。
 */
export function assertRealLlmForAgents(cfg?: ProviderConfig): void {
  if (!isMockLlmConfig(cfg)) return;
  if (isAllowMockDev(cfg)) return;
  throw new ProviderRequiredError(
    "请先在设置中配置真实 LLM（OpenAI 兼容 / Anthropic / Gemini / DeepSeek 等）。当前为 Mock 模式，无法运行 Agent 编排。开发调试可设置环境变量 VAD_ALLOW_MOCK_DEV=true。"
  );
}

/** 生图工具执行前校验。 */
export function assertRealImageForGeneration(cfg?: ProviderConfig): void {
  if (!isMockImageConfig(cfg)) return;
  if (isAllowMockDev(cfg)) return;
  throw new ProviderRequiredError(
    "请先在设置中配置真实生图模型（OpenAI 兼容 / Gemini Image / SiliconFlow 等）。UI 位图资产必须由生图模型生成。"
  );
}
