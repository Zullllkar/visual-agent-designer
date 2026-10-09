import type { ProviderLogoId } from "@/components/brand/provider-logo";
import type { ProviderConfig } from "./registry";

export type ComposerModelMark =
  | { kind: "logo"; id: ProviderLogoId; label: string }
  | { kind: "letter"; letter: string; label: string };

function modelOf(value: { model?: string } | undefined): string {
  return value?.model?.trim() ?? "";
}

function baseOf(value: { baseURL?: string } | undefined): string {
  return typeof value?.baseURL === "string" ? value.baseURL.trim() : "";
}

function letterOf(label: string): string {
  const token = label.replace(/^[^a-z0-9]+/i, "");
  return (token[0] ?? "M").toUpperCase();
}

function llmLogoId(kind: string, model: string, baseURL: string): ProviderLogoId | null {
  if (kind === "anthropic") return "anthropic";
  if (kind === "gemini") return "gemini";
  if (kind === "deepseek") return "deepseek";
  const hay = `${model} ${baseURL}`.toLowerCase();
  if (hay.includes("qwen") || hay.includes("dashscope")) return "qwen";
  if (hay.includes("openrouter")) return "openrouter";
  if (hay.includes("ollama") || hay.includes(":11434")) return "ollama";
  if (hay.includes("deepseek")) return "deepseek";
  if (hay.includes("claude")) return "anthropic";
  if (hay.includes("gemini")) return "gemini";
  if (hay.includes("gpt") || hay.includes("openai.com")) return "openai";
  return null;
}

function imageLogoId(kind: string, model: string): ProviderLogoId | null {
  if (kind === "gemini-image" || /gemini/i.test(model)) return "gemini-image";
  if (kind === "replicate") return "replicate";
  if (kind === "siliconflow" || /flux/i.test(model)) return "siliconflow";
  if (/^gpt-image/i.test(model)) return "openai-gpt-image";
  if (/dall-?e/i.test(model)) return "openai-dalle";
  return null;
}

export function composerModelMarks(config: ProviderConfig | undefined): ComposerModelMark[] {
  const llm = config?.llm;
  const image = config?.image;
  const marks: ComposerModelMark[] = [];

  if (!llm || llm.kind === "mock") {
    marks.push({ kind: "letter", letter: "M", label: "模拟模型" });
  } else {
    const label = modelOf(llm) || llm.kind;
    const id = llmLogoId(llm.kind, modelOf(llm), baseOf(llm as { baseURL?: string }));
    marks.push(id ? { kind: "logo", id, label } : { kind: "letter", letter: letterOf(label), label });
  }

  if (image && image.kind !== "mock") {
    const label = modelOf(image) || image.kind;
    const id = imageLogoId(image.kind, modelOf(image));
    marks.push(id ? { kind: "logo", id, label } : { kind: "letter", letter: letterOf(label), label });
  }

  return marks;
}

export function composerLlmSummary(config: ProviderConfig | undefined): {
  name: string;
  mark: ComposerModelMark | null;
} {
  const llm = config?.llm;
  if (!llm || llm.kind === "mock") return { name: "配置模型", mark: null };
  const name = modelOf(llm) || llm.kind;
  const id = llmLogoId(llm.kind, modelOf(llm), baseOf(llm as { baseURL?: string }));
  return {
    name,
    mark: id ? { kind: "logo", id, label: name } : null,
  };
}

export function composerImageSummary(config: ProviderConfig | undefined): {
  name: string;
  mark: ComposerModelMark | null;
} | null {
  const image = config?.image;
  if (!image || image.kind === "mock") return null;
  const name = modelOf(image) || image.kind;
  const id = imageLogoId(image.kind, modelOf(image));
  return {
    name,
    mark: id
      ? { kind: "logo", id, label: name }
      : { kind: "letter", letter: letterOf(name), label: name },
  };
}
