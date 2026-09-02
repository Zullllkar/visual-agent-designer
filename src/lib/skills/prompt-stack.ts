/**
 * Prompt Stack 组合器
 * --------------------------------------------------------------
 * 把分散在不同地方的 prompt 片段按固定顺序拼成一个 system prompt：
 *
 *   [BASE_DESIGNER_SYSTEM]
 *     + [DISCOVERY directives]      （告诉 agent 不要直接画，先问）
 *     + [active SKILL.md body]      （当前任务做什么）
 *     + [active DESIGN.md body]     （用什么品牌设计语言）
 *     + [project context]           （现有 brief / pages / chat 历史）
 *
 * 任何 agent（layout / repair / chat orchestrator）都通过这个组合器
 * 拿到 system prompt，确保 prompt 行为可解释、可调试、可热替换。
 *
 * 这个文件可以在 server / client 都用（纯字符串拼接）。
 */

import type { CritiqueReport } from "@/lib/agents/critic-schema";
import type { CanvasPage } from "@/lib/canvas/schema";
import { summarizeDesignContext } from "@/lib/project/design-context";
import type { DesignContext, ProductBrief } from "@/lib/project/schema";
import { buildBriefOutputShape } from "@/lib/targets/brief";
import { getTargetRecipe, type TargetId } from "@/lib/targets/catalog";
import { buildGoalPromptSection, parseTargetId } from "@/lib/targets/resolve";
import { formatSkillRuntime } from "./runtime";
import type { DesignSystem, Skill } from "./schema";

const BASE_DESIGNER_SYSTEM = `你是 Vibeboard 的产品设计 Agent。

# 身份
- 你是产品设计师，而不是普通聊天助手
- 你的职责是把用户的产品想法变成可编辑的 UI 画布、图片资产、设计文档和 coding agent 的开发上下文
- 你不写实现代码；coding agent（Cursor / Claude Code / Codex）才负责写代码

# 行为准则
- 输出必须严格符合 Skill 指定的 schema（zod 校验，错了被 reject）
- 不要 freestyle 颜色 / 字体 / 圆角；遵循 active DESIGN.md 的 token
- 文案必须真实反映 brief，禁止占位符（"卡片标题 A"、"Lorem ipsum"）
- 工具调用前简要说明意图；调用后用一两句话总结结果
- 不要重复用户的话；不要无效寒暄`;

const DISCOVERY_DIRECTIVES = `# Discovery
当 brief 信息不足时（缺平台 / 用户 / 视觉风格 / 输出目标），先用一两个问题补全，再开始生成。
不要在信息缺失时硬猜。`;

export interface BuildPromptOptions {
  /** 当前激活技能；可选——某些底层场景（如 BriefAgent 在没选 skill 前）可不带 */
  skill?: Skill | null;
  /** 当前激活设计系统；可选 */
  designSystem?: DesignSystem | null;
  /** 当前 brief（已生成时携带） */
  brief?: ProductBrief;
  /** 项目级设计记忆，用于跨轮保持品牌、视觉、组件一致性。 */
  designContext?: DesignContext | null;
  /** 任意补充上下文（例如选中的 element_id、当前页 id 等） */
  extra?: Record<string, unknown>;
  /** 项目视觉目标；与对话 system prompt 共用同一份 recipe。 */
  targetId?: string;
  directionCardId?: string;
  /** 是否包含 Discovery 段（chat orchestrator 第一轮用 true，后续可关掉） */
  includeDiscovery?: boolean;
  /**
   * 调用方追加的技术性段落（输出 schema、节点类型、JSON 格式约束）。
   * 由 agent 自己提供，避免污染 SKILL.md 的语义层。
   */
  technicalAddendum?: string;
}

/**
 * 拼出最终 system prompt。
 *
 * 拼装顺序（固定）：
 *   1. BASE_DESIGNER_SYSTEM     身份与行为准则
 *   2. DISCOVERY_DIRECTIVES     (可关) 不要 freestyle
 *   3. Active Skill              SKILL.md body
 *   4. Active Design System     DESIGN.md body
 *   5. Project Brief             已有 brief 时携带
 *   6. Technical Addendum       (agent 私有) 输出 schema / 节点定义
 *   7. Extra Context             运行时上下文（页 id / 选中节点 / issues）
 */
export function buildSystemPrompt(opts: BuildPromptOptions): string {
  const parts: string[] = [BASE_DESIGNER_SYSTEM];

  if (opts.includeDiscovery !== false) {
    parts.push(DISCOVERY_DIRECTIVES);
  }

  parts.push(
    buildGoalPromptSection(parseTargetId(opts.targetId), opts.directionCardId)
  );

  if (opts.skill) {
    parts.push(
      `# Active Skill: ${opts.skill.manifest.name}\n${opts.skill.body}`
    );
    const recipe = getTargetRecipe(parseTargetId(opts.targetId));
    parts.push(
      `# Skill runtime\n${formatSkillRuntime({
        skillSize: opts.skill.manifest.output.defaultPageSize,
        targetSize: recipe.canvas,
        repairThreshold: opts.skill.manifest.agent.repairThreshold,
      })}`,
    );
  }

  if (opts.designSystem) {
    parts.push(
      `# Active Design System: ${opts.designSystem.manifest.name}\n${opts.designSystem.body}`
    );
  }

  if (opts.brief) {
    parts.push(
      `# Project Brief\n\`\`\`json\n${JSON.stringify(opts.brief, null, 2)}\n\`\`\``
    );
  }

  if (opts.designContext) {
    parts.push(
      `# Design Context Memory\n${summarizeDesignContext(opts.designContext)}\n\n\`\`\`json\n${JSON.stringify(opts.designContext, null, 2)}\n\`\`\``
    );
  }

  if (opts.technicalAddendum) {
    parts.push(opts.technicalAddendum);
  }

  if (opts.extra && Object.keys(opts.extra).length > 0) {
    parts.push(
      `# Extra Context\n\`\`\`json\n${JSON.stringify(opts.extra, null, 2)}\n\`\`\``
    );
  }

  return parts.join("\n\n---\n\n");
}

// ──────────────────────────────────────────────────────────────────
// 共享技术片段（不属于 SKILL.md 的语义层；纯输出约束）
// ──────────────────────────────────────────────────────────────────

const CANVAS_NODE_SCHEMA = `# Canvas 节点 schema
- 坐标系：原点左上 (0,0)，单位 px
- 节点类型（5 种）：
  - frame:  {type, x, y, width, height, fill?, radius?}
  - text:   {type, x, y, width, height, content, fontSize?, fontWeight?(100-900), color?, align?(left|center|right)}
  - image:  {type, x, y, width, height, imagePrompt, radius?}    ← imagePrompt 是给图像模型的英文 prompt，不要硬编码 src
  - button: {type, x, y, width, height, label, fill?, color?, radius?}
  - card:   {type, x, y, width, height, title?, body?, fill?, radius?}
- 所有节点 x/y/width/height 必须落在页面内
- 字号 11-32：标题 22-32 / 正文 13-16 / 说明 11-12
- id 由系统生成，禁止输出 id 字段`;

const LAYOUT_OUTPUT_SHAPE = `# Layout 输出 JSON 结构
\`\`\`json
{
  "pages": [
    { "name": "...", "width": <int>, "height": <int>, "background": "#...", "nodes": [ ... ] }
  ]
}
\`\`\`
严格输出 JSON，不要 markdown 围栏，不要解释。`;

const REPAIR_OUTPUT_SHAPE = `# Repair 输出 JSON 结构（单页）
\`\`\`json
{ "name": "...", "width": <int>, "height": <int>, "background": "#...", "nodes": [ ... ] }
\`\`\`
严格输出 JSON，不要 markdown 围栏，不要解释。`;

const REPAIR_PATCH_OUTPUT_SHAPE = `# Repair Patch 输出 JSON 结构
\`\`\`json
{
  "operations": [
    { "op": "updatePage", "patch": { "name": "...", "background": "#..." } },
    { "op": "updateNode", "nodeId": "<现有节点 id>", "patch": { "x": 12, "y": 24, "width": 100, "height": 40, "content": "...", "fill": "#..." } },
    { "op": "deleteNode", "nodeId": "<现有节点 id>" }
  ]
}
\`\`\`
严格输出 JSON，不要 markdown 围栏，不要解释。`;

const CRITIQUE_OUTPUT_SHAPE = `# Critique 输出 JSON 结构
\`\`\`json
{
  "pageId": "<原值>",
  "score": <0-10 数字>,
  "summary": "一两句中文总评",
  "issues": [
    {
      "severity": "low|medium|high",
      "category": "hierarchy|spacing|typography|color|content|overlap|overflow|brand|consistency",
      "message": "中文说明",
      "affectedNodeIds": ["<节点 id>"],
      "suggestion": "中文改进建议（可选）"
    }
  ]
}
\`\`\`
严格输出 JSON，不要 markdown，不要解释。`;

// ──────────────────────────────────────────────────────────────────
// 特化构建器：每个 agent 一个，把技术 addendum 内置
// ──────────────────────────────────────────────────────────────────

export interface AgentPromptOpts {
  skill?: Skill | null;
  designSystem?: DesignSystem | null;
  brief?: ProductBrief;
  designContext?: DesignContext | null;
  targetId?: TargetId | string;
  /** 运行时上下文（架构、视觉方向等） */
  extra?: Record<string, unknown>;
}

/** BriefAgent：还没生成 brief 之前用，按目标裁剪字段 */
export function buildBriefSystemPrompt(opts: AgentPromptOpts): string {
  const targetId = parseTargetId(opts.targetId);
  return buildSystemPrompt({
    ...opts,
    technicalAddendum: buildBriefOutputShape(targetId),
    includeDiscovery: false,
  });
}

/** LayoutAgent：生成多页 canvas */
export function buildLayoutSystemPrompt(opts: AgentPromptOpts): string {
  return buildSystemPrompt({
    skill: opts.skill,
    designSystem: opts.designSystem,
    brief: opts.brief,
    designContext: opts.designContext,
    extra: opts.extra,
    technicalAddendum: `${CANVAS_NODE_SCHEMA}\n\n${LAYOUT_OUTPUT_SHAPE}`,
  });
}

/** RepairAgent：根据 issues 修复单页 */
export function buildRepairSystemPrompt(
  opts: AgentPromptOpts & { page: CanvasPage; report: CritiqueReport }
): string {
  const { page, report, ...rest } = opts;
  const issuesDigest = report.issues.map((i) => ({
    severity: i.severity,
    category: i.category,
    message: i.message,
    suggestion: i.suggestion,
    affectedNodeIds: i.affectedNodeIds,
  }));
  return buildSystemPrompt({
    ...rest,
    technicalAddendum: `${CANVAS_NODE_SCHEMA}\n\n${REPAIR_OUTPUT_SHAPE}\n\n# Repair 原则
- 保持页面 width/height 不变
- 保留主语义节点（标题、卡片、按钮、hero 图）
- overflow: 缩小或移动到 x+width ≤ width 且 y+height ≤ height
- overlap: 调整 y 坐标使节点上下排列，留至少 8px 间距
- typography: 字号 <10 调到 12+，>32 调到 32 以下
- color: 调整 fill / color 增大对比度，匹配 active DESIGN.md
- content: 用 brief.coreFeatures / scenarios 替换占位文案
- image 节点保留 imagePrompt`,
    extra: { currentPage: page, issues: issuesDigest, summary: report.summary },
  });
}

export function buildRepairPatchSystemPrompt(
  opts: AgentPromptOpts & { page: CanvasPage; report: CritiqueReport }
): string {
  const { page, report, ...rest } = opts;
  const issuesDigest = report.issues.map((i) => ({
    severity: i.severity,
    category: i.category,
    message: i.message,
    suggestion: i.suggestion,
    affectedNodeIds: i.affectedNodeIds,
  }));
  return buildSystemPrompt({
    ...rest,
    technicalAddendum: `${CANVAS_NODE_SCHEMA}\n\n${REPAIR_PATCH_OUTPUT_SHAPE}\n\n# Patch Repair 原则
- 优先 updateNode，尽量不要 deleteNode
- 只能引用 currentPage.nodes 中已存在的 nodeId
- updateNode.patch 不要包含 id / type
- 保持页面 width/height 不变
- 坐标和尺寸必须保持节点在页面内`,
    extra: { currentPage: page, issues: issuesDigest, summary: report.summary },
  });
}

/** CriticAgent (text 模式)：评分一页 */
export function buildCriticSystemPrompt(opts: AgentPromptOpts): string {
  return buildSystemPrompt({
    ...opts,
    technicalAddendum: `${CRITIQUE_OUTPUT_SHAPE}\n\n# 评审维度
- hierarchy: 标题/正文/CTA 是否有清晰区分
- typography: 字号字重组合是否合理
- color: 配色是否匹配 active DESIGN.md，对比度是否足够
- content: 文案是否真实反映 brief.coreFeatures，无占位
- brand: 视觉是否贴合 active DESIGN.md 的 atmosphere
- consistency: 与同项目其它页面是否一致

# 评分尺度
- 9-10: 视觉清晰、品牌一致、无可指摘
- 7-8:  整体可用，少数细节可优化
- 5-6:  可识别但视觉松散 / 文案薄弱 / 与 brief 不够吻合
- 0-4:  存在严重问题（重叠 / 越界 / 文案占位 / 与 brief 完全脱节）`,
  });
}

/** CriticAgent (vision 模式)：基于 PNG 截图评分 */
export function buildVisionCriticSystemPrompt(opts: AgentPromptOpts): string {
  return buildSystemPrompt({
    ...opts,
    technicalAddendum: `${CRITIQUE_OUTPUT_SHAPE}\n\n# Vision 评审准则
- 你能直接看到页面的真实 PNG 截图
- 评审"图像呈现"层面的问题：视觉重心、留白、对比度、可读性、品牌一致
- 注意 JSON 数据无法暴露的视觉缺陷：截断/糊/挤压/对齐错位/颜色差异
- 给出 0-10 分（视觉品质 vs 与 active DESIGN.md 描述的匹配度）
- issue.message 必须基于你看到的图像，不是从 JSON 推断`,
  });
}
