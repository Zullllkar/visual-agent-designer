/**
 * 一张图一条提示词：禁止同一句采样 N 次。
 */

const GENERATE_DELTAS = [
  "cooler color grade, moonlight, heavier atmosphere",
  "warmer dawn light, gold haze",
  "softer overcast, lower contrast",
  "harder rim light, clearer silhouette",
  "deeper shadows, tighter crop on the hero",
  "wider establishing frame, more environment",
  "muted palette, quieter mood",
  "higher saturation, clearer focal color",
];

const VARIANT_DELTAS = [
  "cooler light and heavier mist; keep every subject and word in place",
  "warmer dawn light and gold fog; keep every subject and word in place",
  "softer overcast and quieter contrast; keep every subject and word in place",
  "harder rim light and a clearer silhouette; keep every subject and word in place",
];

export function uniquePrompts(prompts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of prompts) {
    const text = raw.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out.slice(0, 8);
}

export function expandDistinctPrompts(input: {
  basePrompt: string;
  requestedCount: number;
  existing?: string[];
  kind?: "generate" | "variant";
}): string[] {
  const existing = uniquePrompts(input.existing ?? []);
  const n = Math.min(8, Math.max(1, Math.round(input.requestedCount) || 1));
  if (existing.length >= 2) return existing.slice(0, n);
  const base = (existing[0] || input.basePrompt).replace(/\s+/g, " ").trim();
  if (!base) return [];
  if (n <= 1) return [base];
  const deltas = input.kind === "variant" ? VARIANT_DELTAS : GENERATE_DELTAS;
  return uniquePrompts(
    Array.from({ length: n }, (_, i) => {
      const delta = deltas[i % deltas.length];
      return `${base} Distinct treatment ${i + 1}/${n}: ${delta}.`;
    })
  );
}
