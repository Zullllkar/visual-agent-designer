import "server-only";

import type { ProjectFile } from "@/lib/project/schema";
import type { AgentContext } from "./types";
import type {
  ChatMessage,
  ChatStreamEvent,
  ToolCall,
  ToolResultEventData,
} from "./chat-schema";
import {
  planOrchestratorTools,
  parsePageReference,
} from "./orchestrator-planner";
import {
  resolveProviders,
  type ProviderConfig,
} from "@/lib/providers/registry";
import { resolveSkillContext } from "@/lib/skills/context";
import { injectProviderScratch } from "./content-preferences";
import { resolveAgentContextProjectId } from "./resolve-agent-project";
import { emitThinkingChunks, toolDisplayLabel } from "@/lib/chat/live-timeline";
import { deriveDesignContext } from "@/lib/project/design-context";
import { registerAllTools, toolRegistry, type ToolContext } from "./tools";
import { composeAnswerSystemFromParts } from "./tools/answer-question";
import { agentRuns } from "./agent-run-service";
import { getCheckpointer, threadIdForProject } from "./checkpoint";
import { createRunBudgetState, reserveToolBudget, type RunBudgetState } from "./agent-budget";
import { isMockLlmText } from "@/lib/providers/llm/utils";
import { executeToolsInParallel } from "./parallel-tool-executor";
import { getFeatureFlags, isFeatureEnabled, getNumericConfig } from "./feature-flags";
import { performanceMonitor, createMetricsFromSummary } from "./performance-monitor";

export interface ChatTurnInput {
  project: ProjectFile | null;
  messages: ChatMessage[];
  providerConfig?: ProviderConfig;
}

export interface ChatTurnResult {
  updatedProject: ProjectFile | null;
}

/**
 * @deprecated Legacy orchestrator-based chat turn.
 * Kept for backward compatibility only. New code should use runChatTurnViaAgent.
 * This will be removed in a future version.
 */
export function runChatTurn(
  input: ChatTurnInput
): { events: AsyncIterable<ChatStreamEvent>; resultPromise: Promise<ChatTurnResult> } {
  let resolveResult!: (result: ChatTurnResult) => void;
  let rejectResult!: (error: unknown) => void;
  const resultPromise = new Promise<ChatTurnResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  async function* gen(): AsyncIterable<ChatStreamEvent> {
    try {
      const last = lastUserMessage(input.messages);
      if (!last) {
        yield ev("error", { message: "缺少 user 消息" });
        yield ev("done", { reason: "complete" });
        resolveResult({ updatedProject: input.project });
        return;
      }

      const ctx = await buildContext(input.providerConfig, input.project);
      const designContext = input.project ? deriveDesignContext(input.project) : null;
      if (designContext) ctx.scratch.designContext = designContext;
      if (input.project?.targetId) ctx.scratch.targetId = input.project.targetId;

      const decision = await planOrchestratorTools(
        input.project,
        last.content ?? "",
        ctx
      );

      yield ev("agent_plan", {
        thinking: decision.thinking,
        tools: decision.calls,
      });
      for (const chunk of emitThinkingChunks(decision.thinking)) {
        yield ev("thinking", chunk);
      }

      let project = input.project;

      // Chat-first：纯问答直接流式文字回答，不走工具卡
      if (decision.mode === "chat" || decision.calls.length === 0) {
        for await (const event of streamChatAnswer({
          project,
          userMessage: last.content ?? "",
          ctx,
        })) {
          yield event;
        }
        yield ev("done", { reason: "complete", projectId: project?.id });
        resolveResult({ updatedProject: project });
        return;
      }

      for await (const event of runCalls(decision.calls, {
        project,
        userMessage: last.content ?? "",
        ctx,
        providerConfig: input.providerConfig,
        onProject: (next) => {
          project = next;
        },
      })) {
        yield event;
        if (event.type === "image_generation.confirm") {
          yield ev("done", { reason: "complete", projectId: project?.id });
          resolveResult({ updatedProject: project });
          return;
        }
      }

      yield ev("done", { reason: "complete", projectId: project?.id });
      resolveResult({ updatedProject: project });
    } catch (error) {
      yield ev("error", { message: (error as Error).message });
      yield ev("done", { reason: "complete" });
      rejectResult(error);
    }
  }

  return { events: gen(), resultPromise };
}

/**
 * Enhanced Chat Turn via LangGraph ReAct Agent
 * --------------------------------------------------------------
 * 专业化版本：完全依赖 LangGraph ReAct Agent 的自主决策能力，
 * 不再使用 orchestrator-planner 的规则引擎干扰。
 *
 * ReAct Agent 通过增强的系统提示词获得完整的工作流知识，
 * 可以自主推理并决定何时调用哪些工具。
 */
export function runChatTurnViaAgent(
  input: ChatTurnInput
): { events: AsyncIterable<ChatStreamEvent>; resultPromise: Promise<ChatTurnResult> } {
  let resolveResult!: (result: ChatTurnResult) => void;
  let rejectResult!: (error: unknown) => void;
  const resultPromise = new Promise<ChatTurnResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  async function* gen(): AsyncIterable<ChatStreamEvent> {
    try {
      const last = lastUserMessage(input.messages);
      if (!last) {
        yield ev("error", { message: "缺少 user 消息" });
        yield ev("done", { reason: "complete" });
        resolveResult({ updatedProject: input.project });
        return;
      }

      const ctx = await buildContext(input.providerConfig, input.project);
      if (input.project?.targetId) ctx.scratch.targetId = input.project.targetId;
      const threadId = threadIdForProject(ctx.projectId);
      ctx.threadId = threadId;
      ctx.checkpointer = getCheckpointer();

      const run = agentRuns.createRun({
        threadId,
        prompt: last.content ?? "",
        project: input.project,
        agentCtx: ctx,
        providerConfig: input.providerConfig ?? {},
        checkpointer: ctx.checkpointer,
      });

      yield ev("command.ack", { runId: run.runId, threadId });

      let updatedProject = input.project;
      for await (const wsEvent of agentRuns.streamRun(run.runId, {
        threadId,
        prompt: last.content ?? "",
        project: input.project,
        agentCtx: ctx,
        providerConfig: input.providerConfig ?? {},
        checkpointer: ctx.checkpointer,
      })) {
        const mapped = mapWsEventToChatEvent(wsEvent, run.runId, input.project?.id);
        if (mapped) {
          if (mapped.type === "project.update") {
            const project = (mapped.data as { project?: ProjectFile }).project;
            if (project) updatedProject = project;
          }
          yield mapped;
        }
      }

      resolveResult({ updatedProject });
    } catch (error) {
      // 不再回退到旧编排器，而是直接报错
      // 专业系统应该保证 ReAct Agent 的稳定性，而不是依赖降级
      const errMsg = (error as Error).message;
      yield ev("error", { message: `ReAct Agent 执行失败: ${errMsg}` });
      yield ev("done", { reason: "error" });
      rejectResult(error);
    }
  }

  return { events: gen(), resultPromise };
}

async function* runCalls(
  calls: ToolCall[],
  run: {
    project: ProjectFile | null;
    userMessage: string;
    ctx: AgentContext;
    providerConfig?: ProviderConfig;
    onProject: (project: ProjectFile) => void;
  }
): AsyncGenerator<ChatStreamEvent> {
  registerAllTools();

  // 使用新的并行执行器
  const toolCtx: ToolContext = {
    project: run.project,
    userMessage: run.userMessage,
    agentCtx: run.ctx,
    providerConfig: run.providerConfig,
    onProjectUpdate: run.onProject,
  };

  // 检查 feature flags
  const flags = getFeatureFlags();
  const useParallel = isFeatureEnabled("enableParallelToolExecution");

  yield ev("thinking", {
    text: `\n执行 ${calls.length} 个工具（${useParallel ? '并行优化' : '串行模式'}）...\n`
  });

  const summary = await executeToolsInParallel(calls, toolCtx, {
    maxConcurrency: getNumericConfig("maxToolConcurrency"),
    toolTimeout: getNumericConfig("toolExecutionTimeout"),
    printGraph: isFeatureEnabled("enableDependencyGraphVisualization"),
  });

  // 发送结果事件
  for (const result of summary.results) {
    yield ev("tool_call", {
      id: result.call.id,
      name: result.call.name,
      args: result.call.args,
    });

    if (result.status === "success") {
      yield ev("tool_result", {
        id: result.call.id,
        name: result.call.name,
        toolName: result.call.name,
        ok: true,
        summary: result.result?.summary || "完成",
        data: result.result?.data,
        artifacts: result.result?.artifacts,
      });

      // 处理项目更新
      if (result.result?.updatedProject) {
        run.onProject(result.result.updatedProject);
        yield ev("project.update", {
          runId: run.ctx.projectId,
          project: result.result.updatedProject
        });
      }

      // 处理文件写入
      if (result.result?.fileWrites) {
        for (const path of result.result.fileWrites) {
          yield ev("file_write", { path });
        }
      }

      // 处理代码 diff
      if (result.result?.codeDiffs) {
        for (const diff of result.result.codeDiffs) {
          yield ev("code_diff", { ...diff, toolCallId: result.call.id });
        }
      }

      // 处理图像生成确认
      const imageConfirmation = asImageConfirmation(
        run.ctx.scratch.__imageGenerationConfirmation
      );
      if (result.call.name === "generate_images" && imageConfirmation) {
        delete run.ctx.scratch.__imageGenerationConfirmation;
        yield ev("image_generation.confirm", imageConfirmation);
        return;
      }
    } else {
      yield ev("tool_result", {
        id: result.call.id,
        name: result.call.name,
        toolName: result.call.name,
        ok: false,
        summary: result.error?.message || "执行失败",
      });
    }
  }

  // 输出性能摘要
  yield ev("thinking", {
    text: `\n✓ 完成 ${summary.successCount}/${summary.totalCalls} 工具 (${Math.round(summary.totalDuration)}ms)\n`
  });

  // 记录性能指标
  const sessionId = run.ctx.projectId || 'unknown';
  const metrics = createMetricsFromSummary(summary, sessionId, run.project?.id || null);
  performanceMonitor.recordParallelExecution(metrics);
}

interface ToolRunCtx {
  project: ProjectFile | null;
  userMessage: string;
  ctx: AgentContext;
  providerConfig?: ProviderConfig;
}

async function* streamChatAnswer(input: {
  project: ProjectFile | null;
  userMessage: string;
  ctx: AgentContext;
}): AsyncGenerator<ChatStreamEvent> {
  const system = composeAnswerSystemFromParts({
    project: input.project,
    agentCtx: input.ctx,
  });
  const llm = input.ctx.providers.llm;
  if (llm.generateTextStream) {
    for await (const chunk of llm.generateTextStream({
      system,
      prompt: input.userMessage,
    })) {
      if (chunk) yield ev("assistant_text", { text: chunk });
    }
    return;
  }
  const out = await llm.generateText({
    system,
    prompt: input.userMessage,
  });
  const text = isMockLlmText(out.text)
    ? `已收到你的问题："${input.userMessage}"。请配置真实 LLM 以获得回答。`
    : out.text;
  if (text) yield ev("assistant_text", { text });
}

async function runTool(call: ToolCall, run: ToolRunCtx) {
  registerAllTools();
  const budget = getRunBudget(run.ctx);
  reserveToolBudget(budget, call.name);

  const toolCtx: ToolContext = {
    project: run.project,
    userMessage: run.userMessage,
    agentCtx: run.ctx,
    providerConfig: run.providerConfig,
    toolCallId: call.id,
    runId: run.ctx.projectId,
  };

  return toolRegistry.execute(call.name, call.args ?? {}, toolCtx);
}

async function buildContext(
  providerConfig?: ProviderConfig,
  project?: ProjectFile | null
): Promise<AgentContext> {
  const { skill, designSystem } = await resolveSkillContext(providerConfig, project);
  const scratch: Record<string, unknown> = {};
  injectProviderScratch(scratch, providerConfig);
  return {
    projectId: resolveAgentContextProjectId(project),
    scratch,
    providers: resolveProviders(providerConfig),
    skill,
    designSystem,
  };
}

function getRunBudget(ctx: AgentContext): RunBudgetState {
  const key = "__runBudget";
  const existing = ctx.scratch[key];
  if (
    existing &&
    typeof existing === "object" &&
    typeof (existing as RunBudgetState).toolCallCount === "number" &&
    typeof (existing as RunBudgetState).estimatedCostUsd === "number"
  ) {
    return existing as RunBudgetState;
  }
  const next = createRunBudgetState();
  ctx.scratch[key] = next;
  return next;
}

function lastUserMessage(messages: ChatMessage[]): ChatMessage | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === "user") return messages[index];
  }
  return null;
}

function mapWsEventToChatEvent(
  wsEvent: { type: string; data: unknown },
  runId: string,
  projectId?: string
): ChatStreamEvent | null {
  if (wsEvent.type === "message.delta") {
    return ev("assistant_text", { text: String((wsEvent.data as { text?: string }).text ?? "") });
  }
  if (wsEvent.type === "thinking.delta") {
    return ev("thinking", { text: String((wsEvent.data as { text?: string }).text ?? "") });
  }
  if (wsEvent.type === "tool.started") {
    const data = wsEvent.data as { toolCallId?: string; toolName?: string; args?: unknown };
    return ev("tool_call", {
      id: data.toolCallId ?? `${runId}:${data.toolName ?? "tool"}`,
      name: data.toolName as ToolCall["name"],
      args: data.args as Record<string, unknown> | undefined,
    });
  }
  if (wsEvent.type === "tool.completed") {
    const data = wsEvent.data as {
      toolCallId?: string;
      toolName?: string;
      output?: unknown;
      outputSummary?: string;
      ok?: boolean;
      artifacts?: ToolResultEventData["artifacts"];
    };
    return ev("tool_result", {
      id: data.toolCallId ?? `${runId}:${data.toolName ?? "tool"}`,
      name: data.toolName as ToolCall["name"],
      toolName: data.toolName as ToolCall["name"],
      ok: data.ok !== false,
      summary: data.outputSummary ?? (typeof data.output === "string" ? data.output : undefined),
      data: data.output,
      artifacts: data.artifacts,
    });
  }
  if (wsEvent.type === "project.update") {
    const data = wsEvent.data as { project?: ProjectFile };
    return ev("project.update", { runId, project: data.project as ProjectFile });
  }
  if (wsEvent.type === "canvas.sync") {
    return ev("canvas.sync", { runId, projectId });
  }
  if (wsEvent.type === "run.completed") {
    return ev("done", { reason: "complete", projectId });
  }
  if (wsEvent.type === "run.waiting_user") {
    return ev("done", { reason: "complete", projectId });
  }
  if (wsEvent.type === "run.failed") {
    const data = wsEvent.data as { error?: string };
    return ev("error", { message: data.error ?? "Agent 运行失败" });
  }
  if (wsEvent.type === "run.cancelled") {
    return ev("done", { reason: "cancelled" });
  }
  if (wsEvent.type === "image_generation.confirm") {
    const confirmation = asImageConfirmation(wsEvent.data);
    return confirmation ? ev("image_generation.confirm", confirmation) : null;
  }
  if (wsEvent.type === "discovery.questions" || wsEvent.type === "direction.confirm") {
    return ev(wsEvent.type, wsEvent.data);
  }
  if (wsEvent.type.startsWith("job.")) {
    return ev(wsEvent.type as ChatStreamEvent["type"], wsEvent.data);
  }
  return null;
}

function asImageConfirmation(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const data = value as {
    title?: unknown;
    prompt?: unknown;
    reason?: unknown;
    count?: unknown;
    width?: unknown;
    height?: unknown;
    role?: unknown;
    runId?: unknown;
  };
  if (
    typeof data.title !== "string" ||
    typeof data.prompt !== "string" ||
    typeof data.reason !== "string" ||
    typeof data.count !== "number" ||
    typeof data.width !== "number" ||
    typeof data.height !== "number"
  ) {
    return null;
  }
  return {
    title: data.title,
    prompt: data.prompt,
    reason: data.reason,
    count: data.count,
    width: data.width,
    height: data.height,
    ...(typeof data.role === "string" ? { role: data.role } : {}),
    ...(typeof data.runId === "string" ? { runId: data.runId } : {}),
  };
}

function ev(type: ChatStreamEvent["type"], data: unknown): ChatStreamEvent {
  return { type, data };
}

export { parsePageReference };
