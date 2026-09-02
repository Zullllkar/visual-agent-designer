import "server-only";

import { nanoid } from "nanoid";
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
import { emitThinkingChunks, toolDisplayLabel } from "@/lib/chat/live-timeline";
import { deriveDesignContext } from "@/lib/project/design-context";
import { registerAllTools, toolRegistry, type ToolContext } from "./tools";
import { composeAnswerSystemFromParts } from "./tools/answer-question";
import { agentRuns } from "./agent-run-service";
import { getCheckpointer, threadIdForProject } from "./checkpoint";
import { createRunBudgetState, reserveToolBudget, type RunBudgetState } from "./agent-budget";
import { isMockLlmText } from "@/lib/providers/llm/utils";

export interface ChatTurnInput {
  project: ProjectFile | null;
  messages: ChatMessage[];
  providerConfig?: ProviderConfig;
}

export interface ChatTurnResult {
  updatedProject: ProjectFile | null;
}

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
      const fallback = runChatTurn(input);
      for await (const event of fallback.events) {
        yield event;
      }
      try {
        resolveResult(await fallback.resultPromise);
      } catch (fallbackError) {
        rejectResult(fallbackError);
      }
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
  let project = run.project;
  for (const call of calls) {
    yield ev("tool_call", {
      id: call.id,
      name: call.name,
      args: call.args,
    });
    yield ev("thinking", { text: `\n• ${toolDisplayLabel(call.name)}...\n` });

    try {
      const result = await runTool(call, {
        project,
        userMessage: run.userMessage,
        ctx: run.ctx,
        providerConfig: run.providerConfig,
      });

      if (result.fileWrites) {
        for (const path of result.fileWrites) yield ev("file_write", { path });
      }
      if (result.codeDiffs) {
        for (const diff of result.codeDiffs) {
          yield ev("code_diff", { ...diff, toolCallId: call.id });
        }
      }
      if (result.updatedProject) {
        project = result.updatedProject;
        run.onProject(project);
        yield ev("project.update", { runId: run.ctx.projectId, project });
      }

      yield ev("tool_result", {
        id: call.id,
        name: call.name,
        toolName: call.name,
        ok: true,
        summary: result.summary,
        data: result.data,
        artifacts: result.artifacts,
      });

      const imageConfirmation = asImageConfirmation(
        run.ctx.scratch.__imageGenerationConfirmation
      );
      if (call.name === "generate_images" && imageConfirmation) {
        delete run.ctx.scratch.__imageGenerationConfirmation;
        yield ev("image_generation.confirm", imageConfirmation);
        return;
      }
    } catch (error) {
      yield ev("tool_result", {
        id: call.id,
        name: call.name,
        toolName: call.name,
        ok: false,
        summary: (error as Error).message,
      });
    }
  }
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
    projectId: project?.id ?? nanoid(10),
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
