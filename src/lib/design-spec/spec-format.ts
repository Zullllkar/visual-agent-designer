/**
 * 设计规格：纯格式化 / 启发式（可在 Client Component 使用）
 * Vision 抽取见 extract-asset-spec.ts（server-only）
 * @author：wangjunhua
 */

import { nanoid } from "nanoid";
import type { ImageAsset } from "@/lib/project/assets-schema";
import {
  AssetDesignSpecSchema,
  type AssetDesignSpec,
} from "@/lib/project/design-spec-schema";
import type { ProjectFile } from "@/lib/project/schema";

export function buildHeuristicSpec(
  asset: ImageAsset,
  project: ProjectFile,
  now = new Date().toISOString(),
  extractionWarnings: string[] = []
): AssetDesignSpec {
  const prompt = asset.prompt ?? "";
  const screenType = inferScreenType(prompt, asset.role);
  const hexes = Array.from(
    new Set(
      `${project.brief?.visualStyle ?? ""} ${prompt}`.match(
        /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g
      ) ?? []
    )
  ).slice(0, 8);

  const spec: AssetDesignSpec = {
    version: 1,
    assetId: asset.id,
    summary: [
      project.brief?.productName ?? project.title,
      screenType,
      asset.role ? `role=${asset.role}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    screenType,
    layout: inferLayout(prompt, screenType),
    hierarchy: inferHierarchy(prompt, screenType),
    regions: buildHeuristicRegions(prompt, screenType, asset),
    tokens: {
      colors: hexes.map((value, i) => ({
        name: i === 0 ? "accent" : `color-${i + 1}`,
        value,
        usage: i === 0 ? "Brand / accent from prompt context" : undefined,
      })),
      typography: [
        { role: "display", sizePx: 32, weight: "700" },
        { role: "body", sizePx: 14, weight: "400" },
        { role: "caption", sizePx: 12, weight: "500" },
      ],
      radii: [8, 12, 16],
      spacingHints: [
        "Use consistent 8px rhythm",
        "Keep primary CTA visually dominant",
      ],
    },
    components: inferComponents(prompt, screenType),
    artStyle: inferArtStyle(
      `${project.brief?.visualStyle ?? ""} ${prompt}`,
      hexes
    ),
    doNot: [
      "Do not invent a different visual system than the asset",
      "Do not turn an app UI reference into a generic marketing poster",
      "Do not bake dynamic UI copy into images unless the asset itself is the illustration",
    ],
    implementationNotes: [
      "Treat this image as the primary visual reference for layout, hierarchy, and mood.",
      "Implement real code-rendered text, controls, and states.",
      `Target platform: ${project.brief?.platform ?? "as implied by the asset"}.`,
      "Regenerate this spec with a vision LLM when possible for richer region/token detail.",
    ],
    source: "heuristic",
    model: "heuristic",
    extractionWarnings:
      extractionWarnings.length > 0
        ? extractionWarnings
        : [
            "Heuristic fallback: no vision decomposition. Configure a vision-capable LLM and retry materialize.",
          ],
    createdAt: asset.designSpec?.createdAt ?? now,
    updatedAt: now,
  };

  return AssetDesignSpecSchema.parse(spec);
}

function buildHeuristicRegions(
  prompt: string,
  screenType: AssetDesignSpec["screenType"],
  _asset: ImageAsset
): AssetDesignSpec["regions"] {
  const isAssetLibrary =
    /素材库|asset.?library|inventory|catalog|道具|weapon|item.?grid|thumbnail.?grid/i.test(
      prompt
    );

  if (isAssetLibrary) {
    return [
      {
        id: "nav",
        name: "Top navigation",
        role: "nav",
        delivery: "code",
        bbox: { x: 0, y: 0, w: 1, h: 0.08 },
        notes: "Heuristic — verify with vision",
      },
      {
        id: "hero-art",
        name: "Hero illustration",
        role: "hero",
        delivery: "media",
        bbox: { x: 0.55, y: 0.06, w: 0.4, h: 0.22 },
        notes: "Heuristic hero placement for asset-library layouts",
      },
      {
        id: "search",
        name: "Search bar",
        role: "form",
        delivery: "code",
        bbox: { x: 0.05, y: 0.1, w: 0.45, h: 0.05 },
      },
      {
        id: "grid-chrome",
        name: "Asset grid chrome",
        role: "main",
        delivery: "code",
        bbox: { x: 0.03, y: 0.28, w: 0.94, h: 0.68 },
        notes: "Card frames and labels — code; item bitmaps need vision per-slot",
      },
    ];
  }

  if (screenType === "landing") {
    return [
      {
        id: "nav",
        name: "Navigation",
        role: "nav",
        delivery: "code",
        bbox: { x: 0, y: 0, w: 1, h: 0.1 },
      },
      {
        id: "hero-art",
        name: "Hero visual",
        role: "hero",
        delivery: "media",
        bbox: { x: 0.05, y: 0.08, w: 0.9, h: 0.38 },
        notes: "Heuristic hero band",
      },
      {
        id: "content",
        name: "Main content",
        role: "main",
        delivery: "code",
        bbox: { x: 0.05, y: 0.48, w: 0.9, h: 0.45 },
      },
    ];
  }

  return [
    {
      id: nanoid(6),
      name: "Primary composition",
      role: screenType === "illustration" ? "illustration" : "main",
      delivery: screenType === "illustration" ? "media" : "code",
      bbox:
        screenType === "illustration"
          ? { x: 0.05, y: 0.05, w: 0.9, h: 0.9 }
          : { x: 0.05, y: 0.05, w: 0.9, h: 0.35 },
      notes:
        "Heuristic region — regenerate with a vision-capable LLM for bbox/copy detail.",
    },
  ];
}

function inferArtStyle(
  text: string,
  hexes: string[]
): NonNullable<AssetDesignSpec["artStyle"]> {
  const t = text.toLowerCase();
  const pick = (rules: Array<[RegExp, string]>) => {
    for (const [re, value] of rules) {
      if (re.test(t)) return value;
    }
    return "";
  };
  return {
    finish: pick([
      [/brushed\s*steel|steel|metallic|金属/, "brushed steel"],
      [/matte|frosted|磨砂/, "matte glass"],
      [/gloss|lacquer|亮面/, "gloss enamel"],
    ]),
    lighting: pick([
      [/neon|霓虹/, "neon rim light"],
      [/glow|发光/, "soft glow"],
      [/soft|柔光/, "soft diffused light"],
    ]),
    texture: pick([
      [/cross[- ]?hatch|网格|拉丝/, "cross-hatch metal"],
      [/grain|noise|噪点/, "fine grain"],
      [/carbon|碳纤维/, "carbon fiber"],
    ]),
    edge: pick([
      [/neon\s*(top\s*)?edge|紫霓虹边/, "thin neon edge"],
      [/bevel|chamfer|倒角/, "beveled edge"],
    ]),
    accent: hexes[0] ?? "",
  };
}

function inferScreenType(
  prompt: string,
  role?: ImageAsset["role"]
): AssetDesignSpec["screenType"] {
  if (role === "illustration" || role === "background") return "illustration";
  if (/dashboard|仪表盘|后台|analytics/i.test(prompt)) return "dashboard";
  if (/mobile|ios|android|手机|app ui|手机端/i.test(prompt)) return "mobile-app";
  if (/desktop|桌面|web app|saas/i.test(prompt)) return "desktop-app";
  if (/landing|首页|hero|官网|营销/i.test(prompt)) return "landing";
  if (/poster|banner|营销图/i.test(prompt)) return "marketing";
  return "other";
}

function inferLayout(
  prompt: string,
  screenType: AssetDesignSpec["screenType"]
): string {
  if (screenType === "dashboard") return "Top bar + sidebar + main content grid";
  if (screenType === "mobile-app")
    return "Single-column mobile stack with bottom or top nav";
  if (screenType === "landing") return "Hero band → features/proof → CTA sections";
  if (/sidebar|侧栏/i.test(prompt)) return "Sidebar + main canvas";
  return "Centered visual composition matching the asset framing";
}

function inferHierarchy(
  prompt: string,
  screenType: AssetDesignSpec["screenType"]
): string[] {
  if (screenType === "landing") {
    return ["Brand/nav", "Hero headline + CTA", "Supporting sections", "Footer"];
  }
  if (screenType === "dashboard") {
    return ["Global nav", "Filters/metrics", "Primary data view", "Secondary panels"];
  }
  if (screenType === "mobile-app") {
    return ["Status/header", "Primary content", "Primary action", "Tab bar"];
  }
  if (/pricing|价格/i.test(prompt)) {
    return ["Headline", "Plan cards", "CTA", "Footnotes"];
  }
  return ["Primary focal area", "Supporting UI chrome", "Secondary details"];
}

function inferComponents(
  prompt: string,
  screenType: AssetDesignSpec["screenType"]
): AssetDesignSpec["components"] {
  const base: AssetDesignSpec["components"] = [
    { name: "PrimaryButton", kind: "button", variants: ["primary", "ghost"] },
    { name: "SurfaceCard", kind: "card" },
  ];
  if (screenType === "dashboard" || /table|list|列表/i.test(prompt)) {
    base.push({ name: "DataList", kind: "list" });
  }
  if (/nav|导航|tab/i.test(prompt) || screenType === "mobile-app") {
    base.push({ name: "AppNav", kind: "nav" });
  }
  if (/form|input|搜索|login|登录/i.test(prompt)) {
    base.push({ name: "TextField", kind: "input" });
  }
  return base;
}

/** 单素材规格 → Markdown（写入 design/specs/*.md） */
export function renderAssetDesignSpecMarkdown(
  spec: AssetDesignSpec,
  assetMeta?: { file?: string; prompt?: string }
): string {
  const lines: string[] = [];
  lines.push(`# Design Spec — ${spec.assetId}`, "");
  lines.push(`- Source: ${spec.source}${spec.model ? ` (${spec.model})` : ""}`);
  lines.push(`- Screen type: ${spec.screenType}`);
  lines.push(`- Updated: ${spec.updatedAt}`);
  if (assetMeta?.file) lines.push(`- Asset file: \`${assetMeta.file}\``);
  lines.push("", "## Summary", "", spec.summary, "");
  lines.push("## Layout", "", spec.layout, "");
  if (spec.artStyle) {
    const a = spec.artStyle;
    const bits = [
      a.finish && `finish=${a.finish}`,
      a.lighting && `lighting=${a.lighting}`,
      a.texture && `texture=${a.texture}`,
      a.edge && `edge=${a.edge}`,
      a.accent && `accent=${a.accent}`,
    ].filter(Boolean);
    if (bits.length) {
      lines.push("## Art Style (Style DNA)", "", bits.map((b) => `- ${b}`).join("\n"), "");
    }
  }
  if (spec.hierarchy.length) {
    lines.push("## Hierarchy", "");
    spec.hierarchy.forEach((h) => lines.push(`- ${h}`));
    lines.push("");
  }
  if (spec.regions.length) {
    lines.push("## Regions", "");
    for (const r of spec.regions) {
      lines.push(`### ${r.name} (\`${r.role}\`)`);
      if (r.bbox) {
        lines.push(
          `- bbox: x=${pct(r.bbox.x)} y=${pct(r.bbox.y)} w=${pct(r.bbox.w)} h=${pct(r.bbox.h)}`
        );
      }
      if (r.copy) lines.push(`- copy: ${r.copy}`);
      if (r.notes) lines.push(`- notes: ${r.notes}`);
      lines.push("");
    }
  }
  lines.push("## Tokens", "");
  if (spec.tokens.colors.length) {
    lines.push("### Colors", "");
    for (const c of spec.tokens.colors) {
      lines.push(
        `- **${c.name}**: \`${c.value}\`${c.usage ? ` — ${c.usage}` : ""}`
      );
    }
    lines.push("");
  }
  if (spec.tokens.typography.length) {
    lines.push("### Typography", "");
    for (const t of spec.tokens.typography) {
      lines.push(
        `- **${t.role}**: ${t.sizePx ? `${t.sizePx}px` : "size n/a"}${t.weight ? `, ${t.weight}` : ""}${t.notes ? ` — ${t.notes}` : ""}`
      );
    }
    lines.push("");
  }
  if (spec.tokens.radii.length) {
    lines.push(
      `### Radii: ${spec.tokens.radii.map((n) => `${n}px`).join(", ")}`,
      ""
    );
  }
  if (spec.tokens.spacingHints.length) {
    lines.push("### Spacing", "");
    spec.tokens.spacingHints.forEach((s) => lines.push(`- ${s}`));
    lines.push("");
  }
  if (spec.components.length) {
    lines.push("## Components", "");
    for (const c of spec.components) {
      lines.push(
        `- **${c.name}** (\`${c.kind}\`)${c.variants?.length ? ` — ${c.variants.join(", ")}` : ""}${c.notes ? `: ${c.notes}` : ""}`
      );
    }
    lines.push("");
  }
  if (spec.implementationNotes.length) {
    lines.push("## Implementation notes", "");
    spec.implementationNotes.forEach((n) => lines.push(`- ${n}`));
    lines.push("");
  }
  if (spec.doNot.length) {
    lines.push("## Do not", "");
    spec.doNot.forEach((n) => lines.push(`- ${n}`));
    lines.push("");
  }
  if (assetMeta?.prompt) {
    lines.push(
      "## Generation prompt",
      "",
      "```text",
      assetMeta.prompt,
      "```",
      ""
    );
  }
  return lines.join("\n");
}

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

/** 合并项目内所有素材规格的色板等到 tokens.json */
export function mergeSpecTokensIntoHandoffTokens(
  base: { color: string[]; fontSize: number[]; radius: number[] },
  specs: AssetDesignSpec[]
) {
  const colors = new Set(base.color);
  const fontSizes = new Set(base.fontSize);
  const radii = new Set(base.radius);
  for (const spec of specs) {
    for (const c of spec.tokens.colors) {
      if (c.value) colors.add(c.value);
    }
    for (const t of spec.tokens.typography) {
      if (typeof t.sizePx === "number") fontSizes.add(t.sizePx);
    }
    for (const r of spec.tokens.radii) radii.add(r);
  }
  return {
    ...base,
    color: [...colors],
    fontSize: [...fontSizes].sort((a, b) => a - b),
    radius: [...radii].sort((a, b) => a - b),
    fromSpecs: specs.map((s) => ({
      assetId: s.assetId,
      screenType: s.screenType,
      source: s.source,
      colorCount: s.tokens.colors.length,
    })),
  };
}
