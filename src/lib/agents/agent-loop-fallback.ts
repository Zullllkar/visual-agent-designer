/**
 * Agent 循环回退
 * --------------------------------------------------------------
 * 当 LLM 不可用时，使用规则引擎替代 LangGraph ReAct Agent。
 * 复用现有的 decideToolsFallback 逻辑；chat 模式直接流式文字回答。
 */

import "server-only";

import { decideToolsFallback } from "@/lib/agents/orchestrator-planner";
import type { ToolCall } from "@/lib/agents/chat-schema";
import type { ProjectFile } from "@/lib/project/schema";
import type { AgentContext } from "@/lib/agents/types";
import type { ProviderConfig } from "@/lib/providers/registry";
import { registerAllTools } from "@/lib/agents/tools";
import { toolRegistry } from "@/lib/agents/tools/registry";
import { composeAnswerSystemFromParts } from "@/lib/agents/tools/answer-question";
import type { ToolContext } from "@/lib/agents/tools/types";
import type { WsEvent } from "@/lib/agents/stream-adapter";
import { createRunBudgetState, reserveToolBudget } from "@/lib/agents/agent-budget";
import { isMockLlmText } from "@/lib/providers/llm/utils";
import { emitThinkingChunks } from "@/lib/chat/live-timeline";

export interface FallbackRunInput {
  prompt: string;
  project: ProjectFile | null;
  agentCtx: AgentContext;
  providerConfig: ProviderConfig;
  runId: string;
}

export async function* runFallbackLoop(
  input: FallbackRunInput
): AsyncGenerator<WsEvent> {
  registerAllTools();

  const executedKeys = new Set<string>();
  const budget = createRunBudgetState();
  let project = input.project;

  const decision = decideToolsFallback(project, input.prompt);

  for (const chunk of emitThinkingChunks(decision.thinking)) {
    if (chunk.text) {
      yield {
        type: "thinking.delta",
        data: { text: chunk.text, runId: input.runId },
      };
    }
  }

  if (decision.mode === "chat" || decision.calls.length === 0) {
    yield* streamFallbackChatAnswer(input, project);
    yield { type: "run.completed", data: { runId: input.runId } };
    return;
  }

  const calls: ToolCall[] = decision.calls.slice(0, 8);

  for (const call of calls) {
    const tool = toolRegistry.get(call.name);
    const args = call.args ?? {};
    const dedupeKey = `${call.name}:${tool?.idempotencyKey?.(args) ?? JSON.stringify(args)}`;
    if (executedKeys.has(dedupeKey)) {
      yield {
        type: "tool.completed",
        data: {
          runId: input.runId,
          toolCallId: call.id,
          toolName: call.name,
          output: { skipped: true, reason: "duplicate_tool_call" },
          outputSummary: "Skipped duplicate tool call",
          ok: true,
        },
      };
      continue;
    }
    executedKeys.add(dedupeKey);

    try {
      reserveToolBudget(budget, call.name);
    } catch (e) {
      yield {
        type: "run.failed",
        data: { runId: input.runId, error: (e as Error).message },
      };
      return;
    }

    yield {
      type: "tool.started",
      data: {
        runId: input.runId,
        toolCallId: call.id,
        toolName: call.name,
        args: call.args,
      },
    };

    const toolCtx: ToolContext = {
      project,
      userMessage: input.prompt,
      agentCtx: input.agentCtx,
      providerConfig: input.providerConfig,
      runId: input.runId,
      toolCallId: call.id,
      onProjectUpdate: (next) => {
        project = next;
      },
    };

    try {
      const result = await toolRegistry.execute(call.name, args, toolCtx);

      if (result.updatedProject) {
        project = result.updatedProject;
        yield {
          type: "project.update",
          data: { runId: input.runId, project },
        };
      }

      yield {
        type: "tool.completed",
        data: {
          runId: input.runId,
          toolCallId: call.id,
          toolName: call.name,
          output: result.data ?? result.summary,
          outputSummary: result.summary,
          ok: true,
        },
      };
      if (
        call.name === "generate_images" &&
        input.agentCtx.scratch.__imageGenerationConfirmation
      ) {
        const confirmation = input.agentCtx.scratch.__imageGenerationConfirmation;
        delete input.agentCtx.scratch.__imageGenerationConfirmation;
        yield {
          type: "image_generation.confirm",
          data: { runId: input.runId, ...confirmation },
        };
        return;
      }
      if (
        call.name === "ask_discovery" &&
        input.agentCtx.scratch.__discoveryQuestions
      ) {
        const formData = input.agentCtx.scratch.__discoveryQuestions;
        delete input.agentCtx.scratch.__discoveryQuestions;
        yield {
          type: "discovery.questions",
          data: { runId: input.runId, ...formData },
        };
        return;
      }
      if (
        (call.name === "confirm_direction" ||
          call.name === "adopt_asset_style") &&
        input.agentCtx.scratch.__directionConfirmation
      ) {
        const direction = input.agentCtx.scratch.__directionConfirmation;
        delete input.agentCtx.scratch.__directionConfirmation;
        yield {
          type: "direction.confirm",
          data: { runId: input.runId, ...direction },
        };
        return;
      }
    } catch (e) {
      yield {
        type: "tool.completed",
        data: {
          runId: input.runId,
          toolCallId: call.id,
          toolName: call.name,
          output: { error: (e as Error).message },
          outputSummary: (e as Error).message,
          ok: false,
        },
      };
    }
  }

  yield { type: "run.completed", data: { runId: input.runId } };
}

async function* streamFallbackChatAnswer(
  input: FallbackRunInput,
  project: ProjectFile | null
): AsyncGenerator<WsEvent> {
  const system = composeAnswerSystemFromParts({
    project,
    agentCtx: input.agentCtx,
  });
  const llm = input.agentCtx.providers.llm;
  try {
    if (llm.generateTextStream) {
      for await (const chunk of llm.generateTextStream({
        system,
        prompt: input.prompt,
      })) {
        if (chunk) {
          yield {
            type: "message.delta",
            data: { text: chunk, runId: input.runId },
          };
        }
      }
      return;
    }
    const out = await llm.generateText({
      system,
      prompt: input.prompt,
    });
    const text = isMockLlmText(out.text)
      ? `已收到你的问题："${input.prompt}"。请配置真实 LLM 以获得回答。`
      : out.text;
    if (text) {
      yield {
        type: "message.delta",
        data: { text, runId: input.runId },
      };
    }
  } catch (e) {
    yield {
      type: "message.delta",
      data: {
        text: `暂时无法回答：${(e as Error).message}`,
        runId: input.runId,
      },
    };
  }
}
