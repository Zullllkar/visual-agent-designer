/**
 * Orchestrator planner.
 *
 * Deprecated fallback layer for the LangGraph ReAct agent. It is still used
 * when the main agent cannot plan with native tool calls.
 */

import { nanoid } from "nanoid";
import type { ProjectFile } from "@/lib/project/schema";
import type { ToolCall } from "./chat-schema";
import {
  OrchestratorPlanSchema,
  OrchestratorToolNameSchema,
  type OrchestratorToolName,
} from "./plan-schema";
import type { AgentContext } from "./types";
import { stripJsonFence } from "@/lib/providers/llm/openai-compatible";
import { isMockLlmText } from "@/lib/providers/llm/utils";
import { registerAllTools, toolRegistry } from "./tools";
import type { LlmToolDefinition } from "@/lib/providers/llm/tool-types";
import { parseRequestedImageCount } from "./tools/utils";
import { parseImageGenerationConfirmation } from "./image-generation-confirmation";
import {
  isChatInlineTool,
  isExplicitVisualWorkRequest,
  isLikelyPureQuestion,
} from "./chat-inline-tools";
import {
  buildDefaultDiscoveryForm,
  buildDirectionAdjustForm,
  buildProductReferenceForm,
  buildTargetConflictForm,
  isDirectionAdjustMessage,
  isDirectionConfirmMessage,
  isDiscoveryAnswerMessage,
  isSkipDiscoveryInstruction,
  isTargetChangeMessage,
  shouldAskDiscovery,
} from "./discovery-gate";
import { isAdoptAssetStyleMessage } from "./adopt-asset-style";
import {
  productShotNeedsReference,
  resolveTargetId,
  targetConflict,
} from "@/lib/targets/resolve";

export function parsePageReference(raw: string): {
  pageId?: string;
  pageName?: string;
  nodeId?: string;
  nodeLabel?: string;
  assetId?: string;
  assetName?: string;
  /** Composer / 消息前缀点名的参考图 id */
  referenceIds: string[];
  referenceLabels: string[];
  cleanText: string;
} {
  let rest = raw.trim();
  const result: {
    pageId?: string;
    pageName?: string;
    nodeId?: string;
    nodeLabel?: string;
    assetId?: string;
    assetName?: string;
    referenceIds: string[];
    referenceLabels: string[];
    cleanText: string;
  } = {
    referenceIds: [],
    referenceLabels: [],
    cleanText: rest,
  };

  let guard = 0;
  while (rest && guard++ < 16) {
    const asset = rest.match(/^【引用素材\s*[:：]?\s*([^#】]+)#([\w-]+)】\s*/);
    if (asset && !result.assetId) {
      result.assetName = asset[1].trim();
      result.assetId = asset[2].trim();
      rest = rest.slice(asset[0].length).trim();
      continue;
    }

    const element = rest.match(
      /^【引用元素\s*[:：]?\s*([^#】]+)#([\w-]+)\/([^#】]+)#([\w-]+)】\s*/
    );
    if (element && !result.pageId) {
      result.pageName = element[1].trim();
      result.pageId = element[2].trim();
      result.nodeLabel = element[3].trim();
      result.nodeId = element[4].trim();
      rest = rest.slice(element[0].length).trim();
      continue;
    }

    const page = rest.match(/^【引用页面\s*[:：]?\s*([^#】]+)#([\w-]+)】\s*/);
    if (page && !result.pageId) {
      result.pageName = page[1].trim();
      result.pageId = page[2].trim();
      rest = rest.slice(page[0].length).trim();
      continue;
    }

    const refImg = rest.match(/^【参考图\s*[:：]?\s*([^#】]+)#([\w-]+)】\s*/);
    if (refImg) {
      result.referenceLabels.push(refImg[1].trim());
      result.referenceIds.push(refImg[2].trim());
      rest = rest.slice(refImg[0].length).trim();
      continue;
    }

    break;
  }

  result.cleanText = rest;
  return result;
}

function getOrchestratorToolsForPlanner(): LlmToolDefinition[] {
  registerAllTools();
  return toolRegistry
    .toToolDefinitions()
    .filter((tool) => !isChatInlineTool(tool.name));
}

export interface PlannerDecision {
  thinking: string;
  calls: ToolCall[];
  /** chat = 直接文字回答，不执行工具；tools = 默认工具编排 */
  mode?: "chat" | "tools";
}

function asChatDecision(thinking: string): PlannerDecision {
  return {
    mode: "chat",
    thinking: thinking || "根据当前项目上下文直接回答用户问题。",
    calls: [],
  };
}

export interface PlannerHooks {
  onThinkingDelta?: (text: string) => void;
}

const TOOL_CATALOG = `# Available tools

| name | When to use |
|------|-------------|
| ask_discovery | Blank project and the brief lacks product type or visual style. Prefill ≤5 questions, then stop. |
| generate_brief | No product brief exists. Requires args.idea. |
| plan_design_direction | Brief exists but visual direction is missing. |
| confirm_direction | After plan_design_direction, before generate_images. Stop after this tool. |
| adopt_asset_style | User wants the selected picture to become the project visual style ([采用素材风格]). |
| generate_images | Generate high-fidelity visual image assets after the user confirms direction. |
| generate_image_variants | Regenerate, replace, or make variants for existing assets. |
| materialize_mockup | User is satisfied with a screen mockup: lock it and decompose Layout IR first (default skipGeneration). Only generate materials after user confirms (generateMaterials:true). |
| export_handoff | Export/handoff to coding tools. Prefer materialize_mockup first when high-fidelity code handoff is needed. |

Rules:
- This product is a Lovart-style visual asset workspace. It outputs high-fidelity image assets, not page-structure JSON.
- Blank project: if the brief already has product type AND visual style, skip ask_discovery and run generate_brief -> plan_design_direction -> confirm_direction. Otherwise call ask_discovery only and stop.
- Never call generate_images in the same turn as ask_discovery or confirm_direction.
- High-fidelity coding handoff: materialize_mockup (skipGeneration, await user confirm) -> materialize_mockup(generateMaterials:true) -> export_handoff.
- Do not call removed page-structure tools for visual requests.
- Pure questions / discussion / prioritization: return tools:[] (chat mode). Do not invent answer_question.
- If the user does not explicitly request multiple images, generate one image.
- Never pass count/n to repeat one prompt. Multiple images require prompts[] with one distinct prompt each.
- Never answer visual generation requests with a normal text prompt preview. Use generate_images first; that tool creates the UI approval card.
- Return strict JSON when JSON planning is requested.`;

const PLAN_OUTPUT_SHAPE = `# Output JSON
\`\`\`json
{
  "thinking": "Chinese explanation of this turn's plan",
  "tools": [
    { "name": "generate_brief", "args": { "idea": "..." } }
  ]
}
\`\`\``;

export async function planOrchestratorTools(
  project: ProjectFile | null,
  userMessage: string,
  ctx: AgentContext,
  hooks?: PlannerHooks
): Promise<PlannerDecision> {
  const ref = parsePageReference(userMessage.trim());
  if (ref.referenceIds.length > 0) {
    ctx.scratch.composerReferenceIds = ref.referenceIds;
    ctx.scratch.composerReferenceLabels = ref.referenceLabels;
  }

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
        "You are the Vibeboard orchestrator. In Chinese, explain in 2-5 sentences what the user wants, the current project state, and which tool category you will use. Do not output JSON or markdown headings.",
      prompt: JSON.stringify({ userMessage: cleanText, projectState: state }),
    })) {
      if (chunk) hooks.onThinkingDelta(chunk);
    }
    hooks.onThinkingDelta("\n");
  } catch {
    /* Streaming preamble is optional; later planner output is enough. */
  }
}

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
    "You are the Vibeboard Orchestrator Agent.",
    "Choose and order the tools needed for this turn based on project state and user message.",
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
          assetReference: ref.assetId
            ? { assetId: ref.assetId, assetName: ref.assetName }
            : null,
          attachedReferences:
            ref.referenceIds.length > 0
              ? ref.referenceIds.map((id, index) => ({
                  id,
                  label: ref.referenceLabels[index],
                }))
              : null,
        }),
      },
    ],
    tools: getOrchestratorToolsForPlanner(),
  });

  if (out.toolCalls.length === 0) {
    if (isExplicitVisualWorkRequest(cleanText)) {
      return decideToolsFallback(project, cleanText);
    }
    if (
      out.thinking ||
      out.text ||
      isLikelyPureQuestion(cleanText) ||
      !isVisualGenerationRequest(cleanText)
    ) {
      return asChatDecision(out.thinking ?? out.text ?? "直接回答用户问题。");
    }
    return decideToolsFallback(project, cleanText);
  }

  const calls: ToolCall[] = [];
  for (const tc of out.toolCalls) {
    const parsedName = OrchestratorToolNameSchema.safeParse(tc.name);
    if (!parsedName.success) continue;
    if (isChatInlineTool(parsedName.data)) continue;
    calls.push({
      id: nanoid(8),
      name: parsedName.data,
      args: enrichToolArgs(parsedName.data, tc.arguments, cleanText, ref, project),
    });
  }

  if (calls.length === 0) {
    if (isExplicitVisualWorkRequest(cleanText)) {
      return decideToolsFallback(project, cleanText);
    }
    return asChatDecision(
      out.thinking ?? out.text ?? "直接回答用户问题。"
    );
  }

  return {
    mode: "tools",
    thinking: out.thinking ?? out.text ?? `Planned ${calls.length} tool call(s).`,
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
    "You are the Vibeboard Orchestrator Agent.",
    "Decide which tools to call for this turn.",
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
    assetReference: ref.assetId
      ? { assetId: ref.assetId, assetName: ref.assetName }
      : null,
  };

  const out = await ctx.providers.llm.generateText({
    system,
    prompt: `Plan tool sequence and output JSON:\n${JSON.stringify(userPayload, null, 2)}`,
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

  const calls: ToolCall[] = parsed.data.tools
    .filter((item) => !isChatInlineTool(item.name))
    .map((item) => ({
      id: nanoid(8),
      name: item.name as ToolCall["name"],
      args: enrichToolArgs(item.name, item.args, cleanText, ref, project),
    }));

  if (calls.length === 0) {
    if (isExplicitVisualWorkRequest(cleanText)) {
      return decideToolsFallback(project, cleanText);
    }
    return asChatDecision(parsed.data.thinking || "直接回答用户问题。");
  }

  return {
    mode: "tools",
    thinking: parsed.data.thinking,
    calls,
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
  if (name === "generate_images") {
    const requestedCount = parseRequestedImageCount(cleanText);
    if (requestedCount != null) {
      base.count = requestedCount;
      delete base.n;
    } else if (base.count == null && base.n == null) {
      base.count = 1;
    }
    if (ref.referenceIds.length > 0 && base.referenceIds == null) {
      base.referenceIds = ref.referenceIds;
    }
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
    if (ref.assetId) base.targetAssetId = ref.assetId;
    if (ref.pageId) base.targetPageId = ref.pageId;
    if (ref.nodeId) {
      base.targetNodeId = ref.nodeId;
      base.targetNodeLabel = ref.nodeLabel;
    }
    const requestedCount = parseRequestedImageCount(cleanText);
    if (requestedCount != null) {
      base.n = requestedCount;
      delete base.count;
    } else if (base.n == null && base.count == null) {
      base.n = 1;
    }
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
  const pendingImages = project.pages.reduce((count, page) => {
    return (
      count +
      page.nodes.filter(
        (node) =>
          node.type === "image" &&
          (node.generation?.model === "pending" ||
            node.src?.startsWith("data:image/svg+xml"))
      ).length
    );
  }, 0);

  const references = project.references ?? [];
  return {
    hasBrief: !!project.brief,
    hasArchitecture: !!project.architecture,
    hasDesignDirection: !!project.designDirection,
    pageCount: project.pages.length,
    pendingImageNodes: pendingImages,
    critiqueScore: project.critique?.overallScore ?? null,
    skillId: project.skillId,
    designSystemId: project.designSystemId,
    referenceCount: references.length,
    recentReferences: references
      .slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 3)
      .map((ref) => ({ id: ref.id, label: ref.label, source: ref.source })),
  };
}

export function decideToolsFallback(
  project: ProjectFile | null,
  userMessage: string
): PlannerDecision {
  const ref = parsePageReference(userMessage.trim());
  const text = ref.cleanText;
  const imageConfirmation = parseImageGenerationConfirmation(text);
  const requestedImageCount = parseRequestedImageCount(text);
  const imageArgs =
    imageConfirmation.confirmed
      ? {
          confirmed: true,
          prompt: imageConfirmation.prompt,
          count: imageConfirmation.count ?? requestedImageCount ?? 1,
        }
      : requestedImageCount != null
        ? { count: requestedImageCount }
        : undefined;
  const refSuffix = ref.assetId
    ? ` (asset: ${ref.assetName ?? ref.assetId})`
    : ref.pageId
      ? ` (reference: ${ref.nodeLabel ?? ref.pageId})`
      : "";

  const targetId = resolveTargetId(project);

  if (imageConfirmation.confirmed) {
    if (productShotNeedsReference(project)) {
      return {
        mode: "tools",
        thinking: "产品图没有参考，先停，不要脑补商品。",
        calls: [tool("ask_discovery", { ...buildProductReferenceForm() })],
      };
    }
    return {
      mode: "tools",
      thinking: "用户已确认生图提示词，开始执行图片生成任务。",
      calls: [tool("generate_images", imageArgs)],
    };
  }

  if (isDirectionConfirmMessage(text)) {
    if (project?.designDirection?.styleSourceAssetId) {
      return asChatDecision("项目风格已按选中画面锁定，无需再生成一批新图。");
    }
    return {
      mode: "tools",
      thinking: "用户已确认视觉方向，开始生成视觉素材。",
      calls: [tool("generate_images", imageArgs)],
    };
  }

  if (isAdoptAssetStyleMessage(text) || isAdoptAssetStyleMessage(userMessage)) {
    return {
      mode: "tools",
      thinking: "用户要用选中画面锁定项目风格，并统一其余素材。",
      calls: [
        tool("adopt_asset_style", {
          ...(ref.assetId ? { assetId: ref.assetId } : {}),
        }),
      ],
    };
  }

  if (isTargetChangeMessage(text)) {
    return {
      mode: "tools",
      thinking: "用户换了视觉目标，按新配方确认需求，不要沿用旧宪法。",
      calls: [
        tool("ask_discovery", {
          ...buildDefaultDiscoveryForm(text, targetId),
        }),
      ],
    };
  }

  if (isDirectionAdjustMessage(text)) {
    return {
      mode: "tools",
      thinking: "用户要调整视觉方向，先出确认表单，不要用散文提问。",
      calls: [
        tool("ask_discovery", {
          ...buildDirectionAdjustForm(
            project?.designDirection?.summary,
            targetId
          ),
        }),
      ],
    };
  }

  if (isDiscoveryAnswerMessage(text) && !project?.brief) {
    return {
      mode: "tools",
      thinking: "需求确认已提交：生成 Brief、视觉方向，然后请用户确认。",
      calls: [
        tool("generate_brief", { idea: text }),
        tool("plan_design_direction"),
        tool("confirm_direction"),
      ],
    };
  }

  if (isDiscoveryAnswerMessage(text) && project?.brief) {
    return {
      mode: "tools",
      thinking: "方向调整表已提交：按回答重做视觉方向，再请用户确认。",
      calls: [tool("plan_design_direction"), tool("confirm_direction")],
    };
  }

  // 纯问答优先 chat，避免被后续「默认生图」规则吞掉
  if (isLikelyPureQuestion(text) && !isExplicitVisualWorkRequest(text)) {
    return asChatDecision("根据当前项目上下文直接回答，不执行会改项目的工具。");
  }

  if (!project || !project.brief) {
    if (!project?.targetLocked) {
      const conflict = targetConflict(targetId, text);
      if (conflict && !isDiscoveryAnswerMessage(text)) {
        return {
          mode: "tools",
          thinking: "用户原文和当前目标冲突，先问要不要换目标。",
          calls: [
            tool("ask_discovery", {
              ...buildTargetConflictForm(targetId, conflict),
            }),
          ],
        };
      }
    }
    if (
      shouldAskDiscovery({ userMessage: text, hasBrief: false }) &&
      !isSkipDiscoveryInstruction(text)
    ) {
      return {
        mode: "tools",
        thinking: "需求还不完整，先出预填确认表，等用户提交后再继续。",
        calls: [
          tool("ask_discovery", {
            ...buildDefaultDiscoveryForm(text, targetId),
          }),
        ],
      };
    }
    return {
      mode: "tools",
      thinking: "brief 已够具体：生成 Brief、视觉方向，然后请用户确认，不直接生图。",
      calls: [
        tool("generate_brief", { idea: text }),
        tool("plan_design_direction"),
        tool("confirm_direction"),
      ],
    };
  }

  if (!project.designDirection) {
    return {
      mode: "tools",
      thinking: "补充视觉方向后请用户确认，不直接生图。",
      calls: [tool("plan_design_direction"), tool("confirm_direction")],
    };
  }

  const assetCount = (project.assets ?? []).filter(
    (asset) => asset.status !== "discarded"
  ).length;

  if (/拆成素材|拆解素材|materialize|锁定.*拆|满意.*拆|零件素材|拆解方案/i.test(text)) {
    const wantGenerate =
      /确认生成|开始生成|生成素材|generateMaterials|skipGeneration\s*[:=]\s*false/i.test(
        text
      );
    return {
      mode: "tools",
      thinking: wantGenerate
        ? "用户已确认拆解方案，启动按槽生图。"
        : "先拆解布局方案供用户确认，不自动生图。",
      calls: [
        tool("materialize_mockup", {
          ...(ref.assetId ? { targetAssetId: ref.assetId } : {}),
          ...(wantGenerate
            ? { generateMaterials: true }
            : { skipGeneration: true }),
        }),
      ],
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
    const hasMaterials = Object.values(project.materializations ?? {}).some(
      (record) =>
        record.layout.nodes.some(
          (node) =>
            node.rebuildInCode === false &&
            node.status === "ready" &&
            Boolean(node.materialAssetId)
        )
    );
    if (!hasMaterials && assetCount > 0) {
      return {
        mode: "tools",
        thinking: `高保真交付前先拆解方案（不自动生图），请用户确认后再生成并导出 (${target})。`,
        calls: [
          tool("materialize_mockup", {
            skipGeneration: true,
            ...(ref.assetId ? { targetAssetId: ref.assetId } : {}),
          }),
        ],
      };
    }
    return {
      mode: "tools",
      thinking: `准备视觉素材交付包 (${target})。`,
      calls: [tool("export_handoff", { target })],
    };
  }

  if (/变体|换图|重新生成|重生成|局部重绘|框选重绘|改这张|编辑这张/i.test(text)) {
    return {
      mode: "tools",
      thinking: `为现有素材生成变体或局部重绘${refSuffix}。`,
      calls: [
        tool("generate_image_variants", {
          prompt: text,
          ...(ref.assetId ? { targetAssetId: ref.assetId } : {}),
        }),
      ],
    };
  }

  if (productShotNeedsReference(project)) {
    return {
      mode: "tools",
      thinking: "产品图没有参考，先停，不要脑补商品。",
      calls: [tool("ask_discovery", { ...buildProductReferenceForm() })],
    };
  }

  if (
    assetCount === 0 ||
    /生图|出图|视觉|素材|图片|生成|app|ui|首页|主页|页面|landing|dashboard|screen/i.test(text)
  ) {
    return {
      mode: "tools",
      thinking: "生成高保真视觉素材图。",
      calls: [tool("generate_images", imageArgs)],
    };
  }

  return {
    mode: "tools",
    thinking: "继续补充视觉素材。",
    calls: [tool("generate_images", imageArgs)],
  };
}

function tool(
  name: ToolCall["name"],
  args?: Record<string, unknown>
): ToolCall {
  return { id: nanoid(8), name, args };
}

function isVisualGenerationRequest(text: string): boolean {
  return /生图|出图|生成.*图|视觉|素材|图片|图像|海报|宣传图|详情页|首页|主页|首屏|页面|界面|app|ui|landing|dashboard|screen|poster|promo|hero visual|visual asset|image/i.test(
    text
  );
}

export function getPipelineContinuationTools(
  project: ProjectFile | null,
  userMessage: string,
  executed: ReadonlySet<ToolCall["name"]>
): ToolCall[] {
  const text = userMessage.trim();
  const requestedImageCount = parseRequestedImageCount(text);
  const imageArgs = requestedImageCount != null ? { count: requestedImageCount } : undefined;
  if (executed.has("answer_question")) return [];
  if (executed.has("edit_page")) return [];
  if (executed.has("generate_image_variants")) return [];
  if (executed.has("restyle_page_images")) return [];
  if (executed.has("materialize_mockup") && !/导出|handoff|交付/i.test(text)) {
    return [];
  }
  if (/^(什么|如何|为什么|是否|what|how|why|is |are )/i.test(text)) {
    return [];
  }
  if (/导出|handoff|交付/i.test(text) && executed.has("export_handoff")) {
    return [];
  }

  if (
    executed.has("ask_discovery") ||
    executed.has("confirm_direction") ||
    executed.has("adopt_asset_style")
  ) {
    return [];
  }

  const calls: ToolCall[] = [];
  const idea = text || project?.rawIdea || "未命名产品";

  if (
    !project?.brief &&
    !executed.has("generate_brief") &&
    !shouldAskDiscovery({ userMessage: text, hasBrief: false })
  ) {
    calls.push(tool("generate_brief", { idea }));
  }
  if (
    project?.brief &&
    !project.designDirection &&
    !executed.has("plan_design_direction")
  ) {
    calls.push(tool("plan_design_direction"));
    if (!executed.has("confirm_direction")) {
      calls.push(tool("confirm_direction"));
    }
  }

  const assetCount = (project?.assets ?? []).filter(
    (asset) => asset.status !== "discarded"
  ).length;
  if (
    project?.brief &&
    project.designDirection &&
    assetCount === 0 &&
    !executed.has("generate_images") &&
    isDirectionConfirmMessage(text)
  ) {
    calls.push(tool("generate_images", imageArgs));
  }

  return calls;
}

export function buildDefaultPlan(idea: string): PlannerDecision {
  if (shouldAskDiscovery({ userMessage: idea, hasBrief: false })) {
    return {
      thinking: "需求还不完整，先出预填确认表。",
      calls: [tool("ask_discovery", { ...buildDefaultDiscoveryForm(idea) })],
    };
  }
  return {
    thinking: "从想法开始：生成 Brief、视觉方向，然后请用户确认。",
    calls: [
      tool("generate_brief", { idea }),
      tool("plan_design_direction"),
      tool("confirm_direction"),
    ],
  };
}
