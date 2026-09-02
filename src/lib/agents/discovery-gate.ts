/**
 * Discovery / direction 闸门：只问会改结果的信息，具体 brief 直接进入方向确认。
 * @author：wangjunhua
 */

import type { DiscoveryFormData, DiscoveryQuestion } from "./tools/ask-discovery";
import { isAdoptAssetStyleMessage } from "./adopt-asset-style";
import {
  getTargetRecipe,
  type RecipeQuestion,
  type TargetId,
} from "@/lib/targets/catalog";
import { parseTargetId } from "@/lib/targets/resolve";

const PRODUCT_TYPE_RE =
  /游戏|game|app|应用|落地页|landing|官网|海报|封面|dashboard|看板|原型|deck|幻灯|小红书|笔记|界面|ui\b/i;
const VISUAL_STYLE_RE =
  /像素|仙侠|赛博|极简|杂志|奢华|插画|水彩|写实|linear|brutalist|国风|水墨|蒸汽波|8-?bit|16-?bit|flat|拟物|赛博朋克|像素风/i;

export function isDiscoveryAnswerMessage(text: string): boolean {
  return /^\s*\[(?:需求确认回答|form answers)/i.test(text.trim());
}

export function isDirectionConfirmMessage(text: string): boolean {
  return /\[视觉方向确认\]/.test(text);
}

export const DIRECTION_ADJUST_MESSAGE =
  "[视觉方向调整] 我希望调整当前视觉方向，请先询问我需要修改的部分。";

export const TARGET_CHANGE_PREFIX = "[更换目标]";

export function isDirectionAdjustMessage(text: string): boolean {
  return /\[视觉方向调整\]/.test(text);
}

export function isTargetChangeMessage(text: string): boolean {
  return /\[更换目标\]/.test(text);
}

export function buildTargetChangeMessage(label: string): string {
  return `${TARGET_CHANGE_PREFIX} 已改为「${label}」。已有图保留，请按新配方继续。`;
}

export function isSkipDiscoveryInstruction(text: string): boolean {
  return /跳过(问题|问答|确认)|直接(做|生成|开始)|just build|skip questions|开始设计/i.test(
    text
  );
}

export function hasMaterialBrief(text: string): boolean {
  const t = text.trim();
  if (t.length < 8) return false;
  return PRODUCT_TYPE_RE.test(t) && VISUAL_STYLE_RE.test(t);
}

export function shouldAskDiscovery(input: {
  userMessage: string;
  hasBrief?: boolean;
}): boolean {
  const text = input.userMessage.trim();
  if (input.hasBrief) return false;
  if (!text) return true;
  if (isDiscoveryAnswerMessage(text)) return false;
  if (isDirectionConfirmMessage(text) || isDirectionAdjustMessage(text)) {
    return false;
  }
  if (isAdoptAssetStyleMessage(text)) return false;
  if (isSkipDiscoveryInstruction(text)) return false;
  if (hasMaterialBrief(text)) return false;
  return true;
}

export function inferProductType(text: string): string | undefined {
  if (/游戏|game/i.test(text)) return "game";
  if (/落地页|landing|官网/i.test(text)) return "landing";
  if (/海报|封面|小红书/i.test(text)) return "poster";
  if (/app|应用|界面|dashboard|看板/i.test(text)) return "app_ui";
  return undefined;
}

export function inferToneValues(text: string): string[] {
  const found: string[] = [];
  if (/像素|8-?bit|16-?bit|pixel/i.test(text)) found.push("pixel");
  if (/仙侠|国风|水墨/i.test(text)) found.push("xianxia");
  if (/赛博/i.test(text)) found.push("cyberpunk");
  if (/极简|minimal|linear/i.test(text)) found.push("minimal");
  if (/杂志|编辑|editorial/i.test(text)) found.push("editorial");
  if (/奢华|luxury/i.test(text)) found.push("luxury");
  if (/插画|illustration/i.test(text)) found.push("illustration");
  return found.slice(0, 2);
}

export function optionLabelForValue(
  options: Array<{ value: string; label: string }>,
  value: string
): string {
  return options.find((item) => item.value === value)?.label ?? value;
}

function toDiscoveryQuestion(
  spec: RecipeQuestion,
  defaults?: Partial<Pick<DiscoveryQuestion, "default">>
): DiscoveryQuestion {
  return {
    id: spec.id,
    label: spec.label,
    type: spec.type,
    required: spec.required,
    maxSelections: spec.maxSelections,
    placeholder: spec.placeholder,
    options: spec.options?.map((item) => item.value),
    optionLabels: spec.options
      ? Object.fromEntries(spec.options.map((item) => [item.value, item.label]))
      : undefined,
    ...defaults,
  };
}

function inferDiscoveryDefault(
  spec: RecipeQuestion,
  userMessage: string,
  targetId: TargetId
): DiscoveryQuestion["default"] {
  if (spec.id === "productType") return inferProductType(userMessage);
  if (spec.id === "tone") {
    const tones = inferToneValues(userMessage);
    return tones.length > 0 ? tones : undefined;
  }
  if (spec.id === "brand") return "pick_direction";
  if (spec.id === "assetKind") {
    if (/立绘|角色/i.test(userMessage)) return "portrait";
    if (/场景|山门|镜头/i.test(userMessage)) return "scene";
    if (/道具/i.test(userMessage)) return "prop";
    if (/图标/i.test(userMessage)) return "icon";
    return targetId === "game-art" ? "portrait" : undefined;
  }
  if (spec.id === "render") {
    if (/像素|8-?bit|16-?bit|pixel/i.test(userMessage)) return "pixel";
    if (/厚涂/i.test(userMessage)) return "thick-paint";
    if (/三渲二/i.test(userMessage)) return "cel";
    if (/水墨|仙侠|国风/i.test(userMessage)) return "ink";
    return undefined;
  }
  if (spec.id === "world" && /仙侠|门派|赛博/i.test(userMessage)) {
    return userMessage.trim().slice(0, 24);
  }
  return undefined;
}

export function buildDefaultDiscoveryForm(
  userMessage: string,
  targetId?: string
): DiscoveryFormData {
  const id = parseTargetId(targetId);
  const recipe = getTargetRecipe(id);
  const questions = recipe.discovery.map((spec) =>
    toDiscoveryQuestion(spec, {
      default: inferDiscoveryDefault(spec, userMessage, id),
    })
  );

  return {
    title: "快速需求确认 — 30秒",
    description: "已按你的描述预填，可直接提交或改一题。",
    questions,
  };
}

export function buildTargetConflictForm(
  current: TargetId,
  inferred: TargetId
): DiscoveryFormData {
  const currentLabel = getTargetRecipe(current).label;
  const inferredLabel = getTargetRecipe(inferred).label;
  return {
    title: "要不要换目标？",
    description: `这句话更像「${inferredLabel}」。换了提问和生图宪法都会跟着变。`,
    questions: [
      {
        id: "retarget",
        label: `改成「${inferredLabel}」吗？`,
        type: "radio",
        required: true,
        default: inferred,
        options: [inferred, "keep"],
        optionLabels: {
          [inferred]: `改成${inferredLabel}`,
          keep: `继续用${currentLabel}`,
        },
      },
    ],
  };
}

export function buildProductReferenceForm(): DiscoveryFormData {
  return {
    title: "产品图需要参考",
    description: "没有实拍或三视图时不能脑补商品外形。先补图，或改成别的目标。",
    questions: [
      {
        id: "refReady",
        label: "参考图",
        type: "radio",
        required: true,
        default: "will_upload",
        options: ["will_upload", "switch_target"],
        optionLabels: {
          will_upload: "我去上传实拍 / 三视图",
          switch_target: "先不拍产品，换目标",
        },
      },
    ],
  };
}

const ADJUST_DEFAULTS: Record<string, string> = {
  mood: "keep_mood",
  palette: "keep_palette",
  pixel: "keep_pixel",
  focus: "keep_focus",
  density: "keep_density",
  drama: "keep_drama",
  hookTone: "keep_hook",
  light: "keep_light",
  scene: "keep_scene",
};

export function buildDirectionAdjustForm(
  currentSummary?: string,
  targetId?: string
): DiscoveryFormData {
  const hint = currentSummary?.trim()
    ? `当前方向：${currentSummary.trim().slice(0, 80)}`
    : "选出要改的几项，可直接提交。";
  const recipe = getTargetRecipe(parseTargetId(targetId));
  const questions = recipe.directionAdjust.slice(0, 5).map((spec) =>
    toDiscoveryQuestion(spec, {
      default: ADJUST_DEFAULTS[spec.id],
    })
  );

  return {
    title: "调整视觉方向 — 30秒",
    description: hint,
    questions,
  };
}

export function mergeDiscoveryCustomAnswers(
  questions: DiscoveryQuestion[],
  answers: Record<string, string | string[]>,
  custom: Record<string, string>
): Record<string, string | string[]> {
  const next: Record<string, string | string[]> = { ...answers };
  for (const question of questions) {
    const typed = custom[question.id]?.trim();
    if (!typed) continue;
    if (question.type === "checkbox") {
      const current = Array.isArray(next[question.id])
        ? [...(next[question.id] as string[])]
        : [];
      if (!current.includes(typed)) current.push(typed);
      next[question.id] = current;
      continue;
    }
    if (question.type === "radio") {
      next[question.id] = typed;
    }
  }
  return next;
}

export function isDiscoveryAnswerFilled(
  question: DiscoveryQuestion,
  value: string | string[] | undefined
): boolean {
  if (!question.required) return true;
  if (Array.isArray(value)) return value.some((item) => item.trim().length > 0);
  return Boolean(value?.trim());
}

export function formatDiscoveryAnswerMessage(
  questions: DiscoveryQuestion[],
  answers: Record<string, string | string[]>
): string {
  const parts: string[] = [];
  for (const q of questions) {
    const val = answers[q.id];
    if (Array.isArray(val)) {
      const labels = val
        .map((value) => q.optionLabels?.[value] ?? value)
        .filter(Boolean);
      if (labels.length === 0) continue;
      const values = val.filter(Boolean).join(",");
      parts.push(`**${q.label}**：${labels.join("、")} [value: ${values}]`);
      continue;
    }
    if (!val || !String(val).trim()) continue;
    const label = q.optionLabels?.[val] ?? val;
    const valueSuffix = q.optionLabels?.[val] ? ` [value: ${val}]` : "";
    parts.push(`**${q.label}**：${label}${valueSuffix}`);
  }
  return `[需求确认回答]\n${parts.join("\n")}`;
}
