/**
 * Content Agent 文案偏好
 * --------------------------------------------------------------
 * 由 Provider 设置注入 ctx.scratch，控制润色语调与语言。
 *
 * @author：wangjunhua
 */

export type ContentTone =
  | "professional"
  | "friendly"
  | "playful"
  | "luxury"
  | "technical";

export type ContentLocale = "zh-CN" | "en-US" | "bilingual";

export const CONTENT_TONE_OPTIONS: Array<{ id: ContentTone; label: string }> = [
  { id: "professional", label: "专业克制" },
  { id: "friendly", label: "亲切易懂" },
  { id: "playful", label: "活泼年轻" },
  { id: "luxury", label: "高端精致" },
  { id: "technical", label: "技术/Developer" },
];

export const CONTENT_LOCALE_OPTIONS: Array<{ id: ContentLocale; label: string }> = [
  { id: "zh-CN", label: "简体中文" },
  { id: "en-US", label: "English" },
  { id: "bilingual", label: "中英双语（标题英/正文中）" },
];

const TONE_DIRECTIVES: Record<ContentTone, string> = {
  professional: "语调专业、克制、可信，适合 B2B SaaS。",
  friendly: "语调亲切、口语化但不幼稚，强调用户收益。",
  playful: "语调活泼、有节奏感，可用适度网络感，避免低俗梗。",
  luxury: "语调高端、精炼、留白感强，避免促销腔。",
  technical: "语调面向开发者/技术用户，术语准确，少营销空话。",
};

const LOCALE_DIRECTIVES: Record<ContentLocale, string> = {
  "zh-CN": "所有可见文案使用简体中文。",
  "en-US": "All visible copy must be in English.",
  bilingual:
    "主标题可用简短英文，正文与按钮以中文为主，关键术语保留英文。",
};

export function resolveContentTone(raw?: unknown): ContentTone {
  if (
    raw === "friendly" ||
    raw === "playful" ||
    raw === "luxury" ||
    raw === "technical"
  ) {
    return raw;
  }
  return "professional";
}

export function resolveContentLocale(raw?: unknown): ContentLocale {
  if (raw === "en-US" || raw === "bilingual") return raw;
  return "zh-CN";
}

export function buildContentDirectives(
  tone: ContentTone,
  locale: ContentLocale
): string {
  return [TONE_DIRECTIVES[tone], LOCALE_DIRECTIVES[locale]].join("\n");
}

/** 从 AgentContext.scratch 读取偏好 */
import type { ProviderConfig } from "@/lib/providers/registry";

/** 把 Provider 滑块写入 scratch，供各 Agent 读取 */
export function injectProviderScratch(
  scratch: Record<string, unknown>,
  providerConfig?: ProviderConfig
): void {
  const s = providerConfig?.sliders;
  if (s?.contentTone) scratch.contentTone = s.contentTone;
  if (s?.contentLocale) scratch.contentLocale = s.contentLocale;
  if (s?.pageCount) scratch.pageCount = s.pageCount;
  if (s?.styleIntensity) scratch.styleIntensity = s.styleIntensity;

  const prefs = providerConfig?.generationPrefs;
  if (prefs) {
    scratch.generationPrefs = prefs;
    if (prefs.mode) scratch.generationMode = prefs.mode;
    if (prefs.defaultImageSize) scratch.defaultImageSize = prefs.defaultImageSize;
    if (prefs.defaultVideoParams) scratch.defaultVideoParams = prefs.defaultVideoParams;
  }
}

export function readContentPrefs(scratch: Record<string, unknown>): {
  tone: ContentTone;
  locale: ContentLocale;
  directives: string;
} {
  const tone = resolveContentTone(scratch.contentTone);
  const locale = resolveContentLocale(scratch.contentLocale);
  return {
    tone,
    locale,
    directives: buildContentDirectives(tone, locale),
  };
}
