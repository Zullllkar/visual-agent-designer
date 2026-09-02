import type { TargetId } from "@/lib/targets/catalog";
import type { SkillKind } from "./schema";

type SkillIdentity = {
  name: string;
  kind: SkillKind;
};

const TARGET_KINDS: Record<TargetId, readonly SkillKind[]> = {
  "ui-visual": ["prototype", "landing", "mobile", "dashboard", "template"],
  "game-art": ["game-art", "template"],
  "promo-kv": ["promo-kv", "template"],
  "social-cover": ["xhs", "template"],
  "product-shot": ["product-shot", "template"],
  "style-board": ["style-board", "template"],
};

export function findSkillById<T extends { manifest: { name: string } }>(
  skills: readonly T[],
  id: string | undefined,
): T | null {
  if (!id) return null;
  return skills.find((skill) => skill.manifest.name === id) ?? null;
}

export function isSkillCompatibleWithTarget(kind: SkillKind, targetId: TargetId): boolean {
  return TARGET_KINDS[targetId]?.includes(kind) ?? false;
}

export function recommendSkillId(
  skills: readonly SkillIdentity[],
  targetId: TargetId,
): string | undefined {
  const named = skills.find(
    (skill) => skill.name === targetId && isSkillCompatibleWithTarget(skill.kind, targetId),
  );
  if (named) return named.name;

  const priorities = TARGET_KINDS[targetId];
  if (!priorities) return undefined;

  for (const kind of priorities) {
    const match = skills.find((skill) => skill.kind === kind);
    if (match) return match.name;
  }
  return undefined;
}

/** `null` / `undefined` = 不绑 Skill。只有用户显式选了兼容 Skill 才会保留。 */
export type HomeSkillChoice = string | null | undefined;

export function resolveHomeSkillChoice(input: {
  current: HomeSkillChoice;
  skills: readonly SkillIdentity[];
  targetId: TargetId;
}): HomeSkillChoice {
  if (input.current == null) return null;

  const selected = input.skills.find((skill) => skill.name === input.current);
  if (selected && isSkillCompatibleWithTarget(selected.kind, input.targetId)) {
    return input.current;
  }

  return null;
}
