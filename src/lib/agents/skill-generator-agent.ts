/**
 * SkillGeneratorAgent - 根据用户需求自动生成 SKILL.md
 * --------------------------------------------------------------
 */

import { MockImageProvider } from "@/lib/providers/image/mock";
import { MockLlmProvider } from "@/lib/providers/llm/mock";
import type { SkillKind, SkillManifest } from "@/lib/skills/schema";
import { SKILL_BODY_TEMPLATES } from "./skill-body-templates";
import { toolRegistry } from "./tools/registry";
import type { ToolContext } from "./tools/types";
import type { AgentContext } from "./types";

/**
 * Body 模板选择
 */
export function skillBodyTemplateForKind(kind: SkillKind): string {
  return SKILL_BODY_TEMPLATES[kind] ?? SKILL_BODY_TEMPLATES.prototype;
}

function getBodyTemplate(kind: SkillKind): string {
  return skillBodyTemplateForKind(kind);
}

export function buildGeneratedSkillDocument(userInput: string): {
  manifest: SkillManifest;
  markdown: string;
} {
  const manifest = generateManifest(userInput);
  return { manifest, markdown: manifestToMarkdown(manifest) };
}

/**
 * 从用户输入派生 skill name
 */
export function deriveSkillNameFromIdea(input: string): string {
  const keywords = input.match(/[a-z0-9]+/gi) || [];
  const kind = deriveSkillKindFromIdea(input);
  const nameKeywords = keywords.slice(0, 2).join("-");
  return nameKeywords ? `${nameKeywords}-${kind}` : `${kind}-skill`;
}

/**
 * 从输入推导 kind
 */
export function deriveSkillKindFromIdea(input: string): SkillKind {
  const lower = input.toLowerCase();

  // 中文关键词
  if (lower.includes("小红书") || lower.includes("xhs") || lower.includes("封面")) {
    return "xhs";
  }
  if (lower.includes("落地页") || lower.includes("landing")) {
    return "landing";
  }
  if (lower.includes("游戏") || lower.includes("game")) {
    return "game-art";
  }
  if (lower.includes("产品") || lower.includes("product")) {
    return "product-shot";
  }
  if (
    lower.includes("原型") ||
    lower.includes("prototype") ||
    lower.includes("APP") ||
    lower.includes("小程序")
  ) {
    return "prototype";
  }
  if (lower.includes("风格") || lower.includes("风格板") || lower.includes("mood")) {
    return "style-board";
  }
  if (lower.includes("宣传") || lower.includes("主视觉")) {
    return "promo-kv";
  }

  // 默认 prototype
  return "prototype";
}

function defaultSizeForKind(kind: SkillKind): { width: number; height: number } {
  switch (kind) {
    case "xhs":
      return { width: 1080, height: 1440 };
    case "game-art":
      return { width: 1280, height: 720 };
    case "promo-kv":
      return { width: 1920, height: 1080 };
    case "product-shot":
      return { width: 1024, height: 1024 };
    case "style-board":
      return { width: 1600, height: 900 };
    default:
      return { width: 1440, height: 900 };
  }
}

function recommendedDesignSystemForKind(kind: SkillKind): string {
  switch (kind) {
    case "xhs":
      return "xhs-style";
    case "game-art":
      return "cinematic-concept";
    case "promo-kv":
      return "campaign-key";
    case "product-shot":
      return "product-photo";
    case "style-board":
      return "exploration-board";
    default:
      return "linear-like";
  }
}

/**
 * 基于用户输入生成 Manifest
 */
function generateManifest(userInput: string): SkillManifest {
  const kind = deriveSkillKindFromIdea(userInput);
  const pageSize = defaultSizeForKind(kind);
  const pageCountHint = kind === "xhs" ? 1 : 2;

  return {
    name: deriveSkillNameFromIdea(userInput),
    description: `为用户输入的"${userInput}"创建的自定义设计技能`,
    kind: kind,
    version: "1.0.0",
    author: "user",
    recommendedDesignSystem: recommendedDesignSystemForKind(kind),
    inputs: [
      {
        name: "idea",
        type: "string",
        required: true,
        description: "产品核心想法、主题或需求描述",
      },
      {
        name: "tone",
        type: "select",
        required: false,
        options: ["enterprise", "modern", "playful", "premium"],
        default: "modern",
        description: "整体风格基调",
      },
      {
        name: "pageCount",
        type: "number",
        required: false,
        default: pageCountHint,
        description: "期望生成的页面数量",
      },
    ],
    output: {
      artifact: kind === "xhs" ? "xhs-cards" : kind === "landing" ? "landing-page" : "canvas-pages",
      defaultPageSize: pageSize,
      pageCountHint,
    },
    agent: {
      steps: ["brief", "image", "critic", "repair"],
      imageRequired: true,
      repairThreshold: 8.5,
      maxRepairRounds: 2,
    },
  };
}

/**
 * 将 Manifest 序列化为 YAML Frontmatter
 */
function serializeYaml(data: unknown, indent = 0): string {
  const spaces = "  ".repeat(indent);
  if (data === null || data === undefined) return "";
  if (typeof data === "string") return JSON.stringify(data);
  if (typeof data === "number" || typeof data === "boolean") return String(data);

  if (Array.isArray(data)) {
    if (data.length === 0) return "[]";
    return data
      .map((item) => {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const nested = serializeYaml(item, indent + 1).split("\n");
          const first = nested[0]?.trimStart() ?? "";
          const rest = nested.slice(1);
          return [`${spaces}- ${first}`, ...rest].join("\n");
        }
        return `${spaces}- ${serializeYaml(item)}`;
      })
      .join("\n");
  }

  const lines: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
      const nested = serializeYaml(value, indent + 1);
      if (nested === "[]") {
        lines.push(`${spaces}${key}: []`);
      } else {
        lines.push(`${spaces}${key}:`);
        lines.push(nested);
      }
    } else {
      lines.push(`${spaces}${key}: ${serializeYaml(value)}`);
    }
  }
  return lines.join("\n");
}

/**
 * 将 Manifest 转为完整 SKILL.md Markdown
 */
function manifestToMarkdown(manifest: SkillManifest): string {
  const frontmatter = serializeYaml({
    name: manifest.name,
    description: manifest.description,
    kind: manifest.kind,
    version: manifest.version,
    author: manifest.author,
    recommendedDesignSystem: manifest.recommendedDesignSystem,
    inputs: manifest.inputs,
    output: manifest.output,
    agent: manifest.agent,
  }).trim();
  return `---\n${frontmatter}\n---\n\n${getBodyTemplate(manifest.kind)}`;
}

/**
 * SkillGeneratorAgent 主入口
 */
export async function runSkillGeneratorAgent(
  userInput: string,
  _ctx?: Partial<AgentContext>,
): Promise<{ success: boolean; message: string; skillId?: string }> {
  try {
    console.log("[SkillGeneratorAgent] 开始生成...", { userInput });

    // Step 1: 生成 Manifest
    const manifest = generateManifest(userInput);

    // Step 2: 转换为完整 Markdown
    const fullMarkdown = manifestToMarkdown(manifest);

    // Step 3: 调用 create_skill 工具保存
    const tempCtx: ToolContext = {
      project: null,
      userMessage: `创建技能：${manifest.description}`,
      agentCtx: {
        projectId: "temp",
        scratch: {},
        providers: {
          llm: MockLlmProvider,
          image: MockImageProvider,
          visionCritic: false,
        },
      },
    };

    const result = await toolRegistry.execute(
      "create_skill",
      {
        idea: userInput,
        rawMarkdown: fullMarkdown,
      },
      tempCtx,
    );

    if (result.data && typeof result.data === "object" && "success" in result.data) {
      if (!result.data.success) {
        return {
          success: false,
          message: result.summary || "创建失败",
        };
      }
    }

    return {
      success: true,
      message: `✅ Skill 已创建：${manifest.description}`,
      skillId: manifest.name,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "未知错误";
    console.error("[SkillGeneratorAgent] 失败", { error: errorMessage, userInput });
    return {
      success: false,
      message: `❌ 生成失败：${errorMessage}`,
    };
  }
}
