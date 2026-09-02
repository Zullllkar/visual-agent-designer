/**
 * 把选中素材锁定为项目视觉方向，并挑出需要按它换风格的其它图。
 */

import type { DesignDirection } from "@/lib/project/schema";
import { isUsableReferenceImage } from "@/lib/agents/tools/utils";

export const ADOPT_ASSET_STYLE_TAG = "[采用素材风格]";

export const ADOPT_RESTYLE_INSTRUCTION =
  "按参考图统一视觉风格：保持每张图自己的主体与构图，对齐参考图的渲染、配色、光影与材质。";

export function isAdoptAssetStyleMessage(text: string): boolean {
  return /\[采用素材风格\]/.test(text);
}

export function parseAdoptAssetId(
  text: string,
  explicit?: string
): string | undefined {
  if (explicit?.trim()) return explicit.trim();
  const asset = text.match(/【引用素材\s*[:：]?\s*[^#】]+#([\w-]+)】/);
  return asset?.[1];
}

export function buildAdoptAssetStyleMessage(asset: {
  id: string;
  prompt?: string;
}): string {
  const label = (asset.prompt || "这张图").trim().slice(0, 40) || "这张图";
  return (
    `【引用素材: ${label}#${asset.id}】 ${ADOPT_ASSET_STYLE_TAG} ` +
    "这张图非常符合要求，请按它的视觉风格更新项目整体方向，并统一其余素材。"
  );
}

export function buildAdoptedDesignDirection(input: {
  existing?: Pick<
    DesignDirection,
    "summary" | "moodKeywords" | "typographyNotes" | "layoutNotes" | "recommendedDesignSystemId"
  > | null;
  assetPrompt?: string;
  visualStyle?: string;
  assetId: string;
}): DesignDirection {
  const prompt = input.assetPrompt?.trim() || "当前选中画面";
  const clipped = prompt.length > 80 ? `${prompt.slice(0, 80)}…` : prompt;
  const style = input.visualStyle?.trim();
  const summary = style
    ? `以选中画面为视觉基准（${style}），延续「${clipped}」的渲染、配色与光影；项目其余素材对齐同一风格。`
    : `以选中画面为视觉基准，延续「${clipped}」的渲染、配色与光影；项目其余素材对齐同一风格。`;
  const moodKeywords = uniqueCompact([
    ...(input.existing?.moodKeywords ?? []),
    ...splitStyleKeywords(style || ""),
    ...splitStyleKeywords(prompt),
  ]).slice(0, 8);

  return {
    summary,
    moodKeywords: moodKeywords.length > 0 ? moodKeywords : ["reference-locked"],
    typographyNotes: input.existing?.typographyNotes,
    layoutNotes: input.existing?.layoutNotes,
    recommendedDesignSystemId: input.existing?.recommendedDesignSystemId,
    styleSourceAssetId: input.assetId,
  };
}

export function pickStyleRestyleTargets<
  T extends { id: string; status?: string; src?: string },
>(assets: T[], sourceAssetId: string, limit = 4): T[] {
  return assets
    .filter(
      (asset) =>
        asset.id !== sourceAssetId &&
        asset.status !== "discarded" &&
        asset.status !== "generating" &&
        isUsableReferenceImage(asset.src)
    )
    .slice(0, limit);
}

function splitStyleKeywords(style: string): string[] {
  return style
    .split(/[,，、/|]+|\s{2,}/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 12);
}

function uniqueCompact(items: Array<string | undefined | null>): string[] {
  return Array.from(
    new Set(items.filter((item): item is string => Boolean(item)))
  );
}
