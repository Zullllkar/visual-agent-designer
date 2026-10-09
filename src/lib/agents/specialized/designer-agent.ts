/**
 * Designer Agent - 视觉方向专家
 * --------------------------------------------------------------
 * 职责：
 * 1. 定义整体视觉风格
 * 2. 选择配色、字体、视觉语言
 * 3. 确保品牌一致性
 *
 * 特点：
 * - 专注于视觉设计方向
 * - 不关心具体布局（由 ArchitectAgent 负责）
 * - 考虑品牌资产和用户偏好
 */

import { SpecializedAgent, type AgentResult } from "./base-agent";
import type { ArchitectureSpec } from "./architect-agent";

/**
 * 输入：架构规范 + 用户偏好
 */
export interface DesignerInput {
  architectureSpec: ArchitectureSpec;
  userPreferences?: {
    style?: string;
    colors?: string[];
    mood?: string;
  };
  brandKit?: {
    primaryColor?: string;
    logoUrl?: string;
    fonts?: string[];
  };
}

/**
 * 输出：设计方向
 */
export interface DesignDirection {
  /** 配色方案 */
  colorPalette: {
    primary: string;
    secondary: string;
    accent: string;
    backgrounds: string[];
    text: {
      primary: string;
      secondary: string;
    };
  };

  /** 字体方案 */
  typography: {
    headingFont: string;
    bodyFont: string;
    scale: "compact" | "normal" | "generous";
  };

  /** 视觉风格 */
  visualStyle: "minimal" | "bold" | "playful" | "corporate" | "elegant";

  /** 情绪关键词 */
  mood: string[];

  /** 设计原则 */
  principles: string[];

  /** 推理过程 */
  reasoning: string;
}

/**
 * Designer Agent 实现
 */
export class DesignerAgent extends SpecializedAgent<DesignerInput, DesignDirection> {
  constructor() {
    super(
      {
        name: "DesignerAgent",
        expertise: "Visual Design Direction & Brand Consistency",
        systemPrompt: `You are an expert visual designer specializing in establishing design direction and brand consistency.

Your responsibilities:
1. Define the overall visual style and mood
2. Select appropriate color palettes that work well together
3. Choose typography that matches the project's purpose
4. Ensure brand consistency if brand assets are provided
5. Consider accessibility (color contrast, readability)

Rules:
- Focus ONLY on visual direction (colors, fonts, style, mood)
- Do NOT make structural composition decisions (the architect owns information architecture)
- Always use hex codes for colors (#RRGGBB)
- Ensure color combinations meet WCAG AA contrast standards
- Provide reasoning for your choices

Output format (JSON):
{
  "colorPalette": {
    "primary": "#3B82F6",
    "secondary": "#8B5CF6",
    "accent": "#F59E0B",
    "backgrounds": ["#FFFFFF", "#F3F4F6", "#1F2937"],
    "text": {
      "primary": "#111827",
      "secondary": "#6B7280"
    }
  },
  "typography": {
    "headingFont": "Inter",
    "bodyFont": "Inter",
    "scale": "normal"
  },
  "visualStyle": "minimal",
  "mood": ["professional", "modern", "trustworthy"],
  "principles": ["Clarity over decoration", "Generous whitespace", "Bold typography"],
  "reasoning": "Minimal style with blue primary matches SaaS industry standards..."
}`,
        temperature: 0.7, // 中等温度 = 创造性 + 一致性
      }
    );
  }

  async execute(input: DesignerInput): Promise<AgentResult<DesignDirection>> {
    this.log("info", "开始视觉方向规划", {
      screenCount: input.architectureSpec.screens.length,
      hasBrandKit: !!input.brandKit,
    });

    try {
      const { result, duration } = await this.measureTime(async () => {
        // 1. 构建提示词
        const prompt = this.buildPrompt(input);

        // 2. 调用 LLM 生成设计方向
        const llmResponse = await this.callLLM({
          prompt,
          responseFormat: "json",
        });

        // 3. 解析结果
        const direction = this.parseJSON<DesignDirection>(llmResponse.content);

        // 4. 验证结果
        this.validateDirection(direction);

        // 5. 如果有品牌资产，调整以匹配品牌
        if (input.brandKit) {
          this.applyBrandKit(direction, input.brandKit);
        }

        return {
          direction,
          tokens: llmResponse.usage,
        };
      });

      this.log("info", "视觉方向规划完成", {
        style: result.direction.visualStyle,
        duration,
      });

      return this.createSuccessResult(
        result.direction,
        duration,
        result.tokens,
        result.direction.reasoning
      );
    } catch (error) {
      this.log("error", "视觉方向规划失败", error);
      return this.createErrorResult(error as Error, 0);
    }
  }

  /**
   * 构建提示词
   */
  private buildPrompt(input: DesignerInput): string {
    let prompt = `Define the visual design direction for this project:\n\n`;

    // 架构信息
    prompt += `Architecture:\n`;
    prompt += `- ${input.architectureSpec.screens.length} screen(s)\n`;
    prompt += `- Purpose: ${input.architectureSpec.screens[0]?.purpose || "General purpose"}\n`;
    prompt += `- Navigation: ${input.architectureSpec.navigation.type}\n\n`;

    // 用户偏好
    if (input.userPreferences) {
      prompt += `User Preferences:\n`;
      if (input.userPreferences.style) {
        prompt += `- Style: ${input.userPreferences.style}\n`;
      }
      if (input.userPreferences.colors && input.userPreferences.colors.length > 0) {
        prompt += `- Preferred colors: ${input.userPreferences.colors.join(", ")}\n`;
      }
      if (input.userPreferences.mood) {
        prompt += `- Mood: ${input.userPreferences.mood}\n`;
      }
      prompt += `\n`;
    }

    // 品牌资产
    if (input.brandKit) {
      prompt += `Brand Assets:\n`;
      if (input.brandKit.primaryColor) {
        prompt += `- Primary color: ${input.brandKit.primaryColor}\n`;
      }
      if (input.brandKit.fonts && input.brandKit.fonts.length > 0) {
        prompt += `- Brand fonts: ${input.brandKit.fonts.join(", ")}\n`;
      }
      prompt += `\n`;
    }

    prompt += `Provide a cohesive design direction in JSON format.`;

    return prompt;
  }

  /**
   * 验证设计方向
   */
  private validateDirection(direction: DesignDirection): void {
    // 验证配色
    if (!direction.colorPalette) {
      throw new Error("设计方向必须包含配色方案");
    }

    const requiredColors = ["primary", "secondary", "accent"];
    for (const color of requiredColors) {
      if (!(direction.colorPalette as any)[color]) {
        throw new Error(`配色方案缺少 ${color} 颜色`);
      }

      // 验证是否为有效的 hex 颜色
      const hex = (direction.colorPalette as any)[color] as string;
      if (!/^#[0-9A-F]{6}$/i.test(hex)) {
        throw new Error(`${color} 不是有效的 hex 颜色: ${hex}`);
      }
    }

    // 验证字体
    if (!direction.typography || !direction.typography.headingFont) {
      throw new Error("设计方向必须包含字体定义");
    }

    // 验证风格
    const validStyles = ["minimal", "bold", "playful", "corporate", "elegant"];
    if (!validStyles.includes(direction.visualStyle)) {
      throw new Error(`无效的视觉风格: ${direction.visualStyle}`);
    }

    // 验证推理
    if (!direction.reasoning || direction.reasoning.length < 20) {
      throw new Error("设计方向必须包含详细的推理说明");
    }
  }

  /**
   * 应用品牌资产
   */
  private applyBrandKit(
    direction: DesignDirection,
    brandKit: NonNullable<DesignerInput["brandKit"]>
  ): void {
    // 如果有品牌主色，替换 primary
    if (brandKit.primaryColor) {
      direction.colorPalette.primary = brandKit.primaryColor;
      this.log("info", "应用品牌主色", { color: brandKit.primaryColor });
    }

    // 如果有品牌字体，优先使用
    if (brandKit.fonts && brandKit.fonts.length > 0) {
      direction.typography.headingFont = brandKit.fonts[0];
      direction.typography.bodyFont = brandKit.fonts[0];
      this.log("info", "应用品牌字体", { font: brandKit.fonts[0] });
    }
  }

  /**
   * 快速生成设计方向（使用预设）
   */
  async quickDirection(style: "minimal" | "bold" | "corporate"): Promise<AgentResult<DesignDirection>> {
    this.log("info", "使用快速设计方向", { style });

    try {
      const { result, duration } = await this.measureTime(async () => {
        const presets: Record<string, DesignDirection> = {
          minimal: {
            colorPalette: {
              primary: "#3B82F6",
              secondary: "#8B5CF6",
              accent: "#F59E0B",
              backgrounds: ["#FFFFFF", "#F9FAFB", "#F3F4F6"],
              text: {
                primary: "#111827",
                secondary: "#6B7280",
              },
            },
            typography: {
              headingFont: "Inter",
              bodyFont: "Inter",
              scale: "normal",
            },
            visualStyle: "minimal",
            mood: ["clean", "modern", "professional"],
            principles: ["Clarity first", "Generous whitespace", "Subtle interactions"],
            reasoning: "Minimal preset with blue accent for professional SaaS applications",
          },
          bold: {
            colorPalette: {
              primary: "#EF4444",
              secondary: "#F59E0B",
              accent: "#10B981",
              backgrounds: ["#FFFFFF", "#FEF2F2", "#111827"],
              text: {
                primary: "#111827",
                secondary: "#4B5563",
              },
            },
            typography: {
              headingFont: "Inter",
              bodyFont: "Inter",
              scale: "generous",
            },
            visualStyle: "bold",
            mood: ["energetic", "confident", "dynamic"],
            principles: ["Bold statements", "High contrast", "Strong hierarchy"],
            reasoning: "Bold preset with red primary for high-energy brands",
          },
          corporate: {
            colorPalette: {
              primary: "#1E40AF",
              secondary: "#6366F1",
              accent: "#0EA5E9",
              backgrounds: ["#FFFFFF", "#F8FAFC", "#0F172A"],
              text: {
                primary: "#0F172A",
                secondary: "#475569",
              },
            },
            typography: {
              headingFont: "Inter",
              bodyFont: "Inter",
              scale: "normal",
            },
            visualStyle: "corporate",
            mood: ["trustworthy", "professional", "stable"],
            principles: ["Consistency", "Hierarchy", "Professionalism"],
            reasoning: "Corporate preset with blue tones for enterprise applications",
          },
        };

        const direction = presets[style];
        if (!direction) {
          throw new Error(`Unknown style preset: ${style}`);
        }

        return { direction };
      });

      return this.createSuccessResult(
        result.direction,
        duration,
        undefined,
        result.direction.reasoning
      );
    } catch (error) {
      this.log("error", "快速设计方向失败", error);
      return this.createErrorResult(error as Error, 0);
    }
  }

  /**
   * 验证颜色对比度（WCAG AA 标准）
   */
  private checkContrast(foreground: string, background: string): number {
    // 简化版对比度计算（生产环境应该使用完整的 WCAG 算法）
    const getLuminance = (hex: string): number => {
      const rgb = parseInt(hex.slice(1), 16);
      const r = (rgb >> 16) / 255;
      const g = ((rgb >> 8) & 0xff) / 255;
      const b = (rgb & 0xff) / 255;
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };

    const l1 = getLuminance(foreground);
    const l2 = getLuminance(background);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);

    return (lighter + 0.05) / (darker + 0.05);
  }
}

