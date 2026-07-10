/**
 * Chat Orchestrator（server-only）
 * --------------------------------------------------------------
 * 接收用户在 Chat Pane 输入的一条消息，由 Orchestrator Planner（LLM JSON 计划）
 * 决定工具序列并顺序执行，以 SSE 流式输出事件。
 *
 * 设计流水线工具：
 *   generate_brief → plan_design_direction → generate_images（独立视觉素材）
 *   → generate_image_variants / export_handoff / answer_question
 *   （已废弃网页结构：plan_architecture / generate_layout / edit_page 等）
 *
 * @author：wangjunhua
 */

import "server-only";

import { nanoid } from "nanoid";
import type { ProjectFile } from "@/lib/project/schema";
import { ProjectFileSchema } from "@/lib/project/schema";
import type { ImageAsset } from "@/lib/project/assets-schema";
import { BriefAgent } from "./brief-agent";
import { DesignDirectorAgent } from "./design-director-agent";
import { ImagePlannerAgent } from "./image-planner-agent";
import { ImageExecutorAgent } from "./image-executor-agent";
import { HandoffAgent } from "./handoff-agent";
import {
  getPipelineContinuationTools,
  planOrchestratorTools,
} from "./orchestrator-planner";
import { isMockLlmText } from "@/lib/providers/llm/utils";
import type { AgentContext } from "./types";
import type {
  ChatMessage,
  ChatStreamEvent,
  ToolCall,
  ThinkingEventData,
  ToolCallEventData,
  ToolResultEventData,
  AssistantTextEventData,
  DoneEventData,
  ErrorEventData,
  FileWriteEventData,
  CodeDiffEventData,
  HandoffDownloadEventData,
  ProjectPreviewEventData,
  AgentPlanEventData,
} from "./chat-schema";
import {
  assetCodeDiff,
} from "@/lib/chat/page-code-diff";
import {
  resolveProviders,
  type ProviderConfig,
} from "@/lib/providers/registry";
import { resolveSkill, resolveDesignSystem } from "@/lib/skills/registry";
import { injectProviderScratch } from "./content-preferences";
import { assertRealImageForGeneration } from "@/lib/providers/validate";
import { emitThinkingChunks, toolDisplayLabel } from "@/lib/chat/live-timeline";
import {
  buildDesignContext,
  deriveDesignContext,
  readDesignContextFromScratch,
  summarizeDesignContext,
} from "@/lib/project/design-context";
import {
  createChatPipelineLogBridge,
  detailForChatTool,
  flushPipelineLogEvents,
  stageForChatTool,
} from "./chat-pipeline-log";
import type { PipelineLogger } from "./pipeline-logger";

/* ──────────────────────── 入口 ──────────────────────── */

export interface ChatTurnInput {
  /** 当前项目（可能为 null：用户从空白开始 chat） */
  project: ProjectFile | null;
  /** 完整历史（含本轮 user 消息） */
  messages: ChatMessage[];
  /** Provider / Skill / DS 选择 */
  providerConfig?: ProviderConfig;
}

export interface ChatTurnResult {
  /** 本轮可能产出/更新的 project；未变化则返回原值 */
  updatedProject: ProjectFile | null;
}

/**
 * 跑一轮对话。返回 AsyncIterable<ChatStreamEvent>。
 * 调用方（SSE route）负责把事件写入 ReadableStream。
 *
 * 跑完最后由调用方读 `resultPromise` 拿到 updatedProject。
 */
export function runChatTurn(
  input: ChatTurnInput
): { events: AsyncIterable<ChatStreamEvent>; resultPromise: Promise<ChatTurnResult> } {
  // 用 channel 模式让 generator 把事件 yield 出来，同时把最终 result resolve 给外面
  let resolveResult: (r: ChatTurnResult) => void;
  let rejectResult: (e: unknown) => void;
  const resultPromise = new Promise<ChatTurnResult>((res, rej) => {
    resolveResult = res;
    rejectResult = rej;
  });

  async function* gen(): AsyncIterable<ChatStreamEvent> {
    let logBridge!: ReturnType<typeof createChatPipelineLogBridge>;
    try {
      const last = lastUserMessage(input.messages);
      if (!last) {
        yield ev("error", { message: "缺少 user 消息" });
        yield ev("done", { reason: "complete" });
        resolveResult({ updatedProject: input.project });
        return;
      }

      const ctx = await buildContext(
        input.providerConfig,
        input.project?.id
      );
      const designContext = input.project
        ? deriveDesignContext(input.project)
        : null;
      if (designContext) ctx.scratch.designContext = designContext;
      logBridge = createChatPipelineLogBridge(ctx.projectId, last.content ?? "");
      ctx.scratch.pipelineLogger = logBridge.logger;

      for (const evItem of flushPipelineLogEvents(logBridge)) {
        yield evItem;
      }

      // ── LLM Orchestrator 规划（支持流式思考 + 日志）──
      logBridge.logger.stageStart("orchestrator", "解析用户意图并规划工具");
      const thinkingQueue: string[] = [];
      let streamedPlanner = false;
      const planPromise = planOrchestratorTools(
        input.project,
        last.content ?? "",
        ctx,
        {
          onThinkingDelta: (t) => {
            streamedPlanner = true;
            thinkingQueue.push(t);
          },
        }
      );

      let decision!: Awaited<typeof planPromise>;
      while (true) {
        while (thinkingQueue.length) {
          yield ev("thinking", { text: thinkingQueue.shift()! });
        }
        for (const evItem of flushPipelineLogEvents(logBridge)) {
          yield evItem;
        }
        const settled = await Promise.race([
          planPromise.then((d) => ({ done: true as const, d })),
          new Promise<{ done: false }>((r) => setTimeout(() => r({ done: false }), 40)),
        ]);
        if (settled.done) {
          decision = settled.d;
          break;
        }
      }
      while (thinkingQueue.length) {
        yield ev("thinking", { text: thinkingQueue.shift()! });
      }
      logBridge.logger.stageEnd("orchestrator", "规划完成", {
        toolCount: decision.calls.length,
      });
      for (const evItem of flushPipelineLogEvents(logBridge)) {
        yield evItem;
      }
      yield ev("agent_plan", {
        thinking: decision.thinking,
        tools: decision.calls,
      });
      if (!streamedPlanner) {
        for (const chunk of emitThinkingChunks(decision.thinking)) {
          yield ev("thinking", chunk);
        }
      } else if (decision.thinking.trim()) {
        yield ev("thinking", {
          text: `\n📋 ${decision.thinking.trim()}\n`,
        });
      }

      let project = input.project;
      const executedTools = new Set<ToolCall["name"]>();

      const runPlannedCalls = async function* (
        calls: ToolCall[]
      ): AsyncGenerator<ChatStreamEvent> {
        for (const call of calls) {
          executedTools.add(call.name);
          yield ev("tool_call", {
            id: call.id,
            name: call.name,
            args: call.args,
          });
          yield ev("thinking", {
            text: `\n▸ ${toolDisplayLabel(call.name)}…\n`,
          });
          for (const evItem of flushPipelineLogEvents(logBridge)) {
            yield evItem;
          }

          try {
            const result = await logBridge.logger.runStage(
              stageForChatTool(call.name),
              detailForChatTool(call),
              () =>
                runTool(call, {
                  project,
                  userMessage: last.content ?? "",
                  ctx,
                  providerConfig: input.providerConfig,
                }),
              (r) => ({
                summary: r.summary?.slice(0, 160),
                fileCount: r.fileWrites?.length ?? 0,
              })
            );
            for (const evItem of flushPipelineLogEvents(logBridge)) {
              yield evItem;
            }

            if (result.updatedProject) {
              project = result.updatedProject;
              const nextDesignContext = deriveDesignContext(project);
              if (nextDesignContext) {
                ctx.scratch.designContext = nextDesignContext;
              }
              for (const path of result.fileWrites ?? []) {
                yield ev("file_write", { path });
              }
            }
            for (const diff of result.codeDiffs ?? []) {
              yield ev("code_diff", { ...diff, toolCallId: call.id });
            }
            if (
              result.updatedProject &&
              (result.codeDiffs?.length ?? 0) > 0
            ) {
              const preview: ProjectPreviewEventData = {
                toolCallId: call.id,
                project: result.updatedProject,
              };
              yield ev("project_preview", preview);
            }

            yield ev("tool_result", {
              id: call.id,
              ok: true,
              summary: result.summary,
              data: result.data,
            });

            if (
              call.name === "export_handoff" &&
              result.data &&
              typeof result.data === "object" &&
              (result.data as { autoDownload?: boolean }).autoDownload &&
              project
            ) {
              const handoffData: HandoffDownloadEventData = {
                target:
                  ((result.data as { target?: string }).target as HandoffDownloadEventData["target"]) ??
                  "markdown",
                fileCount:
                  (result.data as { fileCount?: number }).fileCount ?? 0,
              };
              yield ev("handoff_download", handoffData);
            }
          } catch (e) {
            for (const evItem of flushPipelineLogEvents(logBridge)) {
              yield evItem;
            }
            yield ev("tool_result", {
              id: call.id,
              ok: false,
              summary: (e as Error).message,
            });
          }
        }
      };

      for await (const evItem of runPlannedCalls(decision.calls)) {
        yield evItem;
      }

      for (let pass = 0; pass < 2; pass++) {
        const continuation = getPipelineContinuationTools(
          project,
          last.content ?? "",
          executedTools
        );
        if (continuation.length === 0) break;
        for (const chunk of emitThinkingChunks(
          `检测到流水线未完成，自动补全：${continuation.map((c) => c.name).join(" → ")}`
        )) {
          yield ev("thinking", chunk);
        }
        for await (const evItem of runPlannedCalls(continuation)) {
          yield evItem;
        }
      }

      // ── 收尾：发一句 assistant_text，让 UI 显示总结 ──
      const closing = composeClosing(decision, project);
      if (closing) yield ev("assistant_text", { text: closing });

      logBridge.logger.complete(
        project
          ? `Chat 轮次完成：${project.title}，${project.pages.length} 页`
          : "Chat 轮次完成"
      );
      for (const evItem of flushPipelineLogEvents(logBridge)) {
        yield evItem;
      }

      yield ev("done", { reason: "complete", projectId: project?.id });
      resolveResult({ updatedProject: project });
    } catch (e) {
      logBridge?.logger.fail(e);
      if (logBridge) {
        for (const evItem of flushPipelineLogEvents(logBridge)) {
          yield evItem;
        }
      }
      yield ev("error", { message: (e as Error).message });
      yield ev("done", { reason: "complete" });
      rejectResult(e);
    }
  }

  return { events: gen(), resultPromise };
}

export { parsePageReference } from "./page-reference";

/* ──────────────────────── 工具执行 ──────────────────────── */

interface ToolRunCtx {
  project: ProjectFile | null;
  userMessage: string;
  ctx: AgentContext;
  providerConfig?: ProviderConfig;
}

interface ToolRunResult {
  summary: string;
  data?: unknown;
  updatedProject?: ProjectFile;
  fileWrites?: string[];
  codeDiffs?: CodeDiffEventData[];
}

function resolveRunDesignContext(run: ToolRunCtx): ProjectFile["designContext"] {
  if (!run.project) return undefined;
  return (
    run.project.designContext ??
    readDesignContextFromScratch(run.ctx.scratch) ??
    deriveDesignContext(run.project) ??
    undefined
  );
}

async function runTool(call: ToolCall, run: ToolRunCtx): Promise<ToolRunResult> {
  switch (call.name) {
    case "generate_brief": {
      const idea = (call.args?.idea as string) ?? run.userMessage;
      const brief = await BriefAgent.run({ idea }, run.ctx);
      const now = new Date().toISOString();
      const designContext =
        run.project?.designContext ??
        buildDesignContext({
          brief,
          designSystemId: run.ctx.designSystem?.manifest.name,
          now,
        });
      run.ctx.scratch.designContext = designContext;
      const updated: ProjectFile = ProjectFileSchema.parse({
        id: run.project?.id ?? nanoid(10),
        slug:
          run.project?.slug ?? slugify(brief.productName) ?? nanoid(10),
        title: brief.productName,
        rawIdea: idea,
        createdAt: run.project?.createdAt ?? now,
        updatedAt: now,
        brief,
        designContext,
        pages: run.project?.pages ?? [],
        critique: run.project?.critique,
        critiqueHistory: run.project?.critiqueHistory,
        skillId: run.ctx.skill?.manifest.name,
        designSystemId: run.ctx.designSystem?.manifest.name,
      });
      return {
        summary: `Brief 已生成：${brief.productName}（${brief.platform}）`,
        data: { brief },
        updatedProject: updated,
        fileWrites: ["design/project.json"],
      };
    }

    case "plan_architecture": {
      return {
        summary:
          "已跳过信息架构规划：产品改为视觉素材交付，不再生成网页页面清单。",
      };
    }

    case "plan_design_direction": {
      if (!run.project?.brief) throw new Error("缺少 brief");
      const architecture = run.project.architecture ?? {
        pages: [
          {
            id: "asset-board",
            name: "视觉素材",
            purpose: "画布生图交付",
            priority: "primary" as const,
          },
        ],
        userFlows: ["描述想法 → 生成视觉素材 → 导出交付"],
        summary: "素材交付工作台",
      };
      const designDirection = await DesignDirectorAgent.run(
        { brief: run.project.brief, architecture },
        run.ctx
      );
      run.ctx.scratch.designDirectionSummary = designDirection.summary;
      const designContext = buildDesignContext({
        brief: run.project.brief,
        designDirection,
        designSystemId: run.ctx.designSystem?.manifest.name,
      });
      run.ctx.scratch.designContext = designContext;
      const updated = ProjectFileSchema.parse({
        ...run.project,
        architecture,
        designDirection,
        designContext,
        updatedAt: new Date().toISOString(),
      });
      return {
        summary: `视觉方向：${designDirection.summary.slice(0, 60)}…`,
        data: { designDirection },
        updatedProject: updated,
        fileWrites: ["design/direction.json"],
      };
    }

    case "generate_layout":
    case "polish_content":
    case "edit_page":
    case "critique_pages":
    case "repair_page": {
      return {
        summary:
          "已跳过网页结构相关步骤。请继续用「生成视觉素材 / 变体 / 导出 Handoff」。",
      };
    }

    case "generate_image_variants": {
      if (!run.project?.brief) {
        throw new Error("缺少 brief，无法生成素材变体");
      }
      assertRealImageForGeneration(run.providerConfig);

      const prompt =
        (call.args?.prompt as string | undefined) ?? run.userMessage;
      const targetAssetId = call.args?.targetAssetId as string | undefined;
      const existingAssets = (run.project.assets ?? []).filter(
        (a) => a.status !== "discarded" && a.status !== "generating"
      );
      const parent =
        (targetAssetId
          ? existingAssets.find((a) => a.id === targetAssetId)
          : null) ??
        existingAssets.find((a) => a.status === "starred") ??
        existingAssets[existingAssets.length - 1];
      if (!parent?.src) {
        throw new Error("没有可做变体的素材，请先生成视觉素材");
      }

      const n = clampInt(Number(call.args?.n ?? 4), 1, 4);
      const size = normalizeImageSize(parent.width, parent.height);
      const designContext = deriveDesignContext(run.project);
      const variantGroupId = nanoid(8);
      const fullPrompt = buildNodeImagePrompt({
        project: run.project,
        instruction: prompt,
        currentPrompt: parent.prompt,
        designContextSummary: designContext?.imageStyle,
      });
      const referenceImages = isUsableReferenceImage(parent.src)
        ? [parent.src]
        : undefined;
      const settled = await Promise.allSettled(
        Array.from({ length: n }, () =>
          run.ctx.providers.image.generateImage({
            prompt: fullPrompt,
            width: size.width,
            height: size.height,
            referenceImages,
          })
        )
      );

      const now = new Date().toISOString();
      const assets: ImageAsset[] = [];
      for (const result of settled) {
        if (result.status !== "fulfilled") continue;
        const out = result.value;
        assets.push({
          id: nanoid(10),
          prompt: fullPrompt,
          src: out.imageUrl,
          width: size.width,
          height: size.height,
          model: out.model,
          seed: out.seed,
          durationMs: out.durationMs,
          costUsd: out.cost,
          createdAt: now,
          batchId: variantGroupId,
          variantGroupId,
          status: "candidate",
          usedInPages: [],
          usedInNodes: [],
          source: referenceImages?.length ? "edited" : "generated",
          parentAssetId: parent.id,
          role: parent.role ?? inferImageRole(parent.width, parent.height),
          editInstruction: prompt,
          designContextVersion: designContext?.version,
        });
      }

      if (assets.length === 0) {
        throw new Error("素材变体生成失败");
      }

      const updated = ProjectFileSchema.parse({
        ...run.project,
        assets: [...(run.project.assets ?? []), ...assets],
        designContext: resolveRunDesignContext(run),
        updatedAt: now,
      });
      return {
        summary: `已为素材生成 ${assets.length} 张变体（父素材 ${parent.id.slice(0, 8)}）`,
        data: {
          parentAssetId: parent.id,
          candidateAssetIds: assets.map((asset) => asset.id),
        },
        updatedProject: updated,
        fileWrites: assets.map((asset) => `design/assets/${asset.id}.png`),
        codeDiffs: assets.map((asset) => assetCodeDiff(asset, call.id)),
      };
    }

    case "restyle_page_images": {
      if (!run.project?.brief) {
        throw new Error("缺少 brief，无法统一素材风格");
      }
      assertRealImageForGeneration(run.providerConfig);
      const instruction =
        (call.args?.instruction as string | undefined) ?? run.userMessage;
      const sources = (run.project.assets ?? []).filter(
        (a) =>
          a.status !== "discarded" &&
          a.status !== "generating" &&
          isUsableReferenceImage(a.src)
      );
      if (sources.length === 0) {
        throw new Error("没有可换风格的素材，请先生成视觉素材");
      }

      const designContext = deriveDesignContext(run.project);
      const variantGroupId = nanoid(8);
      const now = new Date().toISOString();
      const assets: ImageAsset[] = [];
      const targets = sources.slice(0, 4);

      for (const parent of targets) {
        const size = normalizeImageSize(parent.width, parent.height);
        const prompt = buildNodeImagePrompt({
          project: run.project,
          instruction,
          currentPrompt: parent.prompt,
          designContextSummary: designContext?.imageStyle,
        });
        const result = await run.ctx.providers.image.generateImage({
          prompt,
          width: size.width,
          height: size.height,
          referenceImages: [parent.src],
        });
        assets.push({
          id: nanoid(10),
          prompt,
          src: result.imageUrl,
          width: size.width,
          height: size.height,
          model: result.model,
          seed: result.seed,
          durationMs: result.durationMs,
          costUsd: result.cost,
          createdAt: now,
          batchId: variantGroupId,
          variantGroupId,
          status: "candidate",
          usedInPages: [],
          usedInNodes: [],
          source: "edited",
          parentAssetId: parent.id,
          role: parent.role ?? inferImageRole(parent.width, parent.height),
          editInstruction: instruction,
          designContextVersion: designContext?.version,
        });
      }

      const updated = ProjectFileSchema.parse({
        ...run.project,
        assets: [...(run.project.assets ?? []), ...assets],
        designContext: resolveRunDesignContext(run),
        updatedAt: now,
      });
      return {
        summary: `已按指令为 ${assets.length} 张素材生成新风格版本`,
        data: { assetIds: assets.map((a) => a.id) },
        updatedProject: updated,
        fileWrites: assets.map((a) => `design/assets/${a.id}.png`),
        codeDiffs: assets.map((a) => assetCodeDiff(a, call.id)),
      };
    }

    case "generate_images": {
      if (!run.project?.brief) {
        throw new Error("缺少 brief，无法生图");
      }
      const plog = run.ctx.scratch.pipelineLogger as PipelineLogger | undefined;
      // 始终走独立视觉素材（忽略旧 pages 结构稿）
      const plan = plog
        ? await plog.runStage(
            "image_plan",
            "独立视觉素材",
            () =>
              ImagePlannerAgent.run(
                {
                  brief: run.project!.brief!,
                  pages: [],
                  designDirection: run.project!.designDirection,
                  standaloneCount: clampInt(
                    Number(call.args?.count ?? call.args?.n ?? 4),
                    2,
                    8
                  ),
                },
                run.ctx
              ),
            (p) => ({ tasks: p.tasks.length })
          )
        : await ImagePlannerAgent.run(
            {
              brief: run.project.brief,
              pages: [],
              designDirection: run.project.designDirection,
              standaloneCount: clampInt(
                Number(call.args?.count ?? call.args?.n ?? 4),
                2,
                8
              ),
            },
            run.ctx
          );
      if (plan.tasks.length === 0) {
        return { summary: "没有待生成的视觉素材。" };
      }
      const executed = plog
        ? await plog.runStage(
            "image_execute",
            `${plan.tasks.length} 个位图任务`,
            () =>
              ImageExecutorAgent.run(
                {
                  brief: run.project!.brief!,
                  pages: [],
                  plan,
                  providerConfig: run.providerConfig,
                },
                run.ctx
              ),
            (x) => ({ succeeded: x.succeeded, failed: x.failed })
          )
        : await ImageExecutorAgent.run(
            {
              brief: run.project.brief,
              pages: [],
              plan,
              providerConfig: run.providerConfig,
            },
            run.ctx
          );
      const updated = ProjectFileSchema.parse({
        ...run.project,
        pages: run.project.pages ?? [],
        assets: [...(run.project.assets ?? []), ...executed.assets],
        designContext: resolveRunDesignContext(run),
        updatedAt: new Date().toISOString(),
      });
      return {
        summary: `生图完成 ${executed.succeeded}/${plan.tasks.length}（失败 ${executed.failed}）`,
        data: { succeeded: executed.succeeded, failed: executed.failed },
        updatedProject: updated,
        fileWrites: executed.assets.map((a) => `design/assets/${a.id}.png`),
        codeDiffs: executed.assets.map((a) => assetCodeDiff(a, call.id)),
      };
    }

    case "export_handoff": {
      if (!run.project) throw new Error("缺少项目，无法导出 Handoff");
      const target = (call.args?.target as
        | "cursor"
        | "claude-code"
        | "codex"
        | "markdown") ?? "markdown";
      const result = await HandoffAgent.run(
        { project: run.project, target },
        run.ctx
      );
      run.ctx.scratch.handoffArtifact = result.artifact;
      return {
        summary: `Handoff 包已编译（${result.target}），共 ${result.fileCount} 个文件，正在触发 ZIP 下载…`,
        data: {
          target: result.target,
          fileCount: result.fileCount,
          paths: result.paths.slice(0, 12),
          autoDownload: true,
        },
        fileWrites: result.paths,
      };
    }

    case "answer_question": {
      // 不调任何 agent；让 LLM 用 project 上下文直接回复一段文本
      const question = (call.args?.question as string) ?? run.userMessage;
      const focusPageId = call.args?.focusPageId as string | undefined;
      const focusPageName = call.args?.focusPageName as string | undefined;
      const out = await run.ctx.providers.llm.generateText({
        system: composeAnswerSystem(run, { focusPageId, focusPageName }),
        prompt: question,
      });
      const text = isMockLlmText(out.text)
        ? `已收到你的问题："${question}"${
            focusPageName ? `（针对页面：${focusPageName}）` : ""
          }。请配置真实 LLM 以获得回答。`
        : out.text;
      return { summary: text, data: { text } };
    }
  }
}

function composeAnswerSystem(
  run: ToolRunCtx,
  focus?: { focusPageId?: string; focusPageName?: string }
): string {
  const lines = [
    "你是产品设计师 Agent，正在和用户对话讨论当前设计项目。",
    "回答简洁，必要时引用现有 pages 的名字或 critique 结论。",
    "不要重复执行工具；这一轮的任务是文字回答。",
  ];
  if (run.ctx.skill) {
    lines.push(`当前 Skill: ${run.ctx.skill.manifest.name}`);
  }
  if (run.ctx.designSystem) {
    lines.push(`当前 DesignSystem: ${run.ctx.designSystem.manifest.name}`);
  }
  if (run.project) {
    lines.push(
      `当前项目: ${run.project.title}, ${run.project.pages.length} 页, score=${run.project.critique?.overallScore ?? "n/a"}`
    );
  }
  const designContext = run.project
    ? deriveDesignContext(run.project)
    : readDesignContextFromScratch(run.ctx.scratch);
  if (designContext) {
    lines.push(`Design Context Memory:\n${summarizeDesignContext(designContext)}`);
  }
  if (focus?.focusPageId && run.project) {
    const page = run.project.pages.find((p) => p.id === focus.focusPageId);
    if (page) {
      lines.push(
        `用户在画布上点选了「${page.name}」(id=${page.id}, ${page.width}×${page.height}, ${page.nodes.length} 个节点) 进行讨论；优先围绕这一页回答。`
      );
    }
  }
  return lines.join("\n");
}

function composeClosing(
  d: { calls: ToolCall[] },
  project: ProjectFile | null
): string {
  if (!project) return "本轮完成。";
  const score = project.critique?.overallScore;
  if (d.calls.some((c) => c.name === "critique_pages")) {
    return `当前 ${project.pages.length} 页，总评分 ${score ?? "n/a"} / 10。`;
  }
  if (d.calls.some((c) => c.name === "repair_page")) {
    return `修复完成，新评分 ${score ?? "n/a"} / 10。`;
  }
  if (d.calls.some((c) => c.name === "generate_image_variants")) {
    return `图片候选已生成，首张已进入画布预览，其余保留在素材库。`;
  }
  if (d.calls.some((c) => c.name === "restyle_page_images")) {
    return `页面图片风格已统一，结果已进入画布预览和素材库。`;
  }
  if (d.calls.some((c) => c.name === "edit_page")) {
    return `页面编辑完成。`;
  }
  return "";
}

/* ──────────────────────── 辅助 ──────────────────────── */

async function buildContext(
  providerConfig?: ProviderConfig,
  projectId?: string
): Promise<AgentContext> {
  const skill = await resolveSkill(providerConfig?.skillId);
  const designSystem = await resolveDesignSystem(
    providerConfig?.designSystemId ?? skill?.manifest.recommendedDesignSystem
  );
  const scratch: Record<string, unknown> = {};
  injectProviderScratch(scratch, providerConfig);
  return {
    projectId: projectId ?? nanoid(10),
    scratch,
    providers: resolveProviders(providerConfig),
    skill,
    designSystem,
  };
}

function lastUserMessage(messages: ChatMessage[]): ChatMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i];
  }
  return null;
}

function slugify(s: string): string | undefined {
  const r = s
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return r || undefined;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeImageSize(width: number, height: number): {
  width: number;
  height: number;
} {
  const w = Math.max(64, width);
  const h = Math.max(64, height);
  const maxSide = Math.max(w, h);
  const minSide = Math.min(w, h);
  const upScale = minSide < 512 ? 512 / minSide : 1;
  const downScale = maxSide * upScale > 1792 ? 1792 / (maxSide * upScale) : 1;
  const scale = upScale * downScale;
  return {
    width: roundTo64(w * scale),
    height: roundTo64(h * scale),
  };
}

function roundTo64(value: number): number {
  return Math.max(512, Math.round(value / 64) * 64);
}

function buildNodeImagePrompt({
  project,
  instruction,
  currentPrompt,
  designContextSummary,
}: {
  project: ProjectFile;
  instruction: string;
  currentPrompt?: string;
  designContextSummary?: string;
}): string {
  return [
    designContextSummary ?? project.brief?.visualStyle,
    `Project: ${project.title}`,
    `User instruction: ${instruction}`,
    currentPrompt ? `Current image direction: ${currentPrompt}` : undefined,
    "Create a polished visual asset for a UI canvas node.",
    "Match the product interface style, composition, and color language.",
    "No text overlay, no fake UI labels, no watermark.",
  ]
    .filter(Boolean)
    .join(". ");
}

function inferImageRole(
  width: number,
  height: number
): NonNullable<ImageAsset["role"]> {
  const ratio = width / Math.max(1, height);
  if (ratio > 2.2) return "background";
  if (width > 480 && height > 260) return "hero";
  return "illustration";
}

function isUsableReferenceImage(src: string | undefined): src is string {
  if (!src) return false;
  if (src.startsWith("data:image/svg+xml")) return false;
  return src.startsWith("data:image/") || /^https?:\/\//i.test(src);
}

/* ──────────────────────── 事件构造 ──────────────────────── */

function ev(type: "thinking", data: ThinkingEventData): ChatStreamEvent;
function ev(type: "tool_call", data: ToolCallEventData): ChatStreamEvent;
function ev(type: "tool_result", data: ToolResultEventData): ChatStreamEvent;
function ev(type: "file_write", data: FileWriteEventData): ChatStreamEvent;
function ev(type: "code_diff", data: CodeDiffEventData): ChatStreamEvent;
function ev(type: "project_preview", data: ProjectPreviewEventData): ChatStreamEvent;
function ev(type: "agent_plan", data: AgentPlanEventData): ChatStreamEvent;
function ev(type: "pipeline_log", data: import("./pipeline-logger").PipelineLogEntry): ChatStreamEvent;
function ev(type: "assistant_text", data: AssistantTextEventData): ChatStreamEvent;
function ev(type: "handoff_download", data: HandoffDownloadEventData): ChatStreamEvent;
function ev(type: "done", data: DoneEventData): ChatStreamEvent;
function ev(type: "error", data: ErrorEventData): ChatStreamEvent;
function ev(type: ChatStreamEvent["type"], data: unknown): ChatStreamEvent {
  return { type, data };
}
