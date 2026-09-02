import { parsePromptsFromConfirmText } from "@/lib/agents/image-prompts";
import type { ProjectFile } from "@/lib/project/schema";
import { resolveImageFrame } from "@/lib/skills/runtime";
import { getTargetRecipe } from "@/lib/targets/catalog";
import { resolveTargetId } from "@/lib/targets/resolve";

export const IMAGE_CONFIRM_MARKER = "[IMAGE_GENERATION_CONFIRMED]";

export interface ImageGenerationConfirmationData {
  title: string;
  prompt: string;
  /** 多类型时每条一种；单类型可省略或仅含 prompt */
  prompts?: string[];
  reason: string;
  count: number;
  width: number;
  height: number;
  role?: string;
}

export function parseImageGenerationConfirmation(text: string): {
  confirmed: boolean;
  prompt?: string;
  prompts?: string[];
  count?: number;
} {
  if (!text.includes(IMAGE_CONFIRM_MARKER)) return { confirmed: false };
  const prompt = matchField(text, "Prompt");
  const prompts = parsePromptsFromConfirmText(text);
  const countRaw = matchField(text, "Count");
  const count = countRaw ? Number.parseInt(countRaw, 10) : undefined;
  return {
    confirmed: true,
    prompt,
    prompts,
    count: Number.isFinite(count) ? count : undefined,
  };
}

export function buildImageGenerationConfirmation({
  project,
  userMessage,
  explicitPrompt,
  explicitPrompts,
  count,
  skillSize,
}: {
  project: ProjectFile;
  userMessage: string;
  explicitPrompt?: string;
  explicitPrompts?: string[];
  count: number;
  skillSize?: { width: number; height: number } | null;
}): ImageGenerationConfirmationData {
  const targetId = resolveTargetId(project);
  const recipe = getTargetRecipe(targetId);
  const frame = resolveImageFrame({
    skillSize,
    targetSize: recipe.canvas,
  });
  const uiScreen = targetId === "ui-visual" && inferImageIntent(userMessage) === "app_home_ui";
  const prompts =
    explicitPrompts && explicitPrompts.length > 0
      ? explicitPrompts.map((p) => p.trim()).filter(Boolean)
      : undefined;
  const prompt =
    (prompts && prompts[0]) ||
    explicitPrompt?.trim() ||
    buildPrompt(project, userMessage, uiScreen ? "app_home_ui" : "visual_asset");
  const multi = Boolean(prompts && prompts.length > 1);
  return {
    title: uiScreen
      ? "生图执行请求：App 首页 UI"
      : multi
        ? `生图执行请求：${prompts!.length} 种不同类型`
        : `生图执行请求：${recipe.label}`,
    prompt,
    prompts: prompts && prompts.length > 0 ? prompts : [prompt],
    reason: uiScreen
      ? "用户要求的是 App 首页 UI 图，因此这次会生成一个完整移动端界面 mockup，不会生成宣传海报、横幅、拼贴图或营销素材。"
      : multi
        ? "将按多条不同提示词各生成一张图（不同类型/构图）。执行前请逐条确认或编辑。"
        : `按「${recipe.label}」出图。执行前确认提示词、数量和画幅。`,
    count: multi ? prompts!.length : count,
    width: frame.width,
    height: frame.height,
    role: uiScreen ? "product-shot" : "hero",
  };
}

function buildPrompt(
  project: ProjectFile,
  userMessage: string,
  intent: "app_home_ui" | "visual_asset",
): string {
  const brief = project.brief;
  const product = extractProductFromMessage(userMessage) || brief?.productName || project.title;
  const positioning =
    extractSentence(userMessage) || brief?.positioning || project.rawIdea || project.title;
  const audience = brief?.targetUser ? `Target users: ${brief.targetUser}.` : "";
  const style = [project.designDirection?.moodKeywords?.join(", "), brief?.visualStyle]
    .filter(Boolean)
    .join(", ");

  if (intent === "app_home_ui") {
    return [
      `A single high-fidelity mobile app home screen UI mockup for "${product}".`,
      `Product context: ${positioning}.`,
      audience,
      style ? `Visual style: ${style}.` : "",
      "Show exactly one complete smartphone app interface/home screen with realistic app layout, navigation, cards, learning progress, primary CTA, status content, and polished UI details.",
      "Use readable UI text where needed, but keep it as app interface copy, not advertising slogans.",
      "Do not create a poster, promotional banner, sale graphic, hero marketing visual, collage, packaging ad, or social media campaign image.",
      "No giant sale typography, no product shopping poster composition, no browser chrome, no code wireframe.",
    ]
      .filter(Boolean)
      .join(" ");
  }

  return [
    `High-fidelity visual asset for "${product}".`,
    `Product context: ${positioning}.`,
    audience,
    style ? `Visual style: ${style}.` : "",
    "Professional design asset, coherent composition, no watermark.",
  ]
    .filter(Boolean)
    .join(" ");
}

function inferImageIntent(text: string): "app_home_ui" | "visual_asset" {
  return /app|首页|主页|首屏|home\s*screen|home\s*page|screen\s*ui|ui\s*图|页面\s*ui|app\s*ui/i.test(
    text,
  )
    ? "app_home_ui"
    : "visual_asset";
}

function extractProductFromMessage(text: string): string | undefined {
  const normalized = text.replace(/\s+/g, " ").trim();
  const duolingo = normalized.match(
    /(?:面向|关于|针对)?\s*([^，。！？,.?\n]{0,20}多[邻領领]国[^，。！？,.?\n]{0,32}?(?:学习|考试)?\s*app)/i,
  );
  if (duolingo?.[1]) return duolingo[1].trim();
  const app = normalized.match(
    /(?:生成|做|设计|面向|关于|针对)?\s*([^，。！？,.?\n]{2,40}?\s*app)/i,
  );
  return app?.[1]?.replace(/^(一个|一款|一张|的)\s*/, "").trim();
}

function extractSentence(text: string): string | undefined {
  const cleaned = text.replace(IMAGE_CONFIRM_MARKER, "").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, 220) : undefined;
}

function matchField(text: string, name: string): string | undefined {
  const re = new RegExp(`^${name}:\\s*([\\s\\S]*?)(?=\\n[A-Za-z]+:|$)`, "m");
  const match = text.match(re);
  return match?.[1]?.trim();
}
