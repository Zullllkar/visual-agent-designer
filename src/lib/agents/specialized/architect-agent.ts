/**
 * Architect Agent - 结构规划专家
 * --------------------------------------------------------------
 * 职责：
 * 1. 分析用户需求，规划页面结构
 * 2. 决定有多少个 screen、每个 screen 的布局
 * 3. 输出结构化的设计规范
 *
 * 特点：
 * - 专注于信息架构和布局规划
 * - 不关心视觉样式（颜色、字体等）
 * - 输出结构化 JSON（易于下游 agents 使用）
 */

import { SpecializedAgent, type AgentResult } from "./base-agent";

/**
 * 输入：用户简报
 */
export interface ArchitectInput {
  userBrief: string;
  projectContext?: {
    existingScreens?: string[];
    constraints?: string[];
  };
}

/**
 * 输出：架构规范
 */
export interface ArchitectureSpec {
  /** 页面列表 */
  screens: Array<{
    id: string;
    name: string;
    purpose: string;
    layout: "hero" | "grid" | "list" | "form" | "dashboard" | "article";
    sections: Array<{
      id: string;
      type: "header" | "hero" | "features" | "content" | "cta" | "footer";
      description: string;
    }>;
  }>;

  /** 导航结构 */
  navigation: {
    type: "single-page" | "multi-page" | "tabs";
    structure: string;
  };

  /** 内容优先级 */
  contentPriority: string[];

  /** 推理过程（说明为什么这样设计） */
  reasoning: string;
}

/**
 * Architect Agent 实现
 */
export class ArchitectAgent extends SpecializedAgent<ArchitectInput, ArchitectureSpec> {
  constructor() {
    super({
      name: "ArchitectAgent",
      expertise: "Information Architecture & Layout Planning",
      systemPrompt: `You are an expert information architect specializing in web design structure planning.

Your responsibilities:
1. Analyze user requirements and define page structure
2. Decide how many screens are needed and their purpose
3. Plan the layout and sections for each screen
4. Prioritize content based on user goals

Rules:
- Focus ONLY on structure and information architecture
- Do NOT make decisions about visual styling, typography, or imagery
- Output structured JSON that downstream agents can consume
- Always explain your reasoning

Output format (JSON):
{
  "screens": [
    {
      "id": "home",
      "name": "Homepage",
      "purpose": "Introduce product and drive conversions",
      "layout": "hero",
      "sections": [
        { "id": "hero", "type": "hero", "description": "Main value prop with CTA" },
        { "id": "features", "type": "features", "description": "3-column feature highlights" }
      ]
    }
  ],
  "navigation": {
    "type": "single-page",
    "structure": "Fixed top nav with scroll anchors"
  },
  "contentPriority": ["value-prop", "social-proof", "features", "pricing"],
  "reasoning": "Single-page layout works best for SaaS landing pages..."
}`,
        temperature: 0.3, // 低温度 = 更结构化
      });
  }

  async execute(input: ArchitectInput): Promise<AgentResult<ArchitectureSpec>> {
    this.log("info", "开始结构规划", { brief: input.userBrief });

    try {
      const { result, duration } = await this.measureTime(async () => {
        // 1. 如果没有 brief，先生成
        let brief = input.userBrief;
        if (!brief || brief.length < 50) {
          this.log("info", "Brief 太短，调用 generate_brief 工具");
          const briefResult = await this.executeTool("generate_brief", {
            userInput: brief,
          });
          brief = (briefResult as any).brief || brief;
        }

        // 2. 调用 LLM 进行结构规划
        const prompt = this.buildPrompt(brief, input.projectContext);
        const llmResponse = await this.callLLM({
          prompt,
          responseFormat: "json",
        });

        // 3. 解析结果
        const spec = this.parseJSON<ArchitectureSpec>(llmResponse.content);

        // 4. 验证结果
        this.validateSpec(spec);

        return {
          spec,
          tokens: llmResponse.usage,
        };
      });

      this.log("info", "结构规划完成", {
        screenCount: result.spec.screens.length,
        duration,
      });

      return this.createSuccessResult(
        result.spec,
        duration,
        result.tokens,
        result.spec.reasoning
      );
    } catch (error) {
      this.log("error", "结构规划失败", error);
      return this.createErrorResult(error as Error, 0);
    }
  }

  /**
   * 构建提示词
   */
  private buildPrompt(brief: string, context?: ArchitectInput["projectContext"]): string {
    let prompt = `Plan the information architecture for this project:\n\n${brief}`;

    if (context?.existingScreens && context.existingScreens.length > 0) {
      prompt += `\n\nExisting screens: ${context.existingScreens.join(", ")}`;
    }

    if (context?.constraints && context.constraints.length > 0) {
      prompt += `\n\nConstraints: ${context.constraints.join("; ")}`;
    }

    prompt += `\n\nProvide a structured architecture plan in JSON format.`;

    return prompt;
  }

  /**
   * 验证架构规范（确保格式正确）
   */
  private validateSpec(spec: ArchitectureSpec): void {
    if (!spec.screens || spec.screens.length === 0) {
      throw new Error("架构规范必须包含至少一个 screen");
    }

    for (const screen of spec.screens) {
      if (!screen.id || !screen.name || !screen.layout) {
        throw new Error(`Screen 缺少必填字段: ${JSON.stringify(screen)}`);
      }

      if (!screen.sections || screen.sections.length === 0) {
        throw new Error(`Screen ${screen.id} 必须包含至少一个 section`);
      }
    }

    if (!spec.navigation || !spec.navigation.type) {
      throw new Error("架构规范必须包含 navigation 定义");
    }

    if (!spec.reasoning) {
      throw new Error("架构规范必须包含推理说明");
    }
  }

  /**
   * 快速规划（跳过 LLM，使用启发式规则）
   */
  async quickPlan(brief: string): Promise<AgentResult<ArchitectureSpec>> {
    this.log("info", "使用快速规划模式（启发式）");

    try {
      const { result, duration } = await this.measureTime(async () => {
        // 简单的启发式规则
        const isSinglePage = brief.toLowerCase().includes("landing") ||
                            brief.toLowerCase().includes("单页");

        const spec: ArchitectureSpec = {
          screens: [
            {
              id: "main",
              name: "Main Page",
              purpose: "Primary content display",
              layout: "hero",
              sections: [
                {
                  id: "hero",
                  type: "hero",
                  description: "Hero section with main message",
                },
                {
                  id: "content",
                  type: "content",
                  description: "Main content area",
                },
                {
                  id: "cta",
                  type: "cta",
                  description: "Call-to-action section",
                },
              ],
            },
          ],
          navigation: {
            type: isSinglePage ? "single-page" : "multi-page",
            structure: "Top navigation bar",
          },
          contentPriority: ["hero", "content", "cta"],
          reasoning: "Quick plan based on heuristics",
        };

        return { spec };
      });

      return this.createSuccessResult(result.spec, duration, undefined, result.spec.reasoning);
    } catch (error) {
      this.log("error", "快速规划失败", error);
      return this.createErrorResult(error as Error, 0);
    }
  }
}

