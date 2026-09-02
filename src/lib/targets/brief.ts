/**
 * 按视觉目标裁剪 Brief 字段。
 * 共用 ProductBrief 信封，slots 才是本目标真正要问/要存的内容。
 */

import type { ProductBrief } from "@/lib/project/schema";
import {
  getTargetRecipe,
  type RecipeQuestion,
  type TargetId,
} from "./catalog";
import { parseTargetId } from "./resolve";

export type BriefDisplayField = {
  id: string;
  label: string;
  value: string;
};

export function inferBriefSlots(
  idea: string,
  targetId: TargetId
): Record<string, string> {
  const inferred = inferSlotsFromIdea(idea, targetId);
  const locked = parseDiscoverySlots(idea, targetId);
  return compactSlots({ ...inferred, ...locked });
}

export function heuristicBriefForTarget(
  idea: string,
  targetId: TargetId
): ProductBrief {
  const slots = inferBriefSlots(idea, targetId);
  const recipe = getTargetRecipe(targetId);
  const productName = inferProductName(idea, targetId);
  const visualStyle = visualStyleFromSlots(targetId, slots, idea);
  const outputTargets =
    recipe.handoff === "code-kickoff"
      ? (["cursor", "claude-code", "markdown"] as ProductBrief["outputTargets"])
      : (["markdown"] as ProductBrief["outputTargets"]);

  if (targetId === "ui-visual") {
    return {
      productName,
      positioning: idea.replace(/\[需求确认回答\][\s\S]*/g, "").trim() || idea.trim(),
      targetUser: inferUiAudience(idea, slots),
      scenarios: [
        "用户首次打开产品并完成引导",
        "核心任务的快速操作",
        "查看历史与个人设置",
      ],
      coreFeatures: extractUiFeatures(idea),
      platform: pickPlatform(idea),
      visualStyle,
      outputTargets,
      slots,
    };
  }

  if (targetId === "game-art") {
    const kind = slotLabel("game-art", "assetKind", slots.assetKind);
    const render = slotLabel("game-art", "render", slots.render);
    return {
      productName,
      positioning: slots.world || idea.trim(),
      targetUser: "玩家与美术",
      scenarios: [
        kind ? `${kind}概念图` : "角色 / 场景概念图",
        "同世界观配套资产",
        "美术包交付",
      ],
      coreFeatures: compact([kind, render, slots.world]).slice(0, 4),
      platform: "other",
      visualStyle,
      outputTargets,
      slots,
    };
  }

  if (targetId === "promo-kv") {
    const hook = slots.hook || idea.trim();
    return {
      productName,
      positioning: hook,
      targetUser: "投放受众",
      scenarios: ["主 KV 投放", "多尺寸变体", "必须上的字落在安全区"],
      coreFeatures: compact([
        slotLabel("promo-kv", "channel", slots.channel),
        slots.hook,
        slots.mustType,
      ]).slice(0, 4),
      platform: "other",
      visualStyle,
      outputTargets,
      slots,
    };
  }

  if (targetId === "social-cover") {
    return {
      productName,
      positioning: slots.hook || idea.trim(),
      targetUser: "社媒浏览者",
      scenarios: ["竖版封面", "少字大焦点", "平台角标规范"],
      coreFeatures: compact([
        slotLabel("social-cover", "platform", slots.platform),
        slots.hook,
        slotLabel("social-cover", "face", slots.face),
      ]).slice(0, 4),
      platform: "other",
      visualStyle,
      outputTargets,
      slots,
    };
  }

  if (targetId === "product-shot") {
    return {
      productName,
      positioning: slots.refNote || idea.trim(),
      targetUser: "电商买家",
      scenarios: ["主图", "卖点图", "场景图"],
      coreFeatures: compact([
        slotLabel("product-shot", "shot", slots.shot),
        "外形以参考为准",
        slots.refNote,
      ]).slice(0, 4),
      platform: "other",
      visualStyle,
      outputTargets,
      slots,
    };
  }

  const words = (slots.words ?? "")
    .split(/[\s,，、]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return {
    productName,
    positioning: compact([slots.category, slots.words]).join(" · ") || idea.trim(),
    targetUser: "选方向的人",
    scenarios: ["并排试方向", "点选后锁定到正式目标"],
    coreFeatures: words.length > 0 ? words.slice(0, 4) : compact([slots.category]),
    platform: "other",
    visualStyle,
    outputTargets,
    slots,
  };
}

export function briefDisplayFields(
  brief: ProductBrief,
  targetId: TargetId
): BriefDisplayField[] {
  const recipe = getTargetRecipe(targetId);
  const fromSlots = recipe.discovery
    .map((question) => ({
      id: question.id,
      label: question.label,
      value: slotDisplayValue(question, brief.slots?.[question.id] ?? ""),
    }))
    .filter((field) => field.value);

  if (fromSlots.length > 0) return fromSlots;

  return [
    { id: "audience", label: "给谁用", value: brief.targetUser },
    { id: "positioning", label: "定位", value: brief.positioning },
    {
      id: "features",
      label: "核心功能",
      value: brief.coreFeatures.slice(0, 3).join(" · "),
    },
  ].filter((field) => field.value);
}

export function briefEmptyCopy(targetId: TargetId): {
  title: string;
  hint: string;
} {
  switch (targetId) {
    case "game-art":
      return {
        title: "还没有原画说明",
        hint: "说资产种类、渲染语言和世界观，Agent 会按概念图补字段。",
      };
    case "promo-kv":
      return {
        title: "还没有主视觉说明",
        hint: "说渠道、一句卖点和必须上的字。",
      };
    case "social-cover":
      return {
        title: "还没有封面说明",
        hint: "说平台、钩子，以及要不要人脸或产品。",
      };
    case "product-shot":
      return {
        title: "还没有产品图说明",
        hint: "先标明拍法和参考图；没有实拍不要脑补外形。",
      };
    case "style-board":
      return {
        title: "还没有风格说明",
        hint: "品类加三个词即可，不必写完整产品 brief。",
      };
    default:
      return {
        title: "还没有产品说明",
        hint: "在右侧描述产品，Agent 会补上用户、定位和风格。",
      };
  }
}

export function buildBriefOutputShape(targetId: TargetId): string {
  const recipe = getTargetRecipe(parseTargetId(targetId));
  const slotShape = Object.fromEntries(
    recipe.discovery.map((question) => [question.id, slotHint(question)])
  );
  const platform =
    recipe.id === "ui-visual"
      ? "app|web|miniapp|extension|landing|other"
      : "other";
  const outputs =
    recipe.handoff === "code-kickoff"
      ? '["cursor","claude-code","markdown"]'
      : '["markdown"]';
  const ban =
    recipe.id === "ui-visual"
      ? "coreFeatures 给 3-5 个真实功能，scenarios 给 3 个。"
      : recipe.id === "style-board"
        ? "只填 slots.category 和 slots.words，不要编造完整产品功能或平台。"
        : "不要写成 SaaS 产品 brief，不要问落地页还是 App。slots 必须填本目标字段。";

  return `# Brief 输出 JSON 结构
目标是「${recipe.label}」。${recipe.goalSentence}
\`\`\`json
{
  "productName": "<≤12 字中文>",
  "positioning": "...",
  "targetUser": "...",
  "scenarios": ["..."],
  "coreFeatures": ["..."],
  "platform": "${platform}",
  "visualStyle": "<一句英文风格描述>",
  "outputTargets": ${outputs},
  "slots": ${JSON.stringify(slotShape)}
}
\`\`\`
严格输出 JSON，不要解释。${ban}`;
}

export function mergeBriefWithTargetSlots(
  brief: ProductBrief,
  idea: string,
  targetId: TargetId
): ProductBrief {
  const heuristic = heuristicBriefForTarget(idea, targetId);
  const slots = compactSlots({ ...heuristic.slots, ...brief.slots });
  const genericFeatures = brief.coreFeatures.some((item) =>
    /核心功能\s*[ABC]/i.test(item)
  );
  return {
    ...brief,
    slots,
    platform: targetId === "ui-visual" ? brief.platform : "other",
    outputTargets:
      targetId === "ui-visual" ? brief.outputTargets : ["markdown"],
    coreFeatures: genericFeatures ? heuristic.coreFeatures : brief.coreFeatures,
  };
}

function inferSlotsFromIdea(
  idea: string,
  targetId: TargetId
): Record<string, string> {
  const text = stripDiscoveryBlock(idea);
  const slots: Record<string, string> = {};

  if (targetId === "ui-visual") {
    const productType = inferProductType(text);
    if (productType) slots.productType = productType;
    const tones = inferToneValues(text);
    if (tones) slots.tone = tones;
    if (/品牌规范|品牌手册/.test(text)) slots.brand = "brand_spec";
    else if (/参考图|网站/.test(text)) slots.brand = "reference_match";
    else slots.brand = "pick_direction";
  }

  if (targetId === "game-art") {
    if (/立绘|角色/i.test(text)) slots.assetKind = "portrait";
    else if (/场景|山门|镜头/i.test(text)) slots.assetKind = "scene";
    else if (/道具/i.test(text)) slots.assetKind = "prop";
    else if (/图标/i.test(text)) slots.assetKind = "icon";
    else slots.assetKind = "portrait";

    if (/像素|8-?bit|16-?bit|pixel/i.test(text)) slots.render = "pixel";
    else if (/厚涂/i.test(text)) slots.render = "thick-paint";
    else if (/三渲二/i.test(text)) slots.render = "cel";
    else if (/水墨|仙侠|国风/i.test(text)) slots.render = "ink";

    if (/仙侠|门派|赛博/i.test(text)) slots.world = text.trim().slice(0, 24);
  }

  if (targetId === "promo-kv") {
    if (/9\s*[:：]\s*16|竖版|story/i.test(text)) slots.channel = "story";
    else if (/1\s*[:：]\s*1|方图/i.test(text)) slots.channel = "square";
    else if (/一套|多尺寸/i.test(text)) slots.channel = "set";
    else slots.channel = "wide";
    const hook = text.match(/卖点[：:]\s*([^\n，。]+)/)?.[1];
    if (hook) slots.hook = hook.trim();
    if (/必须上|品牌名/.test(text)) slots.mustType = "品牌名";
  }

  if (targetId === "social-cover") {
    if (/小红书|xhs/i.test(text)) slots.platform = "xhs";
    else if (/公众号|微信/i.test(text)) slots.platform = "wechat";
    else slots.platform = "other";
    if (/人脸/i.test(text)) slots.face = "face";
    else if (/产品/i.test(text)) slots.face = "product";
    const hook = text.match(/钩子[：:]\s*([^\n，。]+)/)?.[1];
    if (hook) slots.hook = hook.trim();
  }

  if (targetId === "product-shot") {
    if (/生活场景/i.test(text)) slots.shot = "lifestyle";
    else if (/材质|特写|macro/i.test(text)) slots.shot = "macro";
    else slots.shot = "white";
    if (/参考|实拍|三视图/.test(text)) slots.refNote = text.trim().slice(0, 40);
  }

  if (targetId === "style-board") {
    const tokens = text
      .split(/[\s,，、]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (tokens[0]) slots.category = tokens[0];
    if (tokens.length > 1) slots.words = tokens.slice(1, 4).join(" ");
  }

  return slots;
}

function parseDiscoverySlots(
  idea: string,
  targetId: TargetId
): Record<string, string> {
  const recipe = getTargetRecipe(targetId);
  const slots: Record<string, string> = {};
  const re = /\*\*(.+?)\*\*[：:]\s*(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(idea))) {
    const label = match[1].trim();
    const rest = match[2].trim();
    const valued = rest.match(/^(.*?)\s*\[value:\s*([^\]]+)\]\s*$/);
    const raw = valued ? valued[2].trim() : rest;
    const question = recipe.discovery.find(
      (item) => item.label === label || item.id === label
    );
    if (question) slots[question.id] = raw;
  }
  return slots;
}

function inferProductType(text: string): string | undefined {
  if (/游戏|game/i.test(text)) return "game";
  if (/落地页|landing|官网/i.test(text)) return "landing";
  if (/海报|封面|小红书/i.test(text)) return "poster";
  if (/app|应用|界面|dashboard|看板/i.test(text)) return "app_ui";
  return undefined;
}

function inferToneValues(text: string): string | undefined {
  const found: string[] = [];
  if (/像素|8-?bit|16-?bit|pixel/i.test(text)) found.push("pixel");
  if (/仙侠|国风|水墨/i.test(text)) found.push("xianxia");
  if (/赛博/i.test(text)) found.push("cyberpunk");
  if (/极简|minimal|linear/i.test(text)) found.push("minimal");
  if (/杂志|编辑|editorial/i.test(text)) found.push("editorial");
  if (/奢华|luxury/i.test(text)) found.push("luxury");
  if (/插画|illustration/i.test(text)) found.push("illustration");
  return found.length > 0 ? found.slice(0, 2).join(",") : undefined;
}

function pickPlatform(idea: string): ProductBrief["platform"] {
  const lower = idea.toLowerCase();
  if (lower.includes("小程序") || lower.includes("miniapp")) return "miniapp";
  if (lower.includes("插件") || lower.includes("extension")) return "extension";
  if (lower.includes("官网") || lower.includes("landing")) return "landing";
  if (lower.includes("web") || lower.includes("网页") || lower.includes("dashboard"))
    return "web";
  return "app";
}

function inferProductName(idea: string, targetId: TargetId): string {
  const text = stripDiscoveryBlock(idea);
  if (targetId === "ui-visual") {
    if (/duolingo|多[邻领]国/i.test(text)) return "多邻国考试学习 App";
    if (/英语|学英语|english/i.test(text)) return "英语学习 App";
  }
  const named = text.match(/(?:做一个|开发一个|想做)([\s\S]{2,12}?)(?:的|，|。|$)/);
  if (named?.[1]?.trim()) return named[1].trim();
  return text.trim().slice(0, 18) || getTargetRecipe(targetId).label;
}

function inferUiAudience(idea: string, slots: Record<string, string>): string {
  if (slots.audience) return slots.audience;
  if (/学生/.test(idea)) return "学生群体";
  if (/开发/.test(idea)) return "独立开发者";
  return "通用用户";
}

function extractUiFeatures(idea: string): string[] {
  const text = stripDiscoveryBlock(idea);
  if (/duolingo|多[邻领]国|英语|学习|备考/i.test(text)) {
    return ["备考计划", "词汇和口语练习", "模考进度追踪", "每日任务提醒"];
  }
  const parts = text
    .split(/[，,。.;；]/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (parts.length >= 2) return parts.slice(0, 4);
  return ["核心功能 A", "核心功能 B", "核心功能 C"];
}

function visualStyleFromSlots(
  targetId: TargetId,
  slots: Record<string, string>,
  idea: string
): string {
  if (targetId === "game-art") {
    if (slots.render === "pixel") return "chunky pixel concept art";
    if (slots.render === "thick-paint") return "thick-paint character concept art";
    if (slots.render === "cel") return "cel-shaded anime concept art";
    if (slots.render === "ink") return "ink wash xianxia concept art";
    return "game concept art, clear silhouette";
  }
  if (targetId === "promo-kv") return "cinematic campaign key visual";
  if (targetId === "social-cover") return "vertical social cover, one focus";
  if (targetId === "product-shot") {
    if (slots.shot === "lifestyle") return "lifestyle product photography";
    if (slots.shot === "macro") return "macro material product photography";
    return "seamless white product photography";
  }
  if (targetId === "style-board") {
    return compact([slots.category, slots.words]).join(", ") || "style exploration board";
  }
  return pickUiStyle(idea);
}

function pickUiStyle(idea: string): string {
  const lower = idea.toLowerCase();
  if (/duolingo|多[邻领]国|英语|学习|备考/.test(lower)) {
    return "clean education app, focused learning, friendly progress UI";
  }
  if (lower.includes("高端") || lower.includes("saas")) return "modern minimal SaaS";
  if (lower.includes("年轻") || lower.includes("生活")) return "bright lifestyle";
  if (lower.includes("ai") || lower.includes("智能")) return "calm AI productivity";
  return "clean modern product";
}

function slotLabel(
  targetId: TargetId,
  id: string,
  value: string | undefined
): string | undefined {
  if (!value) return undefined;
  const question = getTargetRecipe(targetId).discovery.find((item) => item.id === id);
  if (!question) return value;
  return slotDisplayValue(question, value) || value;
}

function slotDisplayValue(question: RecipeQuestion, value: string): string {
  if (!value) return "";
  const parts = value.split(",").map((item) => item.trim()).filter(Boolean);
  return parts
    .map(
      (part) =>
        question.options?.find((option) => option.value === part)?.label ?? part
    )
    .join("、");
}

function slotHint(question: RecipeQuestion): string {
  if (question.options?.length) {
    return question.options.map((option) => option.value).join("|");
  }
  return question.placeholder || "";
}

function stripDiscoveryBlock(idea: string): string {
  return idea.replace(/\[需求确认回答\][\s\S]*/g, "").trim() || idea.trim();
}

function compact(items: Array<string | undefined | null>): string[] {
  return items
    .map((item) => item?.trim())
    .filter((item): item is string => Boolean(item));
}

function compactSlots(slots: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(slots).filter(([, value]) => Boolean(value?.trim()))
  );
}
