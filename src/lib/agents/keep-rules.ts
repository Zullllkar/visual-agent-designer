/**
 * 用户纠正 → 可验证 Keep 规则。生图前检查，而不是只写进散文。
 * @author：wangjunhua
 */

export interface KeepRule {
  id: string;
  text: string;
  kind: "avoid" | "must";
  verified: true;
  bad: string;
  guard: string;
}

const CATALOG: Array<{
  id: string;
  kind: "avoid" | "must";
  trigger: RegExp;
  text: string;
  bad: RegExp;
  guard: RegExp;
  guardText: string;
}> = [
  {
    id: "avoid-poster",
    kind: "avoid",
    trigger: /不要海报|别(?:再)?(?:做成)?海报|禁止海报|不要促销/,
    text: "不要海报风",
    bad: /poster|banner|promo(?:tional)?|sale graphic|营销拼贴|促销海报/i,
    guard: /Avoid promotional poster/i,
    guardText: "Avoid promotional poster, sale banner, and campaign collage.",
  },
  {
    id: "avoid-crop",
    kind: "avoid",
    trigger: /别被截断|不要截断|禁止截断|不要裁切/,
    text: "标题与主体不要被截断",
    bad: /cropped off|cut off at (?:the )?edge|truncated subject/i,
    guard: /Do not crop/i,
    guardText: "Do not crop the subject or title at the canvas edge.",
  },
  {
    id: "avoid-purple",
    kind: "avoid",
    trigger: /不要紫|别用紫|禁止紫|不要渐变紫/,
    text: "不要紫色渐变",
    bad: /violet gradient|purple haze|#7[cC]3[aA][eE][dD]|startup purple/i,
    guard: /Avoid violet gradient/i,
    guardText: "Avoid violet gradient soup and startup purple.",
  },
];

export function extractKeepRulesFromCorrection(message: string): KeepRule[] {
  const text = message ?? "";
  const rules: KeepRule[] = [];
  for (const item of CATALOG) {
    if (!item.trigger.test(text)) continue;
    rules.push({
      id: item.id,
      text: item.text,
      kind: item.kind,
      verified: true,
      bad: item.bad.source,
      guard: item.guard.source,
    });
  }
  return rules;
}

export function mergeKeepRules(
  existing: KeepRule[] | undefined,
  incoming: KeepRule[]
): KeepRule[] {
  const byId = new Map((existing ?? []).map((rule) => [rule.id, rule]));
  for (const rule of incoming) byId.set(rule.id, rule);
  return [...byId.values()];
}

export function evaluateKeepRules(
  prompt: string,
  rules: KeepRule[]
): { ok: boolean; violations: KeepRule[] } {
  const violations = rules.filter((rule) => {
    const bad = new RegExp(rule.bad, "i");
    const guard = new RegExp(rule.guard, "i");
    return bad.test(prompt) && !guard.test(prompt);
  });
  return { ok: violations.length === 0, violations };
}

export function enforceKeepRules(prompt: string, rules: KeepRule[]): string {
  let next = prompt;
  const { violations } = evaluateKeepRules(next, rules);
  for (const rule of violations) {
    const item = CATALOG.find((entry) => entry.id === rule.id);
    if (!item) continue;
    next = `${next.replace(/\s+$/, "")} ${item.guardText}`;
  }
  return next;
}

export function formatKeepRulesForPrompt(rules: KeepRule[]): string {
  if (!rules.length) return "";
  return [
    "## Verified Keep rules",
    "These are checkable constraints from user corrections. Bind them into image prompts; do not treat them as optional flavor text.",
    ...rules.map((rule) => `- ${rule.id}: ${rule.text}`),
  ].join("\n");
}
