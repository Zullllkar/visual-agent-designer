/**
 * Layout IR + Materialization — 编码资产包的结构权威层
 */

import { z } from "zod";
import type { AssetDesignSpec, DesignSpecRegion } from "@/lib/project/design-spec-schema";
import type { ImageAsset } from "@/lib/project/assets-schema";
import { suggestGenMode } from "./material-gen-mode";

export const BBoxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});

export const MediaRoleSchema = z.enum([
  "hero",
  "illustration",
  "background",
  "avatar",
  "icon",
  "decoration",
  "other",
]);

export const CodeRoleSchema = z.enum([
  "nav",
  "cta",
  "form",
  "footer",
  "card",
  "sidebar",
  "main",
  "other",
]);

/** 材质 DNA：零件生图用，禁止塞页面结构 */
export const StyleDnaSchema = z.object({
  finish: z.string().default(""),
  lighting: z.string().default(""),
  texture: z.string().default(""),
  edge: z.string().default(""),
  accent: z.string().default(""),
});

export const StyleLockSchema = z.object({
  palette: z.array(z.string()).default([]),
  mood: z.string().default(""),
  materials: z.string().default(""),
  doNot: z.array(z.string()).default([]),
  summary: z.string().default(""),
  /** 可选：旧记录无此字段；新拆解必写 */
  dna: StyleDnaSchema.optional(),
});

/** 嵌套提示：子槽相对父槽的包含关系（编码 Agent 布局用） */
export const LayoutHintSchema = z.object({
  parentId: z.string().optional(),
  zIndex: z.number().int().optional(),
  order: z.number().int().optional(),
});

export const MaterialSlotSchema = z.object({
  id: z.string(),
  parentAssetId: z.string(),
  role: MediaRoleSchema,
  bbox: BBoxSchema,
  rebuildInCode: z.literal(false),
  prompt: z.string(),
  status: z
    .enum(["pending", "generating", "ready", "failed"])
    .default("pending"),
  materialAssetId: z.string().optional(),
  cropPreviewSrc: z.string().optional(),
  matchedReferenceId: z.string().optional(),
  notes: z.string().optional(),
  media: z.string().nullable().optional(),
  layoutHint: LayoutHintSchema.optional(),
  /** slice=直接裁切 / refine=像素锚定提纯 / regenerate=文字重绘 */
  genMode: z.enum(["slice", "refine", "regenerate"]).optional(),
  outputSpec: z
    .object({
      alpha: z.boolean().default(false),
      tileable: z.boolean().default(false),
      bleed: z.number().min(0).max(0.2).default(0),
    })
    .optional(),
  genModeConfidence: z.number().min(0).max(1).optional(),
  genModeReasons: z.array(z.string()).optional(),
});

export const CodeSlotSchema = z.object({
  id: z.string(),
  role: CodeRoleSchema,
  bbox: BBoxSchema,
  rebuildInCode: z.literal(true),
  copy: z.string().optional(),
  suggestedComponent: z.string().optional(),
  states: z
    .array(
      z.object({
        name: z.string(),
        notes: z.string(),
      })
    )
    .optional(),
  notes: z.string().optional(),
  media: z.null().optional(),
  layoutHint: LayoutHintSchema.optional(),
});

export const LayoutNodeSchema = z.union([MaterialSlotSchema, CodeSlotSchema]);

export const LayoutIRSchema = z.object({
  version: z.literal(1),
  mockupAssetId: z.string(),
  width: z.number(),
  height: z.number(),
  referenceImage: z.string(),
  screenType: z.string().optional(),
  styleLock: StyleLockSchema.optional(),
  nodes: z.array(LayoutNodeSchema),
  meta: z
    .object({
      source: z.enum(["vision", "heuristic", "mixed"]),
      createdAt: z.string(),
      warnings: z.array(z.string()).optional(),
    })
    .optional(),
});

export { MockupApprovalSchema, type MockupApproval } from "@/lib/project/assets-schema";

export const MaterializationRecordSchema = z.object({
  mockupAssetId: z.string(),
  layout: LayoutIRSchema,
  styleLock: StyleLockSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type BBox = z.infer<typeof BBoxSchema>;
export type StyleDna = z.infer<typeof StyleDnaSchema>;
export type StyleLock = z.infer<typeof StyleLockSchema>;
export type LayoutHint = z.infer<typeof LayoutHintSchema>;
export type MaterialSlot = z.infer<typeof MaterialSlotSchema>;
export type CodeSlot = z.infer<typeof CodeSlotSchema>;
export type LayoutNode = z.infer<typeof LayoutNodeSchema>;
export type LayoutIR = z.infer<typeof LayoutIRSchema>;
export type MaterializationRecord = z.infer<typeof MaterializationRecordSchema>;

const MEDIA_ROLES = new Set<string>([
  "hero",
  "illustration",
  "background",
  "avatar",
  "icon",
  "decoration",
]);

const CODE_ROLES = new Set<string>([
  "nav",
  "cta",
  "form",
  "footer",
  "card",
  "sidebar",
  "main",
]);

/** 从 designSpec regions 构建 Layout IR（无 LLM） */
export function buildLayoutIRFromDesignSpec(input: {
  asset: ImageAsset;
  spec: AssetDesignSpec;
  styleLock?: StyleLock;
  warnings?: string[];
}): LayoutIR {
  const { asset, spec, styleLock, warnings = [] } = input;
  const now = new Date().toISOString();
  const nodes: LayoutNode[] = [];

  const regions =
    spec.regions.length > 0
      ? spec.regions
      : [
          {
            id: "main",
            name: "Main visual",
            role: "illustration" as const,
            bbox: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 },
            notes: "Fallback full-bleed media region",
          },
        ];

  for (const region of regions) {
    const bbox = normalizeBBox(region.bbox) ?? {
      x: 0.1,
      y: 0.1,
      w: 0.8,
      h: 0.35,
    };
    const role = String(region.role ?? "other");
    const delivery = resolveRegionDelivery(region);
    const isMedia = delivery === "media";

    if (isMedia) {
      const mediaRole = (MEDIA_ROLES.has(role) ? role : "illustration") as
        | "hero"
        | "illustration"
        | "background"
        | "avatar"
        | "icon"
        | "decoration"
        | "other";
      const prompt = buildMaterialPrompt({
        role: mediaRole,
        regionName: region.name,
        notes: region.notes,
        styleLock,
        mockupPrompt: asset.prompt,
        materialPrompt: region.materialPrompt,
      });
      const plan = suggestGenMode({
        role: mediaRole,
        bbox,
        prompt,
      });
      nodes.push({
        id: region.id || `media-${nodes.length + 1}`,
        parentAssetId: asset.id,
        role: mediaRole,
        bbox,
        rebuildInCode: false,
        prompt,
        status: "pending",
        notes: region.notes,
        genMode: plan.genMode,
        outputSpec: plan.outputSpec,
        genModeConfidence: plan.confidence,
        genModeReasons: plan.reasons,
      });
    } else {
      const codeRole = (CODE_ROLES.has(role) ? role : "other") as
        | "nav"
        | "cta"
        | "form"
        | "footer"
        | "card"
        | "sidebar"
        | "main"
        | "other";
      nodes.push({
        id: region.id || `code-${nodes.length + 1}`,
        role: codeRole,
        bbox,
        rebuildInCode: true,
        copy: region.copy,
        suggestedComponent: suggestComponent(codeRole),
        notes: region.notes,
        media: null,
      });
    }
  }

  if (!nodes.some((n) => n.rebuildInCode === false)) {
    warnings.push("No media slots detected; added fallback illustration slot.");
    const fallbackPrompt = buildMaterialPrompt({
      role: "hero",
      regionName: "Hero",
      styleLock,
      mockupPrompt: asset.prompt,
    });
    const fallbackBBox = { x: 0.05, y: 0.08, w: 0.9, h: 0.42 };
    const plan = suggestGenMode({
      role: "hero",
      bbox: fallbackBBox,
      prompt: fallbackPrompt,
    });
    nodes.unshift({
      id: "hero",
      parentAssetId: asset.id,
      role: "hero",
      bbox: fallbackBBox,
      rebuildInCode: false,
      prompt: fallbackPrompt,
      status: "pending",
      genMode: plan.genMode,
      outputSpec: plan.outputSpec,
      genModeConfidence: plan.confidence,
      genModeReasons: plan.reasons,
    });
  }

  const nested = assignLayoutHints(nodes);

  const specWarnings = spec.extractionWarnings ?? [];
  const allWarnings = [...warnings, ...specWarnings];

  return {
    version: 1,
    mockupAssetId: asset.id,
    width: asset.width,
    height: asset.height,
    referenceImage: `assets/final/mockup-${asset.id}.${guessExt(asset.src)}`,
    screenType: spec.screenType,
    styleLock,
    nodes: nested,
    meta: {
      source: spec.source === "vision" ? "vision" : "heuristic",
      createdAt: now,
      warnings: allWarnings.length ? allWarnings : undefined,
    },
  };
}

/** 判定 region 应生图还是代码实现 */
export function resolveRegionDelivery(
  region: DesignSpecRegion
): "media" | "code" {
  if (region.delivery === "media" || region.delivery === "code") {
    return region.delivery;
  }
  if (region.materialPrompt?.trim()) return "media";

  const role = String(region.role ?? "other");
  const text = `${region.name ?? ""} ${region.notes ?? ""}`;

  if (MEDIA_ROLES.has(role)) return "media";

  if (
    role === "card" &&
    /icon|thumbnail|bitmap|cover|preview|thumb|item.?art|weapon|道具|缩略|封面|sprite|artwork/i.test(
      text
    )
  ) {
    return "media";
  }

  if (
    /bitmap|photo|image|illustration|hero|avatar|background|render|3d|artwork|isolated.?subject/i.test(
      text
    )
  ) {
    return "media";
  }

  if (CODE_ROLES.has(role)) return "code";
  if (role === "nav" || role === "cta" || role === "form" || role === "footer") {
    return "code";
  }

  return "code";
}

/**
 * 按 bbox 包含关系推断嵌套：取面积最小的严格父框作为 parentId。
 * background 角色优先作为根层（不挂到小框下）。
 */
export function assignLayoutHints(nodes: LayoutNode[]): LayoutNode[] {
  const withArea = nodes.map((node, order) => ({
    node,
    order,
    area: Math.max(0.0001, node.bbox.w * node.bbox.h),
  }));

  return withArea.map(({ node, order, area }) => {
    if (node.rebuildInCode === false && node.role === "background") {
      return {
        ...node,
        layoutHint: {
          ...(node.layoutHint ?? {}),
          zIndex: 0,
          order,
        },
      };
    }

    let parentId: string | undefined;
    let parentArea = Number.POSITIVE_INFINITY;
    for (const candidate of withArea) {
      if (candidate.node.id === node.id) continue;
      if (!containsBBox(candidate.node.bbox, node.bbox)) continue;
      if (candidate.area <= area) continue;
      if (candidate.area < parentArea) {
        parentArea = candidate.area;
        parentId = candidate.node.id;
      }
    }

    const zIndex =
      node.rebuildInCode === false && node.role === "hero"
        ? 2
        : node.rebuildInCode === false
          ? 1
          : 3;

    return {
      ...node,
      layoutHint: {
        ...(node.layoutHint ?? {}),
        ...(parentId ? { parentId } : {}),
        zIndex,
        order,
      },
    };
  });
}

function containsBBox(outer: BBox, inner: BBox): boolean {
  const pad = 0.005;
  return (
    inner.x + pad >= outer.x &&
    inner.y + pad >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w + pad &&
    inner.y + inner.h <= outer.y + outer.h + pad
  );
}

export function buildStyleLockFromSpec(spec: AssetDesignSpec): StyleLock {
  const palette = (spec.tokens?.colors ?? [])
    .map((c) => c.value)
    .filter(Boolean)
    .slice(0, 8);
  // mood 只留短审美词；完整 summary 放 summary 字段供文档，不进生图拼接
  const mood = extractShortMood(spec.summary);
  const dna = extractStyleDnaFromSpec(spec, palette);
  return {
    palette,
    mood,
    materials: (spec.tokens?.spacingHints ?? []).slice(0, 4).join("; "),
    doNot: spec.doNot ?? [],
    summary: [
      spec.summary,
      spec.layout,
      ...(spec.implementationNotes ?? []).slice(0, 3),
    ]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 400),
    dna,
  };
}

/** Vision artStyle 优先；否则从文案/色板启发式抽 DNA */
export function extractStyleDnaFromSpec(
  spec: AssetDesignSpec,
  palette?: string[]
): StyleDna {
  const colors = palette ?? (spec.tokens?.colors ?? []).map((c) => c.value);
  const fromVision = sanitizeDna(spec.artStyle);
  if (dnaHasSignal(fromVision)) {
    return {
      ...fromVision,
      accent: fromVision.accent || pickAccentColor(colors),
    };
  }
  return inferDnaFromText(
    [spec.summary, spec.layout, ...(spec.implementationNotes ?? [])].join(" "),
    colors
  );
}

function sanitizeDna(
  raw?: Partial<StyleDna> | null
): StyleDna {
  const clip = (v?: string) =>
    (v ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 48);
  return {
    finish: clip(raw?.finish),
    lighting: clip(raw?.lighting),
    texture: clip(raw?.texture),
    edge: clip(raw?.edge),
    accent: clip(raw?.accent),
  };
}

function dnaHasSignal(dna: StyleDna): boolean {
  return Boolean(
    dna.finish || dna.lighting || dna.texture || dna.edge || dna.accent
  );
}

function inferDnaFromText(text: string, palette: string[]): StyleDna {
  const t = text.toLowerCase();
  const finish = matchFirst(t, [
    [/brushed\s*steel|steel|metallic|金属/, "brushed steel"],
    [/matte\s*glass|frosted|磨砂/, "matte glass"],
    [/gloss|lacquer|亮面/, "gloss enamel"],
    [/concrete|水泥/, "raw concrete"],
  ]);
  const lighting = matchFirst(t, [
    [/neon|霓虹/, "neon rim light"],
    [/glow|发光/, "soft glow"],
    [/harsh|hard\s*light|硬光/, "hard industrial light"],
    [/soft|柔光/, "soft diffused light"],
  ]);
  const texture = matchFirst(t, [
    [/cross[- ]?hatch|网格|拉丝/, "cross-hatch metal"],
    [/grain|noise|噪点/, "fine grain"],
    [/carbon|碳纤维/, "carbon fiber"],
    [/cloth|fabric|织物/, "woven fabric"],
  ]);
  const edge = matchFirst(t, [
    [/neon\s*(top\s*)?edge|紫霓虹边/, "thin neon edge"],
    [/bevel|chamfer|倒角/, "beveled edge"],
    [/glow\s*border|发光边/, "glowing border"],
  ]);
  return {
    finish,
    lighting,
    texture,
    edge,
    accent: pickAccentColor(palette),
  };
}

function matchFirst(
  text: string,
  rules: Array<[RegExp, string]>
): string {
  for (const [re, value] of rules) {
    if (re.test(text)) return value;
  }
  return "";
}

function pickAccentColor(palette: string[]): string {
  for (const c of palette) {
    const hex = c.trim();
    if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) continue;
    const { r, g, b } = hexToRgb(hex);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    // 跳过近黑/近白/低饱和
    if (max < 40 || min > 220) continue;
    if (max - min < 30) continue;
    return hex;
  }
  return palette[0] ?? "";
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.slice(1);
  if (h.length === 3) {
    h = h
      .split("")
      .map((ch) => ch + ch)
      .join("");
  }
  const n = Number.parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** 从 designSpec.summary 抽短 mood；整页叙述不进 mood */
function extractShortMood(summary: string): string {
  const raw = summary.trim().replace(/\s+/g, " ");
  if (!raw) return "";
  // 整段含页面结构词 / 过长 → 不抽 mood（避免 "Dark, … login page" 只留下 Dark）
  if (
    raw.length > 72 ||
    /\b(page|login|sidebar|header|footer|navbar|layout|screen|dashboard|mockup|整页|登录|侧栏)\b/i.test(
      raw
    )
  ) {
    return "";
  }
  const head = raw.split(/[,，、]/)[0]?.trim() ?? "";
  if (!head || head.length < 3 || head.length > 48) return "";
  return head;
}

export function countMediaSlots(layout: LayoutIR): number {
  return layout.nodes.filter((n) => n.rebuildInCode === false).length;
}

export function countReadyMaterials(layout: LayoutIR): number {
  return layout.nodes.filter(
    (n) => n.rebuildInCode === false && n.status === "ready" && n.materialAssetId
  ).length;
}

/** 将媒体槽改为代码实现（不再生图 / 打包 materials） */
export function markMaterialSlotsAsCode(
  record: MaterializationRecord,
  slotIds: string[]
): MaterializationRecord {
  const wanted = new Set(slotIds);
  const now = new Date().toISOString();
  return {
    ...record,
    updatedAt: now,
    layout: {
      ...record.layout,
      nodes: record.layout.nodes.map((node) => {
        if (node.rebuildInCode !== false || !wanted.has(node.id)) return node;
        return {
          id: node.id,
          role: codeRoleFromMedia(node.role),
          bbox: node.bbox,
          rebuildInCode: true as const,
          copy: node.notes || node.prompt.slice(0, 80),
          suggestedComponent: suggestComponent(codeRoleFromMedia(node.role)),
          notes: `Converted from media slot (${node.role})`,
          media: null,
        };
      }),
    },
  };
}

function codeRoleFromMedia(
  role: MaterialSlot["role"] | string
): CodeSlot["role"] {
  if (role === "icon") return "other";
  if (role === "avatar") return "other";
  if (role === "hero" || role === "illustration" || role === "background") {
    return "main";
  }
  if (role === "decoration") return "other";
  return "other";
}

/** 供人工加槽 / 审槽改写时复用 */
export function buildMaterialPromptForSlot(input: {
  role: string;
  regionName: string;
  notes?: string;
  styleLock?: StyleLock;
  mockupPrompt: string;
  materialPrompt?: string;
}): string {
  return buildMaterialPrompt(input);
}

function buildMaterialPrompt(input: {
  role: string;
  regionName: string;
  notes?: string;
  styleLock?: StyleLock;
  mockupPrompt: string;
  materialPrompt?: string;
}): string {
  if (input.materialPrompt?.trim()) {
    const style = input.styleLock;
    const tail = [
      style?.palette?.length
        ? `Color palette lock: ${style.palette.join(", ")}.`
        : "",
      style?.doNot?.length ? `Do not: ${style.doNot.join("; ")}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
    return tail ? `${input.materialPrompt.trim()} ${tail}` : input.materialPrompt.trim();
  }
  const style = input.styleLock;
  const parts = [
    `Isolated ${input.role} visual asset for UI implementation.`,
    `Subject: ${input.regionName}.`,
    input.notes ? `Details: ${input.notes}.` : "",
    "Clean subject only — no phone frame, no UI chrome, no buttons, no text labels, no watermarks.",
    "Prefer transparent or solid clean background suitable for compositing into code.",
    style?.mood ? `Match mood: ${style.mood}.` : "",
    style?.palette?.length
      ? `Color palette lock: ${style.palette.join(", ")}.`
      : "",
    style?.doNot?.length ? `Do not: ${style.doNot.join("; ")}.` : "",
    `Style reference from approved mockup: ${input.mockupPrompt.slice(0, 280)}`,
  ];
  return parts.filter(Boolean).join(" ");
}

function suggestComponent(role: string): string {
  if (role === "cta") return "button";
  if (role === "form") return "input";
  if (role === "nav") return "nav";
  if (role === "card") return "card";
  return "other";
}

function normalizeBBox(
  bbox: { x: number; y: number; w: number; h: number } | undefined
): BBox | null {
  if (!bbox) return null;
  const x = clamp01(bbox.x);
  const y = clamp01(bbox.y);
  const w = clamp01(bbox.w);
  const h = clamp01(bbox.h);
  if (w < 0.02 || h < 0.02) return null;
  return { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function guessExt(src: string): string {
  if (/^data:image\/jpeg/i.test(src) || /\.jpe?g(\?|$)/i.test(src)) return "jpg";
  if (/^data:image\/webp/i.test(src) || /\.webp(\?|$)/i.test(src)) return "webp";
  return "png";
}
