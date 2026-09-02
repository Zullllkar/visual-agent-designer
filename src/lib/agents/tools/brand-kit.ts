/**
 * brand_kit 工具
 * --------------------------------------------------------------
 * 查询当前项目的品牌套件信息，包括品牌颜色、字体、Logo 资产和品牌语气。
 * Agent 可用此工具在生成设计时保持品牌一致性。
 */

import type { AgentTool, ToolContext, ToolResult } from "./types";

export const brandKitTool: AgentTool = {
  name: "brand_kit",
  description:
    "查询当前项目的品牌套件信息（颜色、字体、Logo、品牌语气），用于保持设计一致性",
  riskLevel: "safe",
  parameters: {
    type: "object",
    properties: {
      section: {
        type: "string",
        enum: ["all", "colors", "typography", "assets", "voice"],
        description: "要查询的品牌套件部分，默认 all",
      },
    },
  },

  async execute(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    if (!ctx.project?.brandKit) {
      return {
        summary: "当前项目没有配置品牌套件。",
        data: { hasBrandKit: false },
      };
    }

    const kit = ctx.project.brandKit;
    const section = (args.section as string) ?? "all";

    if (section === "colors") {
      return {
        summary: `品牌颜色 (${kit.colors.length} 个)`,
        data: { colors: kit.colors },
      };
    }

    if (section === "typography") {
      return {
        summary: `品牌字体: 标题=${kit.typography.heading}, 正文=${kit.typography.body}`,
        data: { typography: kit.typography },
      };
    }

    if (section === "assets") {
      const assets = kit.assets ?? [];
      return {
        summary: `品牌资产 (${assets.length} 个)`,
        data: { assets },
      };
    }

    if (section === "voice") {
      return {
        summary: kit.brandVoice ?? "未定义品牌语气",
        data: {
          brandVoice: kit.brandVoice,
          doList: kit.doList ?? [],
          avoidList: kit.avoidList ?? [],
        },
      };
    }

    return {
      summary: `品牌套件 "${kit.name}": ${kit.colors.length} 颜色, ${kit.assets?.length ?? 0} 资产`,
      data: {
        id: kit.id,
        name: kit.name,
        description: kit.description,
        colors: kit.colors,
        typography: kit.typography,
        assets: kit.assets ?? [],
        brandVoice: kit.brandVoice,
        doList: kit.doList ?? [],
        avoidList: kit.avoidList ?? [],
      },
    };
  },

  async fallback(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    return this.execute(args, ctx);
  },
};
