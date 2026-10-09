/**
 * 跨屏组件归并（纯函数）
 * --------------------------------------------------------------
 * 每张 mockup 的 Layout IR 各自独立；同一个导航 / 页脚 / 主按钮出现在 4 屏上，
 * agent 很可能写 4 遍。这里把各屏的代码区域按「角色 + 位置带 + 尺寸 / 颜色」
 * 归成组件，只有跨 ≥2 屏的才算共享，输出给 COMPONENTS.md 和单屏任务引用。
 *
 * 判定刻意保守：宁可漏归并，不要把两个不同的东西说成一个。
 */

import type { ProjectFile } from "@/lib/project/schema";
import type { CodeSlot, LayoutIR } from "./layout-ir";
import { screenTitle } from "./screens";
import { listSelectableHandoffAssets } from "./select-assets";

export type SharedComponentKind =
  | "app-nav"
  | "footer"
  | "sidebar"
  | "primary-button"
  | "form-field"
  | "card"
  | "section";

export interface SharedComponentInstance {
  assetId: string;
  screenTitle: string;
  nodeId: string;
  copy?: string;
  bbox: { x: number; y: number; w: number; h: number };
}

export interface SharedComponent {
  id: string;
  name: string;
  kind: SharedComponentKind;
  /** 出现在几屏上 */
  screenCount: number;
  instances: SharedComponentInstance[];
  /** 各屏文案的并集（导航项、按钮文字…），去重保序 */
  copyVariants: string[];
  swatch?: { dominant: string; accent?: string };
  /** 各屏 states 名称并集 */
  states: string[];
  notes: string;
}

export interface SharedComponentIndex {
  components: SharedComponent[];
  /** assetId → nodeId → componentId */
  byScreen: Record<string, Record<string, string>>;
}

interface Candidate {
  assetId: string;
  screenTitle: string;
  node: CodeSlot;
  signature: string;
  kind: SharedComponentKind;
}

const NAME_BY_KIND: Record<SharedComponentKind, string> = {
  "app-nav": "AppNav",
  footer: "AppFooter",
  sidebar: "Sidebar",
  "primary-button": "PrimaryButton",
  "form-field": "FormField",
  card: "Card",
  section: "Section",
};

export function buildSharedComponentIndex(project: ProjectFile): SharedComponentIndex {
  const candidates: Candidate[] = [];
  for (const asset of listSelectableHandoffAssets(project)) {
    const layout = project.materializations?.[asset.id]?.layout;
    if (!layout) continue;
    const title = screenTitle(asset);
    for (const node of layout.nodes) {
      if (node.rebuildInCode !== true) continue;
      const classified = classify(node, layout);
      if (!classified) continue;
      candidates.push({ assetId: asset.id, screenTitle: title, node, ...classified });
    }
  }

  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const list = groups.get(c.signature) ?? [];
    list.push(c);
    groups.set(c.signature, list);
  }

  const components: SharedComponent[] = [];
  const byScreen: Record<string, Record<string, string>> = {};
  const usedNames = new Map<string, number>();

  for (const [, list] of groups) {
    const screens = new Set(list.map((c) => c.assetId));
    if (screens.size < 2) continue;
    const kind = list[0].kind;
    const base = NAME_BY_KIND[kind];
    const n = (usedNames.get(base) ?? 0) + 1;
    usedNames.set(base, n);
    const name = n === 1 ? base : `${base}${n}`;
    const id = name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();

    const copyVariants = uniq(
      list.map((c) => c.node.copy?.trim()).filter((s): s is string => Boolean(s)),
    );
    const states = uniq(list.flatMap((c) => (c.node.states ?? []).map((s) => s.name)));
    const swatch = mostCommonSwatch(list);

    components.push({
      id,
      name,
      kind,
      screenCount: screens.size,
      instances: list.map((c) => ({
        assetId: c.assetId,
        screenTitle: c.screenTitle,
        nodeId: c.node.id,
        copy: c.node.copy,
        bbox: c.node.bbox,
      })),
      copyVariants,
      swatch,
      states,
      notes: notesFor(kind, screens.size, copyVariants),
    });
    for (const c of list) {
      byScreen[c.assetId] ??= {};
      byScreen[c.assetId][c.node.id] = id;
    }
  }

  components.sort((a, b) => b.screenCount - a.screenCount || a.name.localeCompare(b.name));
  return { components, byScreen };
}

/**
 * 归类规则：
 *   nav 且贴顶横条          → app-nav
 *   footer 且贴底横条        → footer
 *   sidebar 且贴左/右竖条    → sidebar
 *   cta 按主色分组           → primary-button（同色才算同一个按钮）
 *   form 按高度分档          → form-field
 *   card 按宽高比 + 主色分组 → card
 *   其余 main / other 不归并（每屏的主体内容本来就不同）
 */
function classify(
  node: CodeSlot,
  layout: LayoutIR,
): { signature: string; kind: SharedComponentKind } | null {
  const { bbox } = node;
  switch (node.role) {
    case "nav":
      if (bbox.y <= 0.15 && bbox.w >= 0.6) return { signature: "nav:top", kind: "app-nav" };
      if (bbox.y + bbox.h >= 0.85 && bbox.w >= 0.6)
        return { signature: "nav:bottom", kind: "app-nav" };
      return null;
    case "footer":
      if (bbox.y + bbox.h >= 0.8 && bbox.w >= 0.6)
        return { signature: "footer:bottom", kind: "footer" };
      return null;
    case "sidebar":
      if (bbox.h >= 0.5 && bbox.w <= 0.35) {
        return {
          signature: `sidebar:${bbox.x <= 0.1 ? "left" : bbox.x + bbox.w >= 0.9 ? "right" : "mid"}`,
          kind: "sidebar",
        };
      }
      return null;
    case "cta": {
      const color = node.swatch?.dominant?.toUpperCase() ?? "none";
      return { signature: `cta:${color}`, kind: "primary-button" };
    }
    case "form": {
      const heightPx = bbox.h * layout.height;
      const band = heightPx < 56 ? "s" : heightPx < 120 ? "m" : "l";
      return { signature: `form:${band}`, kind: "form-field" };
    }
    case "card": {
      const ratio = (bbox.w * layout.width) / Math.max(1, bbox.h * layout.height);
      const ratioBand = ratio < 0.8 ? "tall" : ratio < 1.6 ? "square" : "wide";
      const color = node.swatch?.dominant?.toUpperCase() ?? "none";
      return { signature: `card:${ratioBand}:${color}`, kind: "card" };
    }
    default:
      return null;
  }
}

function mostCommonSwatch(list: Candidate[]): SharedComponent["swatch"] {
  const counts = new Map<string, { n: number; swatch: NonNullable<CodeSlot["swatch"]> }>();
  for (const c of list) {
    const s = c.node.swatch;
    if (!s) continue;
    const key = `${s.dominant}|${s.accent ?? ""}`;
    const hit = counts.get(key);
    if (hit) hit.n += 1;
    else counts.set(key, { n: 1, swatch: s });
  }
  let best: { n: number; swatch: NonNullable<CodeSlot["swatch"]> } | undefined;
  for (const v of counts.values()) if (!best || v.n > best.n) best = v;
  return best ? { dominant: best.swatch.dominant, accent: best.swatch.accent } : undefined;
}

function notesFor(kind: SharedComponentKind, screens: number, copyVariants: string[]): string {
  switch (kind) {
    case "app-nav":
      return `Same navigation on ${screens} screens — build one component with an \`active\` prop; items: ${copyVariants.join(" · ") || "see per-screen copy"}.`;
    case "footer":
      return `Shared footer on ${screens} screens — one component, no per-screen forks.`;
    case "sidebar":
      return `Shared sidebar on ${screens} screens — one component with \`activeSection\`; supports the collapsed state.`;
    case "primary-button":
      return `Same primary button style on ${screens} screens — one Button component; label is a prop (${copyVariants.length} variants seen).`;
    case "form-field":
      return `Form fields with the same size on ${screens} screens — one input component with label / placeholder / error props.`;
    case "card":
      return `Cards with the same shape and fill on ${screens} screens — one Card component; content via children.`;
    default:
      return `Appears on ${screens} screens.`;
  }
}

function uniq(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of list) {
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/** COMPONENTS.md */
export function renderComponentsMd(index: SharedComponentIndex): string {
  const lines = [
    "# Shared components",
    "",
    "Code regions that appear on two or more screens with the same role, placement and fill. Build each ONCE and reuse it; do not fork per screen.",
    "",
  ];
  if (index.components.length === 0) {
    lines.push(
      "_No cross-screen components detected yet (needs at least two materialized screens)._",
      "",
    );
    return lines.join("\n");
  }
  for (const c of index.components) {
    lines.push(`## ${c.name} (\`${c.id}\`) — ${c.screenCount} screens`, "", c.notes, "");
    if (c.swatch) {
      lines.push(
        `- Fill: \`${c.swatch.dominant}\`${c.swatch.accent ? ` · accent \`${c.swatch.accent}\`` : ""}`,
      );
    }
    if (c.states.length) lines.push(`- States to support: ${c.states.join(", ")}`);
    if (c.copyVariants.length)
      lines.push(`- Copy variants: ${c.copyVariants.map((v) => `"${v}"`).join(", ")}`);
    lines.push("- Instances:");
    for (const i of c.instances) {
      lines.push(
        `  - ${i.screenTitle} (\`${i.assetId}\`) → node \`${i.nodeId}\`${i.copy ? ` — "${i.copy}"` : ""}`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}
