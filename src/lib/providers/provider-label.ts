/**
 * Provider 展示文案（客户端安全）
 * --------------------------------------------------------------
 * 首页 / 设置芯片上显示当前 LLM、生图配置摘要。
 *
 * @author：wangjunhua
 */

import type { ProviderConfig } from "./registry";
import { isMockImageConfig, isMockLlmConfig } from "./validate";

const LLM_KIND_LABEL: Record<string, string> = {
  "openai-compatible": "OpenAI 兼容",
  anthropic: "Anthropic",
  gemini: "Gemini",
  deepseek: "DeepSeek",
};

const IMAGE_KIND_LABEL: Record<string, string> = {
  "openai-compatible": "OpenAI 生图",
  siliconflow: "SiliconFlow",
  "gemini-image": "Gemini 生图",
};

export function getLlmChipLabel(
  cfg: ProviderConfig | undefined,
  mockLabel: string,
  realPrefix: string
): string {
  if (isMockLlmConfig(cfg)) return mockLabel;
  const llm = cfg!.llm!;
  const kindLabel = LLM_KIND_LABEL[llm.kind] ?? llm.kind;
  const model =
    "model" in llm && typeof llm.model === "string" && llm.model.trim()
      ? llm.model.trim()
      : "";
  if (model) return `${realPrefix} · ${model}`;
  return `${realPrefix} · ${kindLabel}`;
}

export function getImageChipLabel(
  cfg: ProviderConfig | undefined,
  mockLabel: string
): string {
  if (isMockImageConfig(cfg)) return mockLabel;
  const img = cfg!.image!;
  const kindLabel = IMAGE_KIND_LABEL[img.kind] ?? img.kind;
  const model =
    "model" in img && typeof img.model === "string" && img.model.trim()
      ? img.model.trim()
      : "";
  return model ? `生图 · ${model}` : `生图 · ${kindLabel}`;
}
