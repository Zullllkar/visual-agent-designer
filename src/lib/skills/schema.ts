/**
 * SKILL.md / DESIGN.md 协议定义
 * --------------------------------------------------------------
 * 我们的 skill / design system 是文件而非硬编码：
 *
 *   skills/<id>/SKILL.md       一个设计技能（产品原型 / 小红书 / 演示文稿等）
 *   design-systems/<id>/DESIGN.md  一套设计语言（Linear-like / 小红书风 / Apple-like）
 *
 * frontmatter 设计兼容 Claude Code 的 ~/.claude/skills/ 约定
 * （`name`/`description` 字段保持一致），同时扩展设计相关字段
 * （`kind`/`canvas`/`agent`/`atmosphere` 等），让 daemon 能调度 agent 流程。
 *
 * 所有字段都是 zod 验证；缺失字段一律取保守默认。
 */

import { z } from "zod";

// ──────────────────────────────────────────────────────────────────
// SKILL.md
// ──────────────────────────────────────────────────────────────────

/**
 * Skill 类型。决定 orchestrator 走哪条工作流，以及输出 artifact 形态。
 *  - prototype: 产品原型（多页 UI）
 *  - landing:   单页 landing
 *  - mobile:    移动端 app
 *  - dashboard: 后台 dashboard
 *  - xhs:       小红书图文（封面 / 多图）
 *  - deck:      演示文稿（暂未实现）
 *  - template:  模板填充
 */
export const SkillKindSchema = z.enum([
  "prototype",
  "landing",
  "mobile",
  "dashboard",
  "xhs",
  "deck",
  "template",
]);
export type SkillKind = z.infer<typeof SkillKindSchema>;

/** Skill 接受的输入字段（用于 UI 表单和 Discovery） */
export const SkillInputSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "boolean", "image", "select"]),
  required: z.boolean().default(false),
  description: z.string().optional(),
  default: z.unknown().optional(),
  options: z.array(z.string()).optional(),
});
export type SkillInput = z.infer<typeof SkillInputSchema>;

/** Skill 输出 artifact 描述 */
export const SkillOutputSchema = z.object({
  /** 输出 artifact 类型；orchestrator 用它决定渲染方式 */
  artifact: z.enum(["canvas-pages", "xhs-cards", "landing-page"]),
  /** 默认页面尺寸（CanvasPage.width / height） */
  defaultPageSize: z
    .object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .optional(),
  /** 期望的页面数量（仅作为 hint） */
  pageCountHint: z.number().int().positive().optional(),
});

/** Skill 内置的 agent 流程编排（哪些步骤 / 哪些必须） */
export const SkillAgentFlowSchema = z.object({
  /** 启用的步骤；orchestrator 按顺序执行 */
  steps: z
    .array(
      z.enum([
        "brief",
        "architect",
        "design-director",
        "layout",
        "content",
        "image",
        "critic",
        "repair",
      ])
    )
    .default(["brief", "layout", "critic", "repair"]),
  /** 是否需要图像生成（true 则强制走 ImageAgent） */
  imageRequired: z.boolean().default(false),
  /** Critic 阈值（低于此分数触发 repair） */
  repairThreshold: z.number().min(0).max(10).default(8),
  /** 最多 repair 轮数 */
  maxRepairRounds: z.number().int().min(0).default(2),
});

/** SKILL.md frontmatter（可序列化） */
export const SkillManifestSchema = z.object({
  /** 唯一 id；与目录名一致；和 Claude Code skill 兼容 */
  name: z.string().regex(/^[a-z0-9-]+$/),
  /** 简介；和 Claude Code skill 兼容 */
  description: z.string(),
  /** 我们扩展：技能类型 */
  kind: SkillKindSchema,
  /** 可选版本 */
  version: z.string().optional(),
  /** 可选作者 */
  author: z.string().optional(),
  /** 输入 schema */
  inputs: z.array(SkillInputSchema).default([]),
  /** 输出形态 */
  output: SkillOutputSchema,
  /** Agent 编排 */
  agent: SkillAgentFlowSchema.default({
    steps: ["brief", "layout", "critic", "repair"],
    imageRequired: false,
    repairThreshold: 8,
    maxRepairRounds: 2,
  }),
  /** 推荐搭配的 design-system id（用户可改） */
  recommendedDesignSystem: z.string().optional(),
});
export type SkillManifest = z.infer<typeof SkillManifestSchema>;

/** 完整 Skill 资源（含 markdown body） */
export interface Skill {
  /** 来源目录路径（相对项目根） */
  sourcePath: string;
  manifest: SkillManifest;
  /** SKILL.md 正文（去掉 frontmatter 后的 markdown），注入 system prompt */
  body: string;
}

// ──────────────────────────────────────────────────────────────────
// DESIGN.md
// ──────────────────────────────────────────────────────────────────

/**
 * DESIGN.md 9-section schema：参考 Open Design 的设计系统约定
 *   1. Visual Theme & Atmosphere
 *   2. Color Palette & Roles
 *   3. Typography Rules
 *   4. Component Stylings
 *   5. Layout Principles
 *   6. Depth & Elevation
 *   7. Do's and Don'ts
 *   8. Responsive Behavior
 *   9. Agent Prompt Guide
 *
 * frontmatter 只需要描述性元数据；9 节内容在 markdown body 里。
 * 注入 prompt 时整段 body 都会被拼进去。
 */

/** Color role 简写：让 LLM 引用时有稳定 token */
export const DesignTokensSchema = z
  .object({
    primary: z.string().optional(),
    background: z.string().optional(),
    surface: z.string().optional(),
    accent: z.string().optional(),
    textPrimary: z.string().optional(),
    textSecondary: z.string().optional(),
    radius: z.number().optional(),
    fontSans: z.string().optional(),
    fontMono: z.string().optional(),
  })
  .partial();

export const DesignSystemManifestSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string(),
  /** 一句话描述视觉调性，用于 UI 卡片显示 */
  atmosphere: z.string(),
  version: z.string().optional(),
  author: z.string().optional(),
  /** 可选简化 token（让其它 agent 不必读 markdown 也能拿到颜色等） */
  tokens: DesignTokensSchema.optional(),
  /** 适用的 skill kind 列表；空表示全适用 */
  appliesTo: z.array(SkillKindSchema).default([]),
});
export type DesignSystemManifest = z.infer<typeof DesignSystemManifestSchema>;

export interface DesignSystem {
  sourcePath: string;
  manifest: DesignSystemManifest;
  /** DESIGN.md 正文（9-section markdown） */
  body: string;
}
