/**
 * 解析项目目标、推断冲突、拼 Goal 段。
 */

import {
  getTargetRecipe,
  HOME_TARGET_IDS,
  isTargetId,
  type TargetId,
} from "./catalog";

export { HOME_TARGET_IDS, getTargetRecipe, isTargetId };
export type { TargetId } from "./catalog";

const INFER_SIGNALS: Array<{ id: TargetId; re: RegExp }> = [
  {
    id: "game-art",
    re: /立绘|原画|门派|角色概念|场景概念|道具概念|像素仙侠|仙侠.*像素|concept art/i,
  },
  {
    id: "promo-kv",
    re: /\bkv\b|主视觉|宣传海报|新品发布|key visual/i,
  },
  {
    id: "social-cover",
    re: /小红书封面|社媒封面|封面图|小红书/i,
  },
  {
    id: "product-shot",
    re: /产品图|白底主图|电商主图|三视图|产品实拍/i,
  },
  {
    id: "style-board",
    re: /风格探索|mood\s*board|方向板|风格板/i,
  },
  {
    id: "ui-visual",
    re: /界面|落地页|dashboard|app\s*ui|屏幕 ui|首页 ui/i,
  },
];

export function parseTargetId(value: unknown): TargetId {
  return isTargetId(value) ? value : "ui-visual";
}

export function resolveTargetId(
  project: { targetId?: unknown } | null | undefined
): TargetId {
  return parseTargetId(project?.targetId);
}

export function inferTargetFromText(text: string): TargetId | null {
  const raw = text.trim();
  if (!raw) return null;
  for (const signal of INFER_SIGNALS) {
    if (signal.re.test(raw)) return signal.id;
  }
  return null;
}

export function targetConflict(
  current: TargetId,
  text: string
): TargetId | null {
  const inferred = inferTargetFromText(text);
  if (!inferred || inferred === current) return null;
  return inferred;
}

export function keepRulesForTarget(id: TargetId): string[] {
  return [...getTargetRecipe(id).keepRuleScope];
}

export function buildGoalPromptSection(
  id: TargetId,
  directionCardId?: string
): string {
  const recipe = getTargetRecipe(id);
  const deny =
    recipe.toolsDeny.length > 0
      ? `Denied tools: ${recipe.toolsDeny.join(", ")}`
      : "Denied tools: none extra";
  const keep =
    recipe.keepRuleScope.length > 0
      ? `Keep in scope: ${recipe.keepRuleScope.join(", ")}`
      : "Keep in scope: none";
  const card = directionCardId
    ? `directionCardId: ${directionCardId}`
    : "directionCardId: none";

  return [
    "## Goal",
    `目标：${recipe.label}`,
    recipe.goalSentence,
    `targetId: ${recipe.id}`,
    card,
    deny,
    keep,
    "Prompt contract:",
    recipe.promptContract,
  ].join("\n");
}

export function extractTargetIdFromDiscoveryAnswer(
  text: string
): TargetId | null {
  const match = text.match(
    /\[value:\s*(ui-visual|game-art|promo-kv|social-cover|product-shot|style-board)\]/i
  );
  return match ? parseTargetId(match[1]) : null;
}

export function productShotNeedsReference(project: {
  targetId?: unknown;
  references?: unknown[] | undefined;
} | null): boolean {
  if (!project) return false;
  if (resolveTargetId(project) !== "product-shot") return false;
  return (project.references?.length ?? 0) === 0;
}
