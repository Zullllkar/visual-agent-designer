/**
 * 代码区域的状态推断
 * --------------------------------------------------------------
 * mockup 只画了一种状态。coding agent 若只做这一种，产品就没有 hover、
 * 空态、加载、错误。这里按 role 给出标准状态集（纯规则，永远可用），
 * 再用一次很便宜的纯文本 LLM 调用补"这个产品下空态 / 错误态该说什么"。
 * LLM 不可用或输出不合法时保留规则结果。
 */

import type { AssetDesignSpec, DesignSpecRegion } from "@/lib/project/design-spec-schema";
import type { ProjectFile } from "@/lib/project/schema";
import type { LlmProvider } from "@/lib/providers/llm/types";
import { isMockLlmText } from "@/lib/providers/llm/utils";

export type RegionState = NonNullable<DesignSpecRegion["states"]>[number];

const INTERACTIVE_ROLES = new Set([
  "nav",
  "cta",
  "form",
  "card",
  "sidebar",
  "main",
  "footer",
  "other",
]);

/** 角色级标准状态；notes 写成 agent 能直接照做的实现要求 */
export function heuristicStatesForRegion(region: DesignSpecRegion): RegionState[] {
  const role = String(region.role ?? "other");
  switch (role) {
    case "cta":
      return [
        { name: "default", notes: "As shown in the mockup." },
        {
          name: "hover",
          notes: "Slightly darker / lifted; keep the same size so layout does not shift.",
        },
        { name: "focus-visible", notes: "Visible keyboard focus ring using the accent color." },
        { name: "disabled", notes: "Reduced opacity, no pointer events, still readable." },
        {
          name: "loading",
          notes:
            "Spinner or progress inside the button; label stays, button width does not change.",
        },
      ];
    case "form":
      return [
        { name: "empty", notes: "Placeholder text visible, no value." },
        { name: "focused", notes: "Accent-colored border / ring; placeholder stays until typing." },
        { name: "filled", notes: "User value shown; clear affordance if applicable." },
        {
          name: "error",
          notes: "Error border + inline message below the field; do not rely on color alone.",
        },
        { name: "disabled", notes: "Muted field, not editable." },
      ];
    case "nav":
      return [
        { name: "default", notes: "As shown." },
        {
          name: "active",
          notes:
            "Current route highlighted (weight / underline / accent), exactly one item active.",
        },
        { name: "hover", notes: "Subtle highlight on the item, not the whole bar." },
        {
          name: "collapsed",
          notes: "On narrow viewports collapse into a menu; keep the primary CTA reachable.",
        },
      ];
    case "card":
      return [
        { name: "default", notes: "As shown." },
        {
          name: "hover",
          notes: "Elevate / border accent when the card is clickable; none if it is static.",
        },
        { name: "loading", notes: "Skeleton placeholder with the same dimensions." },
        {
          name: "empty",
          notes:
            "When the list behind this card has no items, show an empty state with one clear action.",
        },
      ];
    case "sidebar":
      return [
        { name: "expanded", notes: "As shown." },
        { name: "collapsed", notes: "Icon-only rail; tooltips reveal labels." },
        { name: "active-item", notes: "Current section highlighted." },
      ];
    case "main":
      return [
        { name: "populated", notes: "As shown." },
        {
          name: "loading",
          notes: "Skeletons matching the final layout; avoid spinners in large areas.",
        },
        { name: "empty", notes: "First-run / no-data state with one primary action." },
        { name: "error", notes: "Inline error with retry; do not blank the whole area." },
      ];
    case "footer":
      return [{ name: "default", notes: "As shown; links get hover underline." }];
    default:
      return [{ name: "default", notes: "As shown." }];
  }
}

const SYSTEM = `You write the non-default UI states for regions of a product screen.
The mockup shows one state only; the coding agent must also build empty, loading, error, hover, disabled and active states.
Output STRICT JSON only (no markdown fence):
{"regions":[{"id":string,"states":[{"name":string,"notes":string,"copy"?:string}]}]}
Rules:
- Keep the given state names when they make sense; you may drop states that do not apply and add at most 2 that do.
- notes: one concrete implementation sentence (what changes visually / behaviourally).
- copy: ONLY for empty / error / loading states — the actual text the user sees, in the product's language, short, specific to this product (no "Lorem", no "Something went wrong" if you can be specific).
- Do not restate the default state's copy. Do not invent regions.`;

export async function inferRegionStates(input: {
  spec: AssetDesignSpec;
  project: ProjectFile;
  llm?: LlmProvider;
}): Promise<{ spec: AssetDesignSpec; source: "llm" | "heuristic" | "none"; warnings: string[] }> {
  const { spec, project, llm } = input;
  const warnings: string[] = [];
  const codeRegions = spec.regions.filter((r) => isCodeRegion(r));
  if (codeRegions.length === 0) return { spec, source: "none", warnings };

  const heuristic = new Map(codeRegions.map((r) => [r.id, heuristicStatesForRegion(r)]));
  let merged = heuristic;
  let source: "llm" | "heuristic" = "heuristic";

  if (llm && llm.name !== "mock-llm") {
    try {
      const prompt = [
        `Product: ${project.brief?.productName ?? project.title} — ${project.brief?.positioning ?? project.rawIdea}`,
        `Target users: ${project.brief?.targetUser ?? "n/a"} · Platform: ${project.brief?.platform ?? "n/a"} · Language: ${detectLanguage(spec, project)}`,
        `Screen: ${spec.summary} (${spec.screenType})`,
        "",
        "Regions (id · role · copy · notes) with the default state set to refine:",
        ...codeRegions.map((r) => {
          const states = heuristic.get(r.id) ?? [];
          return `- ${r.id} · ${r.role} · ${r.copy ? `"${r.copy}"` : "(no copy)"}${r.notes ? ` · ${r.notes}` : ""}\n  states: ${states.map((s) => s.name).join(", ")}`;
        }),
      ].join("\n");
      const out = await llm.generateText({
        system: SYSTEM,
        prompt,
        schema: { type: "object" },
        temperature: 0.3,
        maxTokens: 2048,
      });
      if (isMockLlmText(out.text)) {
        warnings.push("LLM returned mock output; kept rule-based states.");
      } else {
        const parsed = parseStates(out.text);
        if (parsed) {
          merged = mergeStates(heuristic, parsed);
          source = "llm";
        } else {
          warnings.push("State inference returned unparseable JSON; kept rule-based states.");
        }
      }
    } catch (err) {
      warnings.push(`State inference failed: ${(err as Error).message}`.slice(0, 200));
    }
  }

  return {
    spec: {
      ...spec,
      regions: spec.regions.map((r) => {
        const states = merged.get(r.id);
        return states && states.length ? { ...r, states } : r;
      }),
    },
    source,
    warnings,
  };
}

function isCodeRegion(r: DesignSpecRegion): boolean {
  if (r.delivery === "media") return false;
  if (r.delivery === "code") return true;
  return (
    INTERACTIVE_ROLES.has(String(r.role ?? "other")) &&
    !["hero", "illustration", "background", "avatar", "icon", "decoration"].includes(String(r.role))
  );
}

function parseStates(text: string): Map<string, RegionState[]> | null {
  const raw = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const json = JSON.parse(raw.slice(start, end + 1)) as { regions?: unknown };
    if (!Array.isArray(json.regions)) return null;
    const map = new Map<string, RegionState[]>();
    for (const row of json.regions) {
      if (!row || typeof row !== "object") continue;
      const r = row as { id?: unknown; states?: unknown };
      if (typeof r.id !== "string" || !Array.isArray(r.states)) continue;
      const states: RegionState[] = [];
      for (const s of r.states) {
        if (!s || typeof s !== "object") continue;
        const st = s as { name?: unknown; notes?: unknown; copy?: unknown };
        if (typeof st.name !== "string" || !st.name.trim()) continue;
        states.push({
          name: st.name.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 32),
          notes: typeof st.notes === "string" ? st.notes.trim().slice(0, 240) : "",
          copy:
            typeof st.copy === "string" && st.copy.trim()
              ? st.copy.trim().slice(0, 160)
              : undefined,
        });
      }
      if (states.length) map.set(r.id, states.slice(0, 8));
    }
    return map.size ? map : null;
  } catch {
    return null;
  }
}

/** LLM 结果优先；它漏掉的规则状态补回来（规则集是底线） */
function mergeStates(
  heuristic: Map<string, RegionState[]>,
  fromLlm: Map<string, RegionState[]>,
): Map<string, RegionState[]> {
  const out = new Map<string, RegionState[]>();
  for (const [id, base] of heuristic) {
    const llmStates = fromLlm.get(id);
    if (!llmStates) {
      out.set(id, base);
      continue;
    }
    const seen = new Set(llmStates.map((s) => s.name));
    const filled = llmStates.map((s) => {
      if (s.notes) return s;
      const fallback = base.find((b) => b.name === s.name);
      return fallback ? { ...s, notes: fallback.notes } : s;
    });
    const missingBaseline = base.filter(
      (b) => !seen.has(b.name) && ["error", "empty", "disabled", "loading"].includes(b.name),
    );
    out.set(id, [...filled, ...missingBaseline].slice(0, 8));
  }
  return out;
}

function detectLanguage(spec: AssetDesignSpec, project: ProjectFile): string {
  const sample = [
    ...(spec.copyPlan ?? []).map((c) => c.text),
    ...spec.regions.map((r) => r.copy ?? ""),
    project.brief?.positioning ?? "",
  ].join(" ");
  return /[\u4e00-\u9fa5]/.test(sample) ? "Chinese" : "English";
}
