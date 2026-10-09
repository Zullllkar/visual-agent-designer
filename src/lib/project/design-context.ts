import type {
  BrandKit,
  DesignContext,
  DesignDirection,
  ProductBrief,
  ProjectFile,
} from "./schema";
import { briefDisplayFields } from "@/lib/targets/brief";
import { parseTargetId, type TargetId } from "@/lib/targets/resolve";

/**
 * 没有任何真实来源时的占位色。不是设计决策——只是让 UI 有东西可渲染。
 * Handoff 不应把它当 tokens 交给 coding agent（见 isPlaceholderColorTokens）。
 */
const DEFAULT_COLORS = [
  { name: "background", value: "#EDEEF1", usage: "桌面、画布底、顶栏与侧栏" },
  { name: "surface", value: "#FFFFFF", usage: "内容面板与卡片" },
  { name: "primary", value: "#141416", usage: "主按钮、选中与焦点" },
  { name: "ink", value: "#141416", usage: "标题与正文" },
  { name: "muted", value: "#5C616B", usage: "说明文字与次要信息" },
];

const LEGACY_PLACEHOLDER_VALUES = [
  "#4F46FF",
  "#111827",
  "#64748B",
  "#F5F5F7",
  "#6366F1",
  "#18181C",
  "#6B7180",
];

const PLACEHOLDER_VALUES = new Set([
  ...DEFAULT_COLORS.map((c) => c.value.toUpperCase()),
  ...LEGACY_PLACEHOLDER_VALUES,
]);

/** 全部 token 都还是默认占位 → 没有真实颜色来源 */
export function isPlaceholderColorTokens(
  tokens: Array<{ value: string }> | undefined
): boolean {
  if (!tokens || tokens.length === 0) return true;
  return tokens.every((t) => PLACEHOLDER_VALUES.has(t.value.toUpperCase()));
}

export function deriveDesignContext(project: ProjectFile): DesignContext | null {
  const persisted = project.designContext;
  if (persisted && !isPlaceholderColorTokens(persisted.colorTokens)) return persisted;
  if (!persisted && !project.brief) return null;
  const ctx =
    persisted ??
    mergeBrandKit(
      buildDesignContext({
        brief: project.brief!,
        targetId: project.targetId,
        designDirection: project.designDirection,
        designSystemId: project.designSystemId,
      }),
      project.brandKit
    );
  return upgradeColorsFromPixelSpecs(ctx, project);
}

/**
 * 项目级色 token 仍是占位时，用定稿图的像素色板替换：
 * 优先 approved / 已物料化的 mockup，其次 starred，再其次任何带像素色板的素材。
 */
function upgradeColorsFromPixelSpecs(
  ctx: DesignContext,
  project: ProjectFile
): DesignContext {
  if (!isPlaceholderColorTokens(ctx.colorTokens)) return ctx;
  const assets = (project.assets ?? []).filter(
    (a) =>
      a.source !== "materialized" &&
      a.status !== "discarded" &&
      a.status !== "failed" &&
      a.designSpec?.tokens?.colors?.some((c) => c.source === "pixels")
  );
  if (assets.length === 0) return ctx;
  const rank = (a: (typeof assets)[number]) =>
    a.approval?.status === "approved" || a.approval?.status === "materials_ready"
      ? 0
      : project.materializations?.[a.id]
        ? 1
        : a.status === "starred"
          ? 2
          : 3;
  const best = [...assets].sort((a, b) => rank(a) - rank(b))[0];
  const colors = (best.designSpec?.tokens.colors ?? []).filter(
    (c) => c.source === "pixels"
  );
  if (colors.length === 0) return ctx;
  return {
    ...ctx,
    colorTokens: colors.map((c) => ({
      name: c.name,
      value: c.value,
      usage: `${c.usage ?? ""}（采样自定稿图 ${best.id}）`.trim(),
    })),
  };
}

export function readDesignContextFromScratch(
  scratch: Record<string, unknown>
): DesignContext | null {
  const value = scratch.designContext;
  if (!value || typeof value !== "object") return null;
  return value as DesignContext;
}

export function buildDesignContext({
  brief,
  targetId,
  designDirection,
  designSystemId,
  now = new Date().toISOString(),
}: {
  brief: ProductBrief;
  targetId?: TargetId | string;
  designDirection?: DesignDirection | null;
  designSystemId?: string;
  now?: string;
}): DesignContext {
  const id = parseTargetId(targetId);
  const slotLine = briefDisplayFields(brief, id)
    .map((field) => `${field.label}：${field.value}`)
    .join("；");
  const moodKeywords = uniqueCompact([
    ...(designDirection?.moodKeywords ?? []),
    ...splitStyleKeywords(brief.visualStyle),
    id === "ui-visual" ? brief.platform : id,
  ]).slice(0, 8);

  return {
    version: 1,
    source: "derived",
    brandVoice: brandVoiceForTarget(brief, id, slotLine),
    moodKeywords,
    colorTokens: DEFAULT_COLORS,
    typography: {
      heading: "清晰高对比标题，优先使用 600-800 字重形成页面层级。",
      body: "正文保持短句、具体、可扫描，避免占位文案。",
      notes:
        designDirection?.typographyNotes ??
        "标题、说明、按钮文案应有明确字号层级。",
    },
    layoutPrinciples: layoutPrinciplesForTarget(id, designDirection),
    componentPrinciples: componentPrinciplesForTarget(id),
    imageStyle: designDirection
      ? `${designDirection.summary}；图像需延续 ${brief.visualStyle}`
      : brief.visualStyle,
    doList: doListForTarget(brief, id, designSystemId, slotLine),
    avoidList: avoidListForTarget(id),
    updatedAt: now,
  };
}

function brandVoiceForTarget(
  brief: ProductBrief,
  targetId: TargetId,
  slotLine: string
): string {
  if (targetId === "ui-visual") {
    return `${brief.productName} 面向 ${brief.targetUser}，语气应清晰、可信、具体，突出「${brief.positioning}」。`;
  }
  if (slotLine) {
    return `${brief.productName}（${targetId}）：${slotLine}。`;
  }
  return `${brief.productName}：${brief.positioning}`;
}

function layoutPrinciplesForTarget(
  targetId: TargetId,
  designDirection?: DesignDirection | null
): string[] {
  const shared = [
    designDirection?.layoutNotes,
    "每页只保留一个主视觉重心。",
  ].filter(Boolean) as string[];
  if (targetId === "ui-visual") {
    return [
      ...shared,
      "首屏先解释产品价值，再展示关键操作。",
      "卡片、按钮、图像资产之间保留稳定间距，避免拥挤。",
    ];
  }
  return [...shared, "主体剪影清楚，不要做成 SaaS 首页。"];
}

function componentPrinciplesForTarget(targetId: TargetId): string[] {
  if (targetId === "ui-visual") {
    return [
      "按钮必须表达清晰动作，不使用泛化占位词。",
      "列表和卡片要服务于用户决策，而不是装饰堆叠。",
      "状态、评分、进度等数据要有明确标签和辅助解释。",
    ];
  }
  return [
    "画面元素服务于本目标配方，不套用 App 组件清单。",
    "文案只保留必须上的字，避免占位功能列表。",
  ];
}

function doListForTarget(
  brief: ProductBrief,
  targetId: TargetId,
  designSystemId?: string,
  slotLine?: string
): string[] {
  if (targetId === "ui-visual") {
    return [
      `持续贴合目标用户：${brief.targetUser}`,
      `优先呈现核心功能：${brief.coreFeatures.slice(0, 3).join("、")}`,
      designSystemId ? `遵循设计系统：${designSystemId}` : "保持同项目页面视觉一致",
    ];
  }
  return [
    slotLine || `贴合目标字段：${brief.positioning}`,
    `图像风格：${brief.visualStyle}`,
    "保持同项目世界观 / 方向卡一致",
  ];
}

function avoidListForTarget(targetId: TargetId): string[] {
  if (targetId === "ui-visual") {
    return [
      "避免 Lorem ipsum、卡片标题 A 等占位内容。",
      "避免突然切换色彩、字体、插画风格。",
      "避免生成不可编辑的整屏图片来承载真实 UI 文案。",
    ];
  }
  return [
    "避免编造 SaaS 产品功能列表。",
    "避免突然切换色彩、字体、插画风格。",
    "避免把本目标画成可点击界面或落地页。",
  ];
}

export function summarizeDesignContext(context: DesignContext): string {
  return [
    `Brand voice: ${context.brandVoice}`,
    `Mood: ${context.moodKeywords.join(", ")}`,
    `Image style: ${context.imageStyle}`,
    `Layout: ${context.layoutPrinciples.join(" / ")}`,
    `Components: ${context.componentPrinciples.join(" / ")}`,
  ].join("\n");
}

function splitStyleKeywords(style: string) {
  return style
    .split(/[,，、/|]+|\s{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueCompact(items: Array<string | undefined | null>) {
  return Array.from(new Set(items.filter((item): item is string => Boolean(item))));
}

function mergeBrandKit(
  ctx: DesignContext,
  brandKit?: BrandKit
): DesignContext {
  if (!brandKit) return ctx;

  return {
    ...ctx,
    colorTokens: brandKit.colors.length > 0
      ? brandKit.colors.map((c) => ({
          name: c.name,
          value: c.value,
          usage: c.usage ?? "",
        }))
      : ctx.colorTokens,
    typography: {
      heading: brandKit.typography.heading,
      body: brandKit.typography.body,
      notes: brandKit.typography.notes ?? ctx.typography.notes,
    },
    brandVoice: brandKit.brandVoice ?? ctx.brandVoice,
    doList: [...(brandKit.doList ?? []), ...ctx.doList],
    avoidList: [...(brandKit.avoidList ?? []), ...ctx.avoidList],
  };
}
