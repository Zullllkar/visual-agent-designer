/**
 * Orchestrator Planner（LLM 工具规划）
 * --------------------------------------------------------------
 * 用 LLM 输出 JSON 计划（thinking + tools[]），替代纯关键词路由。
 * LLM 不可用或解析失败时回退到规则引擎。
 *
 * @author：wangjunhua
 */

import { nanoid } from "nanoid";
import type { ProjectFile } from "@/lib/project/schema";
import type { ToolCall } from "./chat-schema";
import {
  OrchestratorPlanSchema,
  type OrchestratorToolName,
} from "./plan-schema";
import type { AgentContext } from "./types";
import { stripJsonFence } from "@/lib/providers/llm/openai-compatible";
import { isMockLlmText } from "@/lib/providers/llm/utils";
import { parsePageReference } from "./page-reference";
import { ORCHESTRATOR_TOOLS_FOR_PLANNER } from "./orchestrator-tools";
import { OrchestratorToolNameSchema } from "./plan-schema";

export interface PlannerDecision {
  thinking: string;
  calls: ToolCall[];
}

export interface PlannerHooks {
  /** 规划阶段流式思考（OpenAI-compatible 等支持时） */
  onThinkingDelta?: (text: string) => void;
}

const TOOL_CATALOG = `# 可用工具（按顺序执行，不要重复无关工具）

| name | 何时使用 |
|------|----------|
| generate_brief | 项目无 brief；需要 args.idea |
| plan_design_direction | 有 brief 但无 designDirection |
| generate_images | 有 brief（+可选 designDirection）后生成视觉素材图；用户要求生图/出图/视觉稿 |
| generate_image_variants | 用户要求为已有素材换图、重生成或变体 |
| export_handoff | 用户要求导出/交付给 coding 工具 |
| answer_question | 纯问答，不修改项目 |

规则：
- 本产品是 Lovart 式视觉素材工作台：输出高保真图片资产，不是网页结构代码框
- 空白项目完整链路：generate_brief → plan_design_direction → generate_images
- 不要调用 generate_layout / plan_architecture / polish_content / edit_page / critique_pages / repair_page（已废弃网页结构流程）
- 用户要求导出交付时用 export_handoff
- 仅当用户明确只要文字回答时才用 answer_question
- 输出严格 JSON，不要 markdown 围栏`;

const PLAN_OUTPUT_SHAPE = `# 输出 JSON
\`\`\`json
{
  "thinking": "中文，说明本轮计划",
  "tools": [
    { "name": "generate_brief", "args": { "idea": "..." } }
  ]
}
\`\`\``;

/**
 * 规划本轮工具调用。优先 LLM；失败则用规则 fallback。
 */
export async function planOrchestratorTools(
  project: ProjectFile | null,
  userMessage: string,
  ctx: AgentContext,
  hooks?: PlannerHooks
): Promise<PlannerDecision> {
  const ref = parsePageReference(userMessage.trim());

  await streamPlannerPreamble(ref.cleanText, project, ctx, hooks);

  const nativePlan = await tryNativeToolPlan(
    project,
    ref.cleanText,
    ref,
    ctx
  ).catch(() => null);
  if (nativePlan) return nativePlan;

  const llmPlan = await tryLlmJsonPlan(project, ref.cleanText, ref, ctx).catch(
    () => null
  );
  if (llmPlan) return llmPlan;

  return decideToolsFallback(project, userMessage);
}

/** 流式输出规划前言（与 JSON 计划解耦，更接近 Cursor 思考区） */
async function streamPlannerPreamble(
  cleanText: string,
  project: ProjectFile | null,
  ctx: AgentContext,
  hooks?: PlannerHooks
): Promise<void> {
  if (!hooks?.onThinkingDelta || !ctx.providers.llm.generateTextStream) return;
  const state = summarizeProjectState(project);
  try {
    for await (const chunk of ctx.providers.llm.generateTextStream({
      system:
        "你是 Visual Agent Designer 编排助手。用中文 2-5 句话说明：用户要什么、项目当前状态、你准备调用哪些类型的工具。不要输出 JSON 或 markdown 标题。",
      prompt: JSON.stringify({ userMessage: cleanText, projectState: state }),
    })) {
      if (chunk) hooks.onThinkingDelta(chunk);
    }
    hooks.onThinkingDelta("\n");
  } catch {
    /* 流式失败则依赖后续 JSON thinking */
  }
}

/** OpenAI 原生 function calling */
async function tryNativeToolPlan(
  project: ProjectFile | null,
  cleanText: string,
  ref: ReturnType<typeof parsePageReference>,
  ctx: AgentContext
): Promise<PlannerDecision | null> {
  const llm = ctx.providers.llm;
  if (!llm.supportsToolCalling || !llm.generateWithTools) return null;

  const state = summarizeProjectState(project);
  const system = [
    "你是 Visual Agent Designer 的 Orchestrator Agent。",
    "根据项目状态和用户消息，选择并排序要调用的工具（可一次返回多个 tool_calls）。",
    "不要重复无关工具；完整新项目按 Brief→架构→方向→Layout→润色→生图→评审顺序。",
    TOOL_CATALOG,
  ].join("\n\n");

  const out = await llm.generateWithTools({
    system,
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          projectState: state,
          userMessage: cleanText,
          pageReference: ref.pageId
            ? {
                pageId: ref.pageId,
                pageName: ref.pageName,
                nodeId: ref.nodeId,
              }
            : null,
        }),
      },
    ],
    tools: ORCHESTRATOR_TOOLS_FOR_PLANNER,
  });

  if (out.toolCalls.length === 0) {
    if (out.thinking || out.text) {
      return {
        thinking: out.thinking ?? out.text ?? "直接回答。",
        calls: [
          {
            id: nanoid(8),
            name: "answer_question",
            args: { question: cleanText },
          },
        ],
      };
    }
    return null;
  }

  const calls: ToolCall[] = [];
  for (const tc of out.toolCalls) {
    const parsedName = OrchestratorToolNameSchema.safeParse(tc.name);
    if (!parsedName.success) continue;
    calls.push({
      id: nanoid(8),
      name: parsedName.data,
      args: enrichToolArgs(parsedName.data, tc.arguments, cleanText, ref, project),
    });
  }

  if (calls.length === 0) return null;

  return {
    thinking: out.thinking ?? out.text ?? `计划执行 ${calls.length} 个工具。`,
    calls,
  };
}

async function tryLlmJsonPlan(
  project: ProjectFile | null,
  cleanText: string,
  ref: ReturnType<typeof parsePageReference>,
  ctx: AgentContext
): Promise<PlannerDecision | null> {
  const state = summarizeProjectState(project);
  const system = [
    "你是 Visual Agent Designer 的 Orchestrator Agent。",
    "根据项目状态和用户消息，决定本轮要调用的工具序列。",
    TOOL_CATALOG,
    PLAN_OUTPUT_SHAPE,
  ].join("\n\n");

  const userPayload = {
    projectState: state,
    userMessage: cleanText,
    pageReference: ref.pageId
      ? {
          pageId: ref.pageId,
          pageName: ref.pageName,
          nodeId: ref.nodeId,
          nodeLabel: ref.nodeLabel,
        }
      : null,
  };

  const out = await ctx.providers.llm.generateText({
    system,
    prompt: `规划工具序列，输出 JSON：\n${JSON.stringify(userPayload, null, 2)}`,
    schema: { type: "object" },
  });

  if (isMockLlmText(out.text)) return null;

  let json: unknown;
  try {
    json = JSON.parse(stripJsonFence(out.text));
  } catch {
    return null;
  }

  const parsed = OrchestratorPlanSchema.safeParse(json);
  if (!parsed.success) return null;

  const calls: ToolCall[] = parsed.data.tools.map((t) => ({
    id: nanoid(8),
    name: t.name as ToolCall["name"],
    args: enrichToolArgs(t.name, t.args, cleanText, ref, project),
  }));

  return {
    thinking: parsed.data.thinking,
    calls: calls.length > 0 ? calls : [],
  };
}

function enrichToolArgs(
  name: OrchestratorToolName,
  args: Record<string, unknown> | undefined,
  cleanText: string,
  ref: ReturnType<typeof parsePageReference>,
  project: ProjectFile | null
): Record<string, unknown> | undefined {
  void project;
  const base = { ...args };
  if (name === "generate_brief" && !base.idea) {
    base.idea = cleanText;
  }
  if (name === "repair_page" && ref.pageId) {
    base.targetPageId = ref.pageId;
    if (ref.nodeId) {
      base.targetNodeId = ref.nodeId;
      base.targetNodeLabel = ref.nodeLabel;
    }
  }
  if (name === "edit_page") {
    base.instruction = cleanText;
    if (ref.pageId) base.targetPageId = ref.pageId;
    if (ref.nodeId) {
      base.targetNodeId = ref.nodeId;
      base.targetNodeLabel = ref.nodeLabel;
    }
  }
  if (name === "generate_image_variants") {
    base.prompt = cleanText;
    if (ref.pageId) base.targetPageId = ref.pageId;
    if (ref.nodeId) {
      base.targetNodeId = ref.nodeId;
      base.targetNodeLabel = ref.nodeLabel;
    }
    if (!base.n) base.n = 4;
  }
  if (name === "restyle_page_images") {
    base.instruction = cleanText;
    if (ref.pageId) base.targetPageId = ref.pageId;
    if (!base.n) base.n = 1;
  }
  if (name === "answer_question") {
    base.question = cleanText;
    if (ref.pageId) base.focusPageId = ref.pageId;
    if (ref.pageName) base.focusPageName = ref.pageName;
  }
  if (name === "critique_pages" && ref.pageId) {
    base.focusPageId = ref.pageId;
  }
  return Object.keys(base).length > 0 ? base : undefined;
}

function summarizeProjectState(project: ProjectFile | null) {
  if (!project) {
    return { empty: true };
  }
  const pendingImages = project.pages.reduce((n, p) => {
    return (
      n +
      p.nodes.filter(
        (node) =>
          node.type === "image" &&
          (node.generation?.model === "pending" ||
            node.src?.startsWith("data:image/svg+xml"))
      ).length
    );
  }, 0);

  return {
    hasBrief: !!project.brief,
    hasArchitecture: !!project.architecture,
    hasDesignDirection: !!project.designDirection,
    pageCount: project.pages.length,
    pendingImageNodes: pendingImages,
    critiqueScore: project.critique?.overallScore ?? null,
    skillId: project.skillId,
    designSystemId: project.designSystemId,
  };
}

/** 规则引擎 fallback（原 decideTools 逻辑，扩展新工具）。 */
export function decideToolsFallback(
  project: ProjectFile | null,
  userMessage: string
): PlannerDecision {
  const ref = parsePageReference(userMessage.trim());
  const text = ref.cleanText;
  const refSuffix = ref.pageId ? `（引用：${ref.nodeLabel ?? ref.pageId}）` : "";

  // 空白 / 半成品项目 → 视觉素材流水线（不生成网页结构）
  if (!project || !project.brief) {
    return {
      thinking: "从想法开始：Brief → 视觉方向 → 生成视觉素材图。",
      calls: [
        tool("generate_brief", { idea: text }),
        tool("plan_design_direction"),
        tool("generate_images"),
      ],
    };
  }

  if (!project.designDirection) {
    return {
      thinking: "补充视觉方向后生成素材。",
      calls: [tool("plan_design_direction"), tool("generate_images")],
    };
  }

  const assetCount = (project.assets ?? []).filter(
    (a) => a.status !== "discarded"
  ).length;

  if (assetCount === 0 || /生图|出图|视觉|素材|图片|生成/.test(text)) {
    return {
      thinking: "生成高保真视觉素材（不产出网页结构框）。",
      calls: [tool("generate_images")],
    };
  }

  if (/导出|handoff|交付|cursor|claude|codex/i.test(text)) {
    const target = /cursor/i.test(text)
      ? "cursor"
      : /claude/i.test(text)
        ? "claude-code"
        : /codex/i.test(text)
          ? "codex"
          : "markdown";
    return {
      thinking: `编译视觉素材交付包（${target}）。`,
      calls: [tool("export_handoff", { target })],
    };
  }

  if (/变体|换图|重生成|重新生成|局部重绘|改这张|编辑这张/.test(text)) {
    return {
      thinking: `为现有素材生成变体/局部重绘${refSuffix}。`,
      calls: [tool("generate_image_variants")],
    };
  }

  return {
    thinking: "继续补充视觉素材。",
    calls: [tool("generate_images")],
  };
}

function tool(
  name: ToolCall["name"],
  args?: Record<string, unknown>
): ToolCall {
  return { id: nanoid(8), name, args };
}

/**
 * 首轮规划执行后，若项目仍处于半成品且用户非纯问答，自动补全流水线缺口（最多一轮）。
 */
export function getPipelineContinuationTools(
  project: ProjectFile | null,
  userMessage: string,
  executed: ReadonlySet<ToolCall["name"]>
): ToolCall[] {
  const text = userMessage.trim();
  if (executed.has("answer_question")) return [];
  if (executed.has("edit_page")) return [];
  if (executed.has("generate_image_variants")) return [];
  if (executed.has("restyle_page_images")) return [];
  if (/^(什么|如何|为什么|是否|what|how|why|is |are )/i.test(text)) {
    return [];
  }
  if (/导出|handoff|交付/i.test(text) && executed.has("export_handoff")) {
    return [];
  }

  const calls: ToolCall[] = [];
  const idea = text || project?.rawIdea || "未命名产品";

  if (!project?.brief && !executed.has("generate_brief")) {
    calls.push(tool("generate_brief", { idea }));
  }
  if (
    project?.brief &&
    !project.designDirection &&
    !executed.has("plan_design_direction")
  ) {
    calls.push(tool("plan_design_direction"));
  }
  const assetCount = (project?.assets ?? []).filter(
    (a) => a.status !== "discarded"
  ).length;
  if (
    project?.brief &&
    project.designDirection &&
    assetCount === 0 &&
    !executed.has("generate_images")
  ) {
    calls.push(tool("generate_images"));
  }

  return calls;
}

/** 无 LLM 时的默认首轮计划（空白项目 → 视觉素材） */
export function buildDefaultPlan(idea: string): PlannerDecision {
  return {
    thinking: "从想法开始：Brief → 视觉方向 → 生成视觉素材。",
    calls: [
      tool("generate_brief", { idea }),
      tool("plan_design_direction"),
      tool("generate_images"),
    ],
  };
}
