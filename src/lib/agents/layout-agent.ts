import { nanoid } from "nanoid";
import type { Agent, AgentContext } from "./types";
import type { ProductBrief } from "@/lib/project/schema";
import type { CanvasNode, CanvasPage } from "@/lib/canvas/schema";
import type { ImageProvider } from "@/lib/providers/image/types";
import { stripJsonFence } from "@/lib/providers/llm/openai-compatible";
import { isMockLlmText } from "@/lib/providers/llm/utils";
import {
  LlmLayoutOutputSchema,
  type LlmCanvasPage,
} from "@/lib/canvas/llm-schema";
import {
  materializePage,
  slugForPage,
  IMAGE_PLACEHOLDER_SRC,
} from "@/lib/canvas/materialize";
import { buildLayoutSystemPrompt } from "@/lib/skills/prompt-stack";
import { readDesignContextFromScratch } from "@/lib/project/design-context";

export const LayoutAgent: Agent<{ brief: ProductBrief }, CanvasPage[]> = {
  name: "layout-agent",
  async run({ brief }, ctx) {
    const fromLlm = await tryLlmLayout(brief, ctx).catch(() => null);
    if (fromLlm) {
      const pages = await materializePages(fromLlm, brief, ctx.providers.image);
      if (isUsableLayout(pages, brief, ctx)) return pages;
    }
    return buildFallbackPages(brief, ctx);
  },
};

async function buildFallbackPages(
  brief: ProductBrief,
  ctx: AgentContext
): Promise<CanvasPage[]> {
  const artifact = ctx.skill?.manifest.output.artifact ?? "canvas-pages";

  switch (artifact) {
    case "xhs-cards":
      return buildXhsCardPages(brief);
    case "landing-page":
      return [buildLandingPage(brief)];
    case "canvas-pages":
    default:
      return buildProductPages(brief);
  }
}

async function tryLlmLayout(
  brief: ProductBrief,
  ctx: AgentContext
): Promise<LlmCanvasPage[] | null> {
  const system = buildLayoutSystemPrompt({
    skill: ctx.skill,
    designSystem: ctx.designSystem,
    brief,
    designContext: readDesignContextFromScratch(ctx.scratch),
    extra: {
      architecture: ctx.scratch.architecture,
      designDirection: ctx.scratch.designDirectionSummary,
    },
  });
  const sizeHint = ctx.skill?.manifest.output.defaultPageSize;
  const pageCount = ctx.skill?.manifest.output.pageCountHint ?? 3;
  const out = await ctx.providers.llm.generateText({
    system,
    prompt: [
      `Output ${pageCount} page(s) as JSON only.`,
      sizeHint
        ? `Use page size ${sizeHint.width}x${sizeHint.height} unless the brief explicitly requires a different platform.`
        : "Use app=390x844, web/dashboard=1440x900, landing=1440x3200.",
      "Every node must stay inside the page bounds. Do not create overlapping hero images over text.",
    ].join("\n"),
    schema: { type: "object" },
  });

  if (isMockLlmText(out.text)) return null;

  let json: unknown;
  try {
    json = JSON.parse(stripJsonFence(out.text));
  } catch {
    return null;
  }
  const parsed = LlmLayoutOutputSchema.safeParse(json);
  return parsed.success ? parsed.data.pages : null;
}

async function materializePages(
  llmPages: LlmCanvasPage[],
  brief: ProductBrief,
  image: ImageProvider
): Promise<CanvasPage[]> {
  const result: CanvasPage[] = [];
  for (let i = 0; i < llmPages.length; i++) {
    const fallbackId =
      i === 0 ? "home" : slugForPage(llmPages[i].name) || `page-${i}`;
    const page = await materializePage(llmPages[i], brief, image, {
      source: "layout-agent-llm",
      fallbackId,
      skipImageGeneration: true,
    });
    if (page) result.push(page);
  }
  return result;
}

function isUsableLayout(
  pages: CanvasPage[],
  brief: ProductBrief,
  ctx: AgentContext
): boolean {
  if (pages.length === 0) return false;

  const artifact = ctx.skill?.manifest.output.artifact ?? "canvas-pages";
  const expectedSize = ctx.skill?.manifest.output.defaultPageSize;

  if (artifact === "landing-page") {
    const page = pages[0];
    if (pages.length !== 1) return false;
    if (page.width < 1200 || page.height < 1600) return false;
  }

  if (
    artifact === "canvas-pages" &&
    (brief.platform === "web" || brief.platform === "landing")
  ) {
    if (pages.some((page) => page.width < 960)) return false;
  }

  if (expectedSize) {
    const tooSmall = pages.some(
      (page) =>
        page.width < expectedSize.width * 0.8 ||
        page.height < expectedSize.height * 0.5
    );
    if (tooSmall) return false;
  }

  return pages.every((page) => {
    if (page.nodes.length === 0) return false;
    return page.nodes.every(
      (node) =>
        node.width > 0 &&
        node.height > 0 &&
        node.x >= 0 &&
        node.y >= 0 &&
        node.x + node.width <= page.width &&
        node.y + node.height <= page.height
    );
  });
}

const PRODUCT_W = 1440;
const PRODUCT_H = 900;
const LANDING_W = 1440;
const LANDING_H = 3200;
const XHS_W = 1080;
const XHS_H = 1440;

const colors = {
  bg: "#FFFFFF",
  panel: "#FFFFFF",
  panelSoft: "#F4F7FA",
  text: "#09090B",
  muted: "#7A8B99",
  border: "#E1E8ED",
  primary: "#6366f1",
  primaryFg: "#ffffff",
  sidebar: "#111115",
  blue: "#3B82F6",
  green: "#10B981",
  amber: "#F59E0B",
  rose: "#EF4444",
};

function features(brief: ProductBrief): string[] {
  const cleaned = brief.coreFeatures
    .map((item) => item.trim())
    .filter(Boolean);
  return cleaned.length > 0
    ? cleaned.slice(0, 6)
    : ["核心指标总览", "用户分群管理", "自动化报告", "权限与审计", "团队协作", "数据导出"];
}

/** Fallback 模板：image 仅占位，由 generate_images 统一生图。 */
function pendingImageNode(
  x: number,
  y: number,
  width: number,
  height: number,
  imagePrompt: string
): CanvasNode {
  const prompt = imagePrompt;
  return {
    id: nanoid(8),
    type: "image",
    x,
    y,
    width,
    height,
    src: IMAGE_PLACEHOLDER_SRC,
    alt: prompt,
    generation: { prompt, model: "pending" },
    source: "layout-agent-fallback",
  };
}

function buildProductPages(brief: ProductBrief): CanvasPage[] {
  return [
    buildDashboardPage(brief),
    buildUsersPage(brief),
    buildAnalyticsPage(brief),
    buildSettingsPage(brief),
  ];
}

function buildDashboardPage(brief: ProductBrief): CanvasPage {
  const heroPrompt = `${brief.visualStyle} abstract analytics dashboard illustration, clean SaaS product visual`;
  const fs = features(brief);

  const nodes: CanvasNode[] = [
    // 普鲁士深蓝大侧栏
    frame(0, 0, 240, PRODUCT_H, colors.sidebar),
    text(32, 40, 180, 28, brief.productName, 18, 800, "#FFFFFF"),
    text(32, 72, 180, 16, "ENTERPRISE PROT V0.5", 9, 700, colors.primary),
    ...["概览", "用户分群", "高级分析", "空间设置"].map((item, i) =>
      text(32, 130 + i * 48, 170, 24, item, 14, i === 0 ? 800 : 500, i === 0 ? "#FFFFFF" : "#94A3B8")
    ),
    text(32, 830, 180, 16, "EST_GAZETTE_2026", 8, 700, "#5E7E9E"),

    // 顶栏 1px 细线
    frame(240, 0, 1200, PRODUCT_H, colors.bg),
    frame(240, 100, 1200, 1, colors.border),

    text(288, 36, 520, 36, "Dashboard overview", 28, 800, colors.text),
    text(288, 72, 720, 20, brief.positioning, 14, 400, colors.muted),
    button(1180, 36, 160, 40, "导出 Handoff", colors.primary),

    // 四张核心高保真指标卡
    card(288, 136, 240, 104, "MRR", "$42,820", colors.panel),
    card(552, 136, 240, 104, "活跃用户 / ACTIVES", "18,420", colors.panel),
    card(816, 136, 240, 104, "付费转化率 / CONVERSION", "12.6%", colors.panel),
    card(1080, 136, 260, 104, "核心留存 / RETENTION", "86.4%", colors.panel),

    // 指标细节微标
    text(312, 208, 120, 16, "+14.2% 本月增长", 10, 700, colors.green),
    text(576, 208, 120, 16, "+8.6% 环比上升", 10, 700, colors.green),
    text(840, 208, 120, 16, "HEALTHY · 稳定", 10, 700, colors.blue),
    text(1104, 208, 120, 16, "EXCELLENT · 优秀", 10, 700, colors.blue),

    // 大图表卡
    card(288, 264, 620, 340, "关键业务数据趋势 / REVENUE OVERVIEW", "过去 12 个月收入与获客漏斗复合图表。", colors.panel),
    // 柱状图细节手绘模拟
    frame(332, 490, 80, 60, colors.primary, 2),
    frame(440, 430, 80, 120, colors.blue, 2),
    frame(548, 380, 80, 170, colors.primary, 2),
    frame(656, 330, 80, 220, colors.blue, 2),

    pendingImageNode(940, 264, 400, 230, heroPrompt),
    card(940, 514, 400, 90, fs[0] ?? "核心执行入口", `为 ${brief.targetUser} 提供高度直观的业务驱动流程。`, colors.panel),

    // 下方三张高保真快捷入口卡片
    card(288, 628, 330, 110, fs[1] ?? "高保真用户分群", "按来源、生命周期、活跃度智能归类管理。", colors.panel),
    card(642, 628, 330, 110, fs[2] ?? "高级决策与安全分析", "多维度指标对比与数据隔离沙箱。", colors.panel),
    card(996, 628, 344, 110, fs[3] ?? "自动化触发流", "定义触发规则并自动将设计 Token 注入 Handoff。", colors.panel),

    // 标尺参数微标，极具设计独特性
    text(288, 770, 1050, 20, `VAD_PROTOTYPE_DASHBOARD · RUNNING_LOCAL_DATABASE · COMPATIBLE_WITH_CURSOR_HANDOFF`, 11, 700, colors.muted),
  ];

  return page("home", "Dashboard 概览", PRODUCT_W, PRODUCT_H, nodes);
}

function buildUsersPage(brief: ProductBrief): CanvasPage {
  const rows = [
    { name: "Acme Inc.", status: "健康", owner: "Lina", time: "1 天前" },
    { name: "Northstar Labs", status: "活跃", owner: "Chen", time: "2 天前" },
    { name: "Bright Data", status: "待激活", owner: "Mia", time: "3 天前" },
    { name: "Orbit Studio", status: "风险", owner: "Alex", time: "5 天前" },
    { name: "Cloud Nine", status: "健康", owner: "Nora", time: "6 天前" },
    { name: "Apex Global", status: "健康", owner: "Sam", time: "8 天前" },
  ];

  const nodes: CanvasNode[] = [
    // 普鲁士深蓝大侧栏
    frame(0, 0, 240, PRODUCT_H, colors.sidebar),
    text(32, 40, 180, 28, brief.productName, 18, 800, "#FFFFFF"),
    text(32, 72, 180, 16, "ENTERPRISE PROT V0.5", 9, 700, colors.primary),
    ...["概览", "用户分群", "高级分析", "空间设置"].map((item, i) =>
      text(32, 130 + i * 48, 170, 24, item, 14, i === 1 ? 800 : 500, i === 1 ? "#FFFFFF" : "#94A3B8")
    ),

    // 顶栏 1px 细线
    frame(240, 0, 1200, PRODUCT_H, colors.bg),
    frame(240, 100, 1200, 1, colors.border),

    text(288, 36, 520, 36, "团队与用户分群 / CUSTOMER LIFE CYCLE", 28, 800, colors.text),
    text(288, 72, 720, 20, `精细化管理 ${brief.productName} 团队权限、组织架构以及生命周期漏斗。`, 14, 400, colors.muted),
    button(1180, 36, 160, 40, "新增用户", colors.primary),

    // 用户管理专属四卡片
    card(288, 136, 240, 96, "总活跃用户数", "18,420 / ACTIVE", colors.panel),
    card(552, 136, 240, 96, "核心企业客户", "426 / ACCOUNTS", colors.panel),
    card(816, 136, 240, 96, "待处理邀请", "32 / PENDING", colors.panel),
    card(1080, 136, 260, 96, "空间平均健康度", "92% / HEALTHY", colors.panel),

    // 表格面板大容器
    frame(288, 256, 1052, 460, colors.panel, 2),
    frame(288, 256, 1052, 1, colors.border),
    frame(288, 316, 1052, 1, colors.border),

    text(320, 276, 240, 24, "企业 / 组织客户名称", 12, 700, colors.muted),
    text(600, 276, 140, 24, "生命周期状态", 12, 700, colors.muted),
    text(780, 276, 140, 24, "专属负责人", 12, 700, colors.muted),
    text(960, 276, 240, 24, "最近行为更新时间", 12, 700, colors.muted),

    ...rows.flatMap((r, i) => {
      const y = 336 + i * 58;
      const statusColor = r.status === "风险" ? colors.rose : r.status === "待激活" ? colors.amber : colors.green;
      return [
        text(320, y + 6, 260, 24, r.name, 15, 700, colors.text),
        text(600, y + 6, 120, 24, r.status, 13, 700, statusColor),
        text(780, y + 6, 140, 24, r.owner, 14, 500, colors.text),
        text(960, y + 6, 240, 24, r.time, 13, 400, colors.muted),
        // 分割线
        frame(288, y + 42, 1052, 1, colors.border),
      ];
    }),

    // 操作指南
    card(288, 736, 1052, 64, "商业下一步操作指南", `将当前处于 [风险] 状态的客户自动同步给 ${brief.targetUser} 进行专门的销售跟进，防止流失。`, colors.panel),
  ];
  return page("detail", "用户管理", PRODUCT_W, PRODUCT_H, nodes);
}

function buildAnalyticsPage(brief: ProductBrief): CanvasPage {
  const nodes: CanvasNode[] = [
    // 普鲁士深蓝大侧栏
    frame(0, 0, 240, PRODUCT_H, colors.sidebar),
    text(32, 40, 180, 28, brief.productName, 18, 800, "#FFFFFF"),
    text(32, 72, 180, 16, "ENTERPRISE PROT V0.5", 9, 700, colors.primary),
    ...["概览", "用户分群", "高级分析", "空间设置"].map((item, i) =>
      text(32, 130 + i * 48, 170, 24, item, 14, i === 2 ? 800 : 500, i === 2 ? "#FFFFFF" : "#94A3B8")
    ),

    // 顶栏 1px 细线
    frame(240, 0, 1200, PRODUCT_H, colors.bg),
    frame(240, 100, 1200, 1, colors.border),

    text(288, 36, 520, 36, "多维度高级分析 / INSIGHTS", 28, 800, colors.text),
    text(288, 72, 720, 20, "追踪业务转化漏斗、渠道表现与核心功能使用趋势。", 14, 400, colors.muted),
    button(1180, 36, 160, 40, "导出报表", colors.blue),

    // 高保真决策三卡片
    card(288, 136, 330, 180, "SaaS 核心漏斗转化 / FUNNEL", "1. 发现页 (100%)\n2. 想法输入 (42%)\n3. 原型生成 (26.4%)\n4. Cursor 导出 (14.2%)", colors.panel),
    card(642, 136, 330, 180, "渠道与留存概览 / CHANNELS", "● 自然搜索 +18%\n● 邀请注册 +12%\n● 7 日留存 34%\n● 付费转化 6.2%", colors.panel),
    card(996, 136, 344, 180, "本周重点指标 / HIGHLIGHTS", "1. 新用户峰值出现在周三\n2. 移动端占比升至 61%\n3. Handoff 导出次数 +24%", colors.panel),

    // 数据桑基图手绘模拟大面板
    card(288, 340, 680, 370, "多渠道用户流量流转路径 / USER FLOW TRAFFIC", "手绘模拟的高级多渠道用户决策流转状态。", colors.panel),
    frame(320, 430, 180, 40, colors.primary, 2),
    frame(320, 520, 180, 40, colors.blue, 2),
    frame(320, 610, 180, 40, colors.panelSoft, 2),
    // 连接虚线流转模拟
    frame(580, 430, 120, 2, colors.blue, 0),
    frame(580, 520, 120, 2, colors.primary, 0),
    frame(580, 610, 120, 2, colors.border, 0),
    frame(740, 400, 180, 250, colors.panelSoft, 2),

    card(992, 340, 348, 370, "数据隔离与安全 / SECURITY", "当前项目在本地 IndexedDB 持久化存储。\n\n● 加密级别: AES-256-GCM\n● 数据物理隔离状态: 完备\n● 云同步密钥配置: 待添加", colors.panel),
    button(1024, 620, 280, 44, "配置数据安全策略", colors.primary),

    text(288, 760, 1050, 20, "SYNC_OK · LAST_EXPORT 2H AGO · ALL_SYSTEMS_OPERATIONAL", 11, 700, colors.blue),
  ];
  return page("analytics", "高级分析", PRODUCT_W, PRODUCT_H, nodes);
}

function buildSettingsPage(brief: ProductBrief): CanvasPage {
  const items = ["账号与团队管理", "通知与告警阈值", "高保真品牌外观", "多租户数据权限", "第三方服务集成", "账单与企业订阅计划"];
  const nodes: CanvasNode[] = [
    // 普鲁士深蓝大侧栏
    frame(0, 0, 240, PRODUCT_H, colors.sidebar),
    text(32, 40, 180, 28, brief.productName, 18, 800, "#FFFFFF"),
    text(32, 72, 180, 16, "ENTERPRISE PRO T V0.5", 9, 700, colors.primary),
    ...["概览", "用户分群", "高级分析", "空间设置"].map((item, i) =>
      text(32, 130 + i * 48, 170, 24, item, 14, i === 3 ? 800 : 500, i === 3 ? "#FFFFFF" : "#94A3B8")
    ),

    // 顶栏 1px 细线
    frame(240, 0, 1200, PRODUCT_H, colors.bg),
    frame(240, 100, 1200, 1, colors.border),

    text(288, 36, 520, 36, "设置中心 / WORKSPACE CONFIG", 28, 800, colors.text),
    text(288, 72, 760, 20, `配置 ${brief.productName} 的企业级账号、API 数据通道、Cursor 自动化配置项与外观视觉规范。`, 14, 400, colors.muted),

    ...items.map((item, i) =>
      card(
        288 + (i % 3) * 356,
        136 + Math.floor(i / 3) * 144,
        324,
        112,
        item,
        `配置企业级团队协作、API 数据通道、${item} 相关的多租户核心设置项。`,
        colors.panel
      )
    ),

    // Cursor 联动与 Handoff 配置卡片
    card(288, 444, 760, 180, "Cursor / Claude Code 双向联动交付沙盒 / AUTOMATION SANDBOX", "本工作空间已配置自动一键打 Handoff H4 开发资产包。该包内嵌全量设计 Token、组件一像素坐标 JSON、及针对多模态 Agent 深度训练的 Prompt 语料，确保 Cursor 在编译代码时能 100% 还原该设计规范，没有任何视觉 Regression。", colors.panel),
    button(288, 650, 220, 44, "测试与 Cursor 连接状态", colors.blue),
    button(530, 650, 220, 44, "生成 Handoff 配置文件", colors.primary),

    // 状态统计
    card(1072, 444, 268, 250, "工作空间状态 / HEALTH", "● 本地库数据已同步\n● 待处理任务: 0\n● 联动 Cursor 沙箱: OK\n● 当前版本: PRO_0.5.0\n● 平台运行时间: 100%", colors.panel),

    text(288, 828, 1052, 24, `${brief.productName} · enterprise prototype gazette v0.5.0 · running securely`, 13, 450, colors.muted, "center"),
  ];
  return page("settings", "设置", PRODUCT_W, PRODUCT_H, nodes);
}

function buildLandingPage(brief: ProductBrief): CanvasPage {
  const fs = features(brief);
  const heroPrompt = `${brief.visualStyle} SaaS analytics product interface mockup, bright clean web dashboard`;

  const nodes: CanvasNode[] = [
    frame(0, 0, LANDING_W, LANDING_H, colors.bg),
    text(96, 40, 260, 28, brief.productName, 20, 800, colors.text),
    text(1010, 42, 88, 24, "Features", 15, 600, colors.muted),
    text(1130, 42, 72, 24, "Pricing", 15, 600, colors.muted),
    button(1228, 32, 116, 40, "免费开始", colors.primary),
    text(96, 168, 760, 94, brief.productName, 76, 850, colors.text),
    text(96, 292, 660, 72, brief.positioning, 24, 400, colors.muted),
    button(96, 408, 170, 52, "免费开始", colors.blue),
    button(284, 408, 170, 52, "预约演示", colors.panelSoft, colors.text),
    text(96, 500, 520, 26, "Trusted by product, growth, and data teams", 16, 600, colors.muted),
    pendingImageNode(760, 144, 584, 390, heroPrompt),
    text(96, 720, 620, 52, "把复杂业务数据变成清晰行动", 42, 800, colors.text),
    text(96, 788, 720, 34, "围绕核心任务组织页面、指标、用户和自动化流程。", 20, 400, colors.muted),
    ...fs.slice(0, 3).map((item, i) =>
      card(96 + i * 420, 882, 360, 172, item, `为 ${brief.targetUser} 提供稳定、可理解的 ${item} 能力。`, colors.panel)
    ),
    frame(96, 1240, 1248, 520, colors.sidebar, 2),
    text(148, 1308, 520, 52, "产品工作台预览", 42, 800, "#FFFFFF"),
    text(148, 1376, 520, 68, "从总览、用户管理到设置中心，所有页面都能导出为结构化设计上下文。", 20, 400, "#CBD5E1"),
    frame(720, 1300, 520, 300, colors.panel, 2),
    frame(760, 1352, 180, 32, colors.panelSoft, 2),
    frame(760, 1416, 420, 26, colors.panelSoft, 2),
    frame(760, 1480, 360, 26, colors.panelSoft, 2),
    frame(760, 1544, 300, 26, colors.panelSoft, 2),
    text(96, 1948, 620, 52, "透明定价，随团队成长", 42, 800, colors.text),
    ...[
      ["Starter", "$0", "适合早期验证"],
      ["Pro", "$19", "适合增长团队"],
      ["Enterprise", "Custom", "适合组织级落地"],
    ].map(([name, price, desc], i) =>
      card(96 + i * 420, 2040, 360, 360, name, `${price} / ${desc}`, i === 1 ? colors.panelSoft : colors.panel)
    ),
    button(184, 2292, 184, 48, "选择 Starter", colors.panelSoft, colors.text),
    button(604, 2292, 184, 48, "开始 Pro", colors.blue),
    button(1024, 2292, 184, 48, "联系销售", colors.primary),
    frame(0, 2760, LANDING_W, 440, colors.sidebar),
    text(96, 2860, 440, 44, brief.productName, 34, 850, "#FFFFFF"),
    text(96, 2928, 520, 56, "从产品想法到可交付开发上下文的 AI 设计工作台。", 20, 400, "#CBD5E1"),
    text(850, 2864, 180, 28, "Product", 16, 800, "#FFFFFF"),
    text(850, 2912, 180, 28, "Features", 15, 500, "#CBD5E1"),
    text(850, 2954, 180, 28, "Pricing", 15, 500, "#CBD5E1"),
    text(1080, 2864, 180, 28, "Company", 16, 800, "#FFFFFF"),
    text(1080, 2912, 180, 28, "Docs", 15, 500, "#CBD5E1"),
    text(1080, 2954, 180, 28, "Support", 15, 500, "#CBD5E1"),
    text(96, 3120, 520, 24, `© ${new Date().getFullYear()} ${brief.productName}. All rights reserved.`, 14, 400, "#94A3B8"),
  ];

  return page("landing", "Landing Page", LANDING_W, LANDING_H, nodes, colors.bg);
}

function buildXhsCardPages(brief: ProductBrief): CanvasPage[] {
  const prompt = `${brief.visualStyle} social media cover visual for ${brief.productName}`;
  const cover: CanvasPage = page(
    "xhs-cover",
    "封面",
    XHS_W,
    XHS_H,
    [
      pendingImageNode(0, 0, XHS_W, 720, prompt),
      text(60, 800, 960, 72, brief.productName, 56, 850),
      text(60, 900, 920, 80, brief.positioning, 30, 500, colors.muted),
      button(60, 1300, 960, 80, "了解更多", colors.blue),
    ],
    "#FFFFFF"
  );

  const slides = features(brief)
    .slice(0, 4)
    .map((item, i) =>
      page(
        `xhs-slide-${i + 1}`,
        `图 ${i + 1}`,
        XHS_W,
        XHS_H,
        [
          text(60, 120, 920, 72, item, 52, 850),
          card(60, 260, 960, 620, item, `${brief.productName} 的核心亮点，为 ${brief.targetUser} 打造。`, "#FFFFFF"),
          text(60, 1340, 960, 36, `@${brief.productName} · ${i + 1}/4`, 22, 500, colors.muted, "center"),
        ],
        i % 2 === 0 ? "#FFFFFF" : colors.panelSoft
      )
    );

  return [cover, ...slides];
}

function page(
  id: string,
  name: string,
  width: number,
  height: number,
  nodes: CanvasNode[],
  background = colors.bg
): CanvasPage {
  return { id, name, width, height, background, nodes };
}

function text(
  x: number,
  y: number,
  width: number,
  height: number,
  content: string,
  fontSize: number,
  fontWeight = 400,
  color = colors.text,
  align?: "left" | "center" | "right"
): CanvasNode {
  return {
    id: nanoid(8),
    type: "text",
    x,
    y,
    width,
    height,
    content,
    fontSize,
    fontWeight,
    color,
    align,
    source: "layout-agent",
  };
}

function frame(
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  radius = 0
): CanvasNode {
  return {
    id: nanoid(8),
    type: "frame",
    x,
    y,
    width,
    height,
    fill,
    radius,
    source: "layout-agent",
  };
}

function button(
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  fill: string,
  color = colors.primaryFg
): CanvasNode {
  return {
    id: nanoid(8),
    type: "button",
    x,
    y,
    width,
    height,
    label,
    fill,
    color,
    radius: 2,
    source: "layout-agent",
  };
}

function card(
  x: number,
  y: number,
  width: number,
  height: number,
  title: string,
  body: string,
  fill: string
): CanvasNode {
  return {
    id: nanoid(8),
    type: "card",
    x,
    y,
    width,
    height,
    title,
    body,
    fill,
    radius: 2,
    source: "layout-agent",
  };
}
