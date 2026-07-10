import type {
  DesignContext,
  DesignDirection,
  ProductBrief,
  ProjectFile,
} from "./schema";

const DEFAULT_COLORS = [
  { name: "primary", value: "#4F46FF", usage: "主要按钮、选中状态、关键路径强调" },
  { name: "surface", value: "#FFFFFF", usage: "页面背景、卡片与编辑器面板" },
  { name: "ink", value: "#111827", usage: "标题、正文与高优先级信息" },
  { name: "muted", value: "#64748B", usage: "说明文字、辅助标签与低优先级信息" },
];

export function deriveDesignContext(project: ProjectFile): DesignContext | null {
  if (project.designContext) return project.designContext;
  if (!project.brief) return null;
  return buildDesignContext({
    brief: project.brief,
    designDirection: project.designDirection,
    designSystemId: project.designSystemId,
  });
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
  designDirection,
  designSystemId,
  now = new Date().toISOString(),
}: {
  brief: ProductBrief;
  designDirection?: DesignDirection | null;
  designSystemId?: string;
  now?: string;
}): DesignContext {
  const moodKeywords = uniqueCompact([
    ...(designDirection?.moodKeywords ?? []),
    ...splitStyleKeywords(brief.visualStyle),
    brief.platform,
  ]).slice(0, 8);

  return {
    version: 1,
    source: "derived",
    brandVoice: `${brief.productName} 面向 ${brief.targetUser}，语气应清晰、可信、具体，突出「${brief.positioning}」。`,
    moodKeywords,
    colorTokens: DEFAULT_COLORS,
    typography: {
      heading: "清晰高对比标题，优先使用 600-800 字重形成页面层级。",
      body: "正文保持短句、具体、可扫描，避免占位文案。",
      notes:
        designDirection?.typographyNotes ??
        "标题、说明、按钮文案应有明确字号层级。",
    },
    layoutPrinciples: [
      designDirection?.layoutNotes,
      "每页只保留一个主视觉重心。",
      "首屏先解释产品价值，再展示关键操作。",
      "卡片、按钮、图像资产之间保留稳定间距，避免拥挤。",
    ].filter(Boolean) as string[],
    componentPrinciples: [
      "按钮必须表达清晰动作，不使用泛化占位词。",
      "列表和卡片要服务于用户决策，而不是装饰堆叠。",
      "状态、评分、进度等数据要有明确标签和辅助解释。",
    ],
    imageStyle: designDirection
      ? `${designDirection.summary}；图像需延续 ${brief.visualStyle}`
      : brief.visualStyle,
    doList: [
      `持续贴合目标用户：${brief.targetUser}`,
      `优先呈现核心功能：${brief.coreFeatures.slice(0, 3).join("、")}`,
      designSystemId ? `遵循设计系统：${designSystemId}` : "保持同项目页面视觉一致",
    ],
    avoidList: [
      "避免 Lorem ipsum、卡片标题 A 等占位内容。",
      "避免突然切换色彩、字体、插画风格。",
      "避免生成不可编辑的整屏图片来承载真实 UI 文案。",
    ],
    updatedAt: now,
  };
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
