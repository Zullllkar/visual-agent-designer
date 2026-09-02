/**
 * 桌面端首次启动：欢迎 → 工作方式 → 连接模型。
 */

import type { ImagePresetId } from "@/lib/providers/image/catalog";
import type { ProviderConfig } from "@/lib/providers/registry";

export const FIRST_RUN_SKIP_KEY = "vad.studio.firstRunSkipped";
export const FIRST_RUN_DONE_KEY = "vad.studio.onboardingDone";
export const FIRST_RUN_OPEN_EVENT = "vad-open-first-run";

export const FIRST_RUN_STEPS = ["welcome", "workflow", "models"] as const;
export type FirstRunStep = (typeof FIRST_RUN_STEPS)[number];

export type FirstRunOpenDetail = { step: FirstRunStep };

export function shouldShowFirstRunSetup(input: {
  isDesktop: boolean;
  hydrated: boolean;
  llmMock: boolean;
  imageMock: boolean;
  skippedThisSession: boolean;
  forced: boolean;
}): boolean {
  if (!input.isDesktop || !input.hydrated) return false;
  if (input.forced) return true;
  if (input.skippedThisSession) return false;
  return input.llmMock || input.imageMock;
}

export function parseFirstRunStep(value: unknown): FirstRunStep {
  if (value === "welcome" || value === "workflow" || value === "models") {
    return value;
  }
  return "welcome";
}

export function firstRunOpenPayload(step?: FirstRunStep): FirstRunOpenDetail {
  return { step: step ?? "models" };
}

export function nextFirstRunStep(step: FirstRunStep): FirstRunStep | null {
  if (step === "welcome") return "workflow";
  if (step === "workflow") return "models";
  return null;
}

export function prevFirstRunStep(step: FirstRunStep): FirstRunStep | null {
  if (step === "models") return "workflow";
  if (step === "workflow") return "welcome";
  return null;
}

export function resolveFirstRunStep(input: {
  forced: boolean;
  onboardingDone: boolean;
  requestedStep?: unknown;
}): FirstRunStep {
  if (input.forced) return parseFirstRunStep(input.requestedStep ?? "models");
  if (input.onboardingDone) return "models";
  return "welcome";
}

export function readFirstRunSkipped(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(FIRST_RUN_SKIP_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeFirstRunSkipped(skipped: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (skipped) window.sessionStorage.setItem(FIRST_RUN_SKIP_KEY, "1");
    else window.sessionStorage.removeItem(FIRST_RUN_SKIP_KEY);
  } catch {
    /* ignore */
  }
}

export function readOnboardingDone(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(FIRST_RUN_DONE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeOnboardingDone(done: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (done) window.localStorage.setItem(FIRST_RUN_DONE_KEY, "1");
    else window.localStorage.removeItem(FIRST_RUN_DONE_KEY);
  } catch {
    /* ignore */
  }
}

export function openFirstRunSetup(step: FirstRunStep = "models") {
  if (typeof window === "undefined") return;
  writeFirstRunSkipped(false);
  window.dispatchEvent(
    new CustomEvent<FirstRunOpenDetail>(FIRST_RUN_OPEN_EVENT, {
      detail: firstRunOpenPayload(step),
    }),
  );
}

const LLM_KIND: Record<string, "openai-compatible" | "anthropic" | "gemini" | "deepseek"> = {
  openai: "openai-compatible",
  anthropic: "anthropic",
  gemini: "gemini",
  deepseek: "deepseek",
  qwen: "openai-compatible",
  openrouter: "openai-compatible",
  ollama: "openai-compatible",
};

export function buildOnboardingLlm(input: {
  presetId: string;
  apiKey: string;
  model: string;
  baseURL: string;
}): NonNullable<ProviderConfig["llm"]> {
  const apiKey = input.apiKey.trim();
  const model = input.model.trim();
  if (!apiKey || !model) return { kind: "mock" };
  const kind = LLM_KIND[input.presetId] ?? "openai-compatible";
  if (kind === "deepseek") return { kind, apiKey, model };
  return { kind, apiKey, model, baseURL: input.baseURL };
}

export function buildOnboardingImage(input: {
  presetId: string;
  apiKey: string;
  model: string;
  baseURL: string;
}): NonNullable<ProviderConfig["image"]> {
  const apiKey = input.apiKey.trim();
  const model = input.model.trim();
  if (!apiKey || !model) return { kind: "mock" };
  const presetId = input.presetId as ImagePresetId;
  if (presetId === "gemini-image") {
    return { kind: "gemini-image", apiKey, model, baseURL: input.baseURL };
  }
  if (presetId === "siliconflow") {
    return { kind: "siliconflow", apiKey, model, baseURL: input.baseURL };
  }
  if (presetId === "replicate") {
    return { kind: "replicate", apiKey, model, baseURL: input.baseURL };
  }
  return {
    kind: "openai-compatible",
    apiKey,
    model,
    baseURL: input.baseURL,
  };
}

export function withModelChoices<T extends { id: string }>(
  catalog: readonly T[],
  current: string,
): Array<T | { id: string }> {
  const value = current.trim();
  if (!value || catalog.some((item) => item.id === value)) {
    return [...catalog];
  }
  return [...catalog, { id: value }];
}
