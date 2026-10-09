/**
 * 文案校正（纯函数）
 * --------------------------------------------------------------
 * Vision 从生成图上读回来的 copy 经常有错别字 / 缺字（图模型本来就画不准字）。
 * 这里把每个 region 的 copy 与「生图前定好的 copyPlan」以及 imagePrompt 里
 * 引号包住的文本做模糊匹配：对上了就用权威文本替换，并标注 copySource；
 * 没对上的计划文案列进 unplacedCopy —— 图上没画出来，但实现时仍必须有。
 */

import type { AssetDesignSpec, CopyPlanItem } from "@/lib/project/design-spec-schema";

/** 归一化后相似度 ≥ 此值视为同一段文案 */
export const COPY_MATCH_THRESHOLD = 0.55;

const QUOTE_RE = /["“”「」『』]([^"“”「」『』]{2,80})["“”「」『』]/g;

/** 从 imagePrompt 里捞出引号包住的短文本（去重，保序） */
export function extractQuotedCopy(prompt: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of prompt.matchAll(QUOTE_RE)) {
    const text = m[1].trim();
    if (!text) continue;
    // 纯符号 / 纯数字 / 明显是颜色值的不算文案
    if (/^#?[0-9a-f]{3,8}$/i.test(text) || !/[\p{L}\p{N}]/u.test(text)) continue;
    const key = normalize(text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\u3000]+/g, " ")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .trim();
}

/** 0–1；混合字符级编辑距离与词级 Jaccard，取较大者 */
export function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const lev = 1 - levenshtein(na, nb) / Math.max(na.length, nb.length);
  const ta = new Set(na.split(" ").filter(Boolean));
  const tb = new Set(nb.split(" ").filter(Boolean));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const jaccard = inter / Math.max(1, ta.size + tb.size - inter);
  // 一方是另一方的子串（Vision 常只读到半句）：短的那段够长时视为强信号
  const shorter = Math.min(na.length, nb.length);
  const ratio = shorter / Math.max(na.length, nb.length);
  const contained = na.includes(nb) || nb.includes(na);
  const containment = contained ? (shorter >= 8 ? 0.5 + 0.5 * ratio : ratio) : 0;
  return Math.max(lev, jaccard, containment);
}

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

export interface ReconcileInput {
  copyPlan?: CopyPlanItem[];
  /** asset.prompt；用于兜底抽引号文本 */
  prompt?: string;
}

export interface ReconcileResult {
  spec: AssetDesignSpec;
  /** 被权威文本替换的 region 数 */
  corrected: number;
  /** 只有 vision 来源、无法校正的 region 数 */
  visionOnly: number;
  unplaced: CopyPlanItem[];
}

export function reconcileSpecCopy(spec: AssetDesignSpec, input: ReconcileInput): ReconcileResult {
  const plan = (input.copyPlan ?? []).filter((c) => c.text.trim());
  const quoted = extractQuotedCopy(input.prompt ?? "");
  const candidates: Array<{ text: string; source: "plan" | "prompt"; planId?: string }> = [
    ...plan.map((c) => ({ text: c.text.trim(), source: "plan" as const, planId: c.id })),
    ...quoted
      .filter((q) => !plan.some((c) => similarity(c.text, q) >= 0.9))
      .map((q) => ({ text: q, source: "prompt" as const })),
  ];

  const matchedPlanIds = new Set<string>();
  let corrected = 0;
  let visionOnly = 0;

  const regions = spec.regions.map((region) => {
    const observed = region.copy?.trim();
    if (!observed) return region;
    // 已经标过来源的（用户手改 / 二次拆解）不再动
    if (region.copySource && region.copySource !== "vision") return region;

    let best: (typeof candidates)[number] | undefined;
    let bestScore = 0;
    for (const cand of candidates) {
      const score = similarity(observed, cand.text);
      if (score > bestScore) {
        bestScore = score;
        best = cand;
      }
    }
    if (best && bestScore >= COPY_MATCH_THRESHOLD) {
      if (best.planId) matchedPlanIds.add(best.planId);
      const changed = normalize(best.text) !== normalize(observed);
      if (changed) corrected += 1;
      return {
        ...region,
        copy: best.text,
        copySource: best.source,
        copyObserved: changed ? observed : undefined,
      };
    }
    visionOnly += 1;
    return { ...region, copySource: "vision" as const };
  });

  const unplaced = plan.filter((c) => !matchedPlanIds.has(c.id));
  const notes = [...spec.implementationNotes];
  if (unplaced.length) {
    notes.push(
      `Planned copy not visible in the mockup (still required in the implementation): ${unplaced
        .map((c) => `${c.role} "${c.text}"`)
        .join("; ")}`,
    );
  }
  if (visionOnly > 0) {
    notes.push(
      `${visionOnly} region(s) carry copySource="vision": text was read off a generated image and may contain typos — prefer the brief / copyPlan wording when in doubt.`,
    );
  }

  return {
    spec: {
      ...spec,
      regions,
      copyPlan: plan.length ? plan : spec.copyPlan,
      unplacedCopy: unplaced.length ? unplaced : undefined,
      implementationNotes: notes,
    },
    corrected,
    visionOnly,
    unplaced,
  };
}
