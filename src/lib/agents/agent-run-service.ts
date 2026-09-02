/**
 * Agent 运行服务
 * --------------------------------------------------------------
 * 管理 Agent 运行生命周期：创建、流式执行、取消。
 */

import "server-only";

import { nanoid } from "nanoid";
import type { BaseCheckpointSaver } from "@langchain/langgraph";

import type { ProviderConfig } from "@/lib/providers/registry";
import type { ProjectFile } from "@/lib/project/schema";
import type { AgentContext } from "@/lib/agents/types";
import { createVadAgent } from "./langgraph-agent";
import { adaptStreamEvents, type WsEvent } from "./stream-adapter";
import { clearProjectMemory, getCheckpointer } from "./checkpoint";
import { isContextLengthError } from "./context-budget";
import { runFallbackLoop } from "./agent-loop-fallback";
import { inferInitialPhase, type AgentPhase } from "./agent-phase";
import { saveRun } from "./run-persist";
import { saveProjectToVad } from "@/lib/vad/storage";
import { loadWorkspaceRules, formatRulesForPrompt } from "./workspace-rules";
import { hookManager } from "./hooks";
import type { RiskLevel } from "./tools/types";
import { registerAllTools, toolRegistry } from "./tools";
import { normalizeGenerateImagesApprovalArgs } from "./tools/generate-images-approval";
import { parsePageReference } from "./orchestrator-planner";
import { collectProjectReferenceImages } from "./reference-images";
import { isWaitingChatTurn, runBlocksNewAgentTurn } from "./run-lock";

export type RunStatus =
  | "accepted"
  | "running"
  | "waiting_user"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface AgentRun {
  runId: string;
  threadId: string;
  projectId: string;
  status: RunStatus;
  startedAt: number;
  endedAt?: number;
  error?: string;
  phase: AgentPhase;
  currentStep?: string;
  lastHeartbeatAt?: number;
  prompt?: string;
  promptSummary?: string;
  pendingToolApproval?: PendingToolApproval;
  /** 关联的 Job IDs */
  jobIds: string[];
}

export interface PendingToolApproval {
  approvalId: string;
  checkpointInterruptId?: string;
  toolName: string;
  toolCallId?: string;
  args: Record<string, unknown>;
  riskLevel: RiskLevel;
  reason: string;
  requestedAt: number;
  status: "pending" | "approved" | "cancelled";
}

export interface CreateRunInput {
  threadId: string;
  prompt: string;
  project: ProjectFile | null;
  agentCtx: AgentContext;
  providerConfig: ProviderConfig;
  checkpointer?: BaseCheckpointSaver;
}

class AgentRunService {
  private runs = new Map<string, AgentRun>();
  private abortControllers = new Map<string, AbortController>();
  private resumeLocks = new Set<string>();

  createRun(input: CreateRunInput): AgentRun {
    const runId = nanoid(12);
    const run: AgentRun = {
      runId,
      threadId: input.threadId,
      projectId: input.agentCtx.projectId,
      status: "accepted",
      startedAt: Date.now(),
      phase: inferInitialPhase(input.project),
      lastHeartbeatAt: Date.now(),
      prompt: input.prompt,
      promptSummary: summarizePrompt(input.prompt),
      jobIds: [],
    };
    this.runs.set(runId, run);
    // 持久化初始状态
    saveRun(input.agentCtx.projectId, run).catch(() => {});
    return run;
  }

  async *streamRun(
    runId: string,
    input: CreateRunInput
  ): AsyncGenerator<WsEvent> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);

    const abortController = new AbortController();
    this.abortControllers.set(runId, abortController);
    run.status = "running";
    run.lastHeartbeatAt = Date.now();
    saveRun(input.agentCtx.projectId, run).catch(() => {});
    let timeoutInterrupted = false;
    const maxRunMs = 15 * 60_000;
    const timeout = setTimeout(() => {
      timeoutInterrupted = true;
      abortController.abort();
    }, maxRunMs);
    const heartbeat = setInterval(() => {
      run.lastHeartbeatAt = Date.now();
      saveRun(input.agentCtx.projectId, run).catch(() => {});
    }, 15_000);

    // 累积 assistant 消息文本，运行完成后持久化
    let assistantText = "";
    const toolCalls: Array<{ name: string; summary?: string }> = [];
    const runStartTime = Date.now();

    // beforeRun 钩子
    await hookManager.beforeRun({
      runId,
      threadId: input.threadId,
      projectId: input.agentCtx.projectId,
      phase: run.phase,
      project: input.project,
      prompt: input.prompt,
    });

    seedReferenceScratch(input.agentCtx, input.project, input.prompt);

    try {
      // 加载 workspace rules
      const rules = await loadWorkspaceRules(input.agentCtx.projectId);
      const rulesPrompt = formatRulesForPrompt(rules);
      const llm = input.providerConfig.llm as
        | { kind?: string; model?: string }
        | undefined;
      yield {
        type: "llm.requested",
        data: {
          runId,
          provider: llm?.kind ?? "unknown",
          model: llm?.model,
        },
      };
      // 不再注入「正在连接 LLM」假思考——侧栏用真实 thinking / 助手流式即可

      const agent = createVadAgent({
        providerConfig: input.providerConfig,
        project: input.project,
        agentCtx: input.agentCtx,
        userMessage: input.prompt,
        checkpointer: input.checkpointer ?? getCheckpointer(),
        threadId: input.threadId,
        runId,
        rulesPrompt,
        abortSignal: abortController.signal,
      });

      yield {
        type: "llm.started",
        data: { runId },
      };
      const stream = agent.streamEvents(
        { messages: [{ role: "user", content: input.prompt }] },
        {
          version: "v2",
          configurable: { thread_id: input.threadId },
          signal: abortController.signal,
          recursionLimit: 50,
        }
      );

      let waitingForUser = false;
      for await (const event of adaptStreamEvents(stream, runId, input.agentCtx, input.threadId)) {
        // 累积 message.delta 文本
        if (event.type === "message.delta") {
          const delta = (event.data as { text?: string }).text;
          if (delta) assistantText += delta;
        }
        // 记录工具调用
        if (event.type === "tool.completed") {
          const d = event.data as { toolName?: string; outputSummary?: string };
          toolCalls.push({ name: d.toolName ?? "unknown", summary: d.outputSummary });
        }
        if (event.type === "tool.started") {
          const d = event.data as { toolName?: string };
          run.currentStep = d.toolName ?? "tool";
          run.lastHeartbeatAt = Date.now();
          saveRun(input.agentCtx.projectId, run).catch(() => {});
        } else if (event.type === "tool.completed") {
          const d = event.data as { toolName?: string };
          run.currentStep = d.toolName ? `${d.toolName}:done` : undefined;
          run.lastHeartbeatAt = Date.now();
          saveRun(input.agentCtx.projectId, run).catch(() => {});
        }
        const currentPhase = input.agentCtx.scratch.__currentPhase;
        if (typeof currentPhase === "string") {
          run.phase = currentPhase as AgentPhase;
          run.lastHeartbeatAt = Date.now();
          saveRun(input.agentCtx.projectId, run).catch(() => {});
        }
        if (event.type === "project.update") {
          const updatedProject = (event.data as { project?: ProjectFile }).project;
          if (updatedProject) {
            await saveProjectToVad(updatedProject).catch(() => undefined);
          }
        }
        yield event;
        if (event.type === "tool.confirm") {
          const data = event.data as {
            approvalId?: string;
            checkpointInterruptId?: string;
            toolName?: string;
            toolCallId?: string;
            args?: Record<string, unknown>;
            riskLevel?: RiskLevel;
            reason?: string;
          };
          if (data.approvalId && data.toolName) {
            const pendingArgs = normalizePendingToolArgs(
              data.toolName,
              data.args ?? {},
              input.project,
              input.prompt,
              input.agentCtx,
              input.providerConfig,
              runId
            );
            run.pendingToolApproval = {
              approvalId: data.approvalId,
              checkpointInterruptId: data.checkpointInterruptId,
              toolName: data.toolName,
              toolCallId: data.toolCallId,
              args: pendingArgs,
              riskLevel: data.riskLevel ?? "moderate",
              reason: data.reason ?? "Tool execution requires confirmation.",
              requestedAt: Date.now(),
              status: "pending",
            };
            run.lastHeartbeatAt = Date.now();
            await saveRun(input.agentCtx.projectId, run).catch(() => {});
          }
        }
        if (event.type === "tool.confirm") {
          waitingForUser = true;
          break;
        }
        if (
          event.type === "discovery.questions" ||
          event.type === "direction.confirm" ||
          event.type === "image_generation.confirm"
        ) {
          waitingForUser = true;
          break;
        }
      }

      yield {
        type: "llm.completed",
        data: { runId },
      };
      run.status = waitingForUser ? "waiting_user" : "completed";
      run.endedAt = Date.now();
      await saveRun(input.agentCtx.projectId, run).catch(() => {});
      await hookManager.afterRun({
        runId,
        threadId: input.threadId,
        projectId: input.agentCtx.projectId,
        phase: run.phase,
        project: input.project,
        status: waitingForUser ? "waiting_user" : "completed",
        durationMs: Date.now() - runStartTime,
      });
      yield waitingForUser
        ? {
            type: "run.waiting_user",
            data: { runId, reason: "user_input_required" },
          }
        : {
            type: "run.completed",
            data: { runId, waitingForUser: false },
          };

      // 持久化 user + assistant 消息到 chat-history.jsonl
    } catch (e) {
      // 如果是取消操作，直接返回
      if (abortController.signal.aborted) {
        run.status = timeoutInterrupted ? "interrupted" : "cancelled";
        run.error = timeoutInterrupted
          ? `Run exceeded ${Math.round(maxRunMs / 60_000)} minutes`
          : undefined;
        run.endedAt = Date.now();
        run.lastHeartbeatAt = Date.now();
        saveRun(input.agentCtx.projectId, run).catch(() => {});
        await hookManager.afterRun({
          runId,
          threadId: input.threadId,
          projectId: input.agentCtx.projectId,
          phase: run.phase,
          project: input.project,
          status: timeoutInterrupted ? "interrupted" : "cancelled",
          durationMs: Date.now() - runStartTime,
          error: run.error,
        });
        yield timeoutInterrupted
          ? { type: "run.interrupted", data: { runId, error: run.error } }
          : { type: "run.cancelled", data: { runId, error: (e as Error).message } };
        return;
      }

      // LLM 不可用时回退到规则引擎
      const errMsg = (e as Error).message;
      if (isToolMessageOrderingError(errMsg) || isContextLengthError(errMsg)) {
        await clearProjectMemory(input.agentCtx.projectId).catch(() => undefined);
        const retryKey = isContextLengthError(errMsg)
          ? "__checkpointContextRetried"
          : "__checkpointToolOrderRetried";
        const alreadyRetried = input.agentCtx.scratch[retryKey] === true;
        input.agentCtx.scratch[retryKey] = true;
        const isContext = isContextLengthError(errMsg);
        yield {
          type: "agent.fallback",
          data: {
            reason: isContext ? "context_reset" : "checkpoint_reset",
            text: alreadyRetried
              ? isContext
                ? "\n会话记忆已清空，但上下文仍然过大。请精简项目或新开对话后再试。\n"
                : "\n会话记忆已重置，但工具调用历史再次出错。\n"
              : isContext
                ? "\n会话记忆过大导致超出模型上下文上限，已自动清空记忆并重试本轮请求。\n"
                : "\n会话记忆不完整，已重置并自动重试。\n",
            runId,
          },
        };
        if (!alreadyRetried) {
          run.status = "running";
          run.error = undefined;
          run.currentStep = isContext
            ? "checkpoint:context_reset_retry"
            : "checkpoint:reset_retry";
          run.endedAt = undefined;
          run.lastHeartbeatAt = Date.now();
          saveRun(input.agentCtx.projectId, run).catch(() => {});
          for await (const retryEvent of this.streamRun(runId, input)) {
            yield retryEvent;
          }
          return;
        }
        run.status = "failed";
        run.error = isContext
          ? "模型上下文超限：清空会话记忆后重试仍失败。"
          : "LangGraph checkpoint contained an incomplete tool-call history and retry after reset also failed.";
        run.endedAt = Date.now();
        run.lastHeartbeatAt = Date.now();
        run.currentStep = isContext
          ? "checkpoint:context_reset_failed"
          : "checkpoint:reset_failed";
        saveRun(input.agentCtx.projectId, run).catch(() => {});
        await hookManager.afterRun({
          runId,
          threadId: input.threadId,
          projectId: input.agentCtx.projectId,
          phase: run.phase,
          project: input.project,
          status: "failed",
          durationMs: Date.now() - runStartTime,
          error: run.error,
        });
        yield {
          type: "run.failed",
          data: {
            runId,
            error: run.error,
            code: isContext
              ? "CONTEXT_LENGTH_EXCEEDED"
              : "CHECKPOINT_TOOL_MESSAGE_ORDER",
            retryable: true,
          },
        };
        return;
      }
      yield {
        type: "llm.failed",
        data: { runId, error: errMsg },
      };
      const isLlmUnavailable =
        errMsg.includes("Mock") ||
        errMsg.includes("不支持的 LLM") ||
        errMsg.includes("API") ||
        errMsg.includes("fetch") ||
        errMsg.includes("timeout");

      if (isLlmUnavailable) {
        yield {
          type: "agent.fallback",
          data: {
            reason: "llm_unavailable",
            text: "\n模型请求失败，已改用本地规则流程继续。\n",
            runId,
          },
        };

        for await (const fallbackEvent of runFallbackLoop({
          prompt: input.prompt,
          project: input.project,
          agentCtx: input.agentCtx,
          providerConfig: input.providerConfig,
          runId,
        })) {
          yield fallbackEvent;
          if (fallbackEvent.type === "image_generation.confirm") {
            run.status = "waiting_user";
            run.endedAt = Date.now();
            saveRun(input.agentCtx.projectId, run).catch(() => {});
            yield {
              type: "run.waiting_user",
              data: { runId, reason: "user_input_required" },
            };
            return;
          }
        }

        run.status = "completed";
        run.endedAt = Date.now();
        saveRun(input.agentCtx.projectId, run).catch(() => {});
      } else {
        run.status = "failed";
        run.error = errMsg;
        run.endedAt = Date.now();
        saveRun(input.agentCtx.projectId, run).catch(() => {});
        await hookManager.afterRun({
          runId,
          threadId: input.threadId,
          projectId: input.agentCtx.projectId,
          phase: run.phase,
          project: input.project,
          status: "failed",
          durationMs: Date.now() - runStartTime,
          error: errMsg,
        });
        yield {
          type: "run.failed",
          data: {
            runId,
            error: errMsg,
            code: classifyAgentError(e as Error),
            retryable: isAgentRetryable(e as Error),
          },
        };
      }
    } finally {
      clearTimeout(timeout);
      clearInterval(heartbeat);
      this.abortControllers.delete(runId);
    }
  }

  hydrateRun(run: AgentRun): AgentRun {
    const existing = this.runs.get(run.runId);
    if (existing) return existing;
    this.runs.set(run.runId, run);
    return run;
  }

  async *resumeToolApproval(
    runId: string,
    input: CreateRunInput,
    approvalId: string,
    action: "approve" | "cancel" = "approve",
    args?: Record<string, unknown>
  ): AsyncGenerator<WsEvent> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);

    const pending = run.pendingToolApproval;
    if (!pending || pending.approvalId !== approvalId) {
      throw new Error("No matching pending tool approval");
    }
    if (pending.status !== "pending") {
      yield {
        type: "tool.completed",
        data: {
          runId,
          approvalId,
          toolName: pending.toolName,
          toolCallId: pending.toolCallId,
          ok: pending.status === "approved",
          approved: pending.status === "approved",
          outputSummary: `Tool approval is already ${pending.status}.`,
          output: {
            ok: pending.status === "approved",
            summary: `Tool approval is already ${pending.status}.`,
            data: { approvalId, status: pending.status, alreadyHandled: true },
          },
        },
      };
      yield pending.status === "approved"
        ? {
            type: "run.completed",
            data: {
              runId,
              approvalId,
              waitingForUser: false,
              approvedTool: pending.toolName,
              alreadyHandled: true,
            },
          }
        : { type: "run.cancelled", data: { runId, approvalId, alreadyHandled: true } };
      return;
    }
    if (this.resumeLocks.has(runId)) {
      throw new Error("Run approval is already resuming");
    }
    this.resumeLocks.add(runId);

    const abortController = new AbortController();
    this.abortControllers.set(runId, abortController);
    run.status = "running";
    run.currentStep = action === "approve" ? pending.toolName : `${pending.toolName}:cancel`;
    run.endedAt = undefined;
    run.lastHeartbeatAt = Date.now();
    run.pendingToolApproval = {
      ...pending,
      ...(action === "approve" && args ? { args } : {}),
      status: action === "approve" ? "approved" : "cancelled",
    };
    input.agentCtx.scratch.__currentPhase = run.phase;
    saveRun(input.agentCtx.projectId, run).catch(() => {});

    const heartbeat = setInterval(() => {
      run.lastHeartbeatAt = Date.now();
      saveRun(input.agentCtx.projectId, run).catch(() => {});
    }, 15_000);
    const runStartTime = Date.now();

    try {
      registerAllTools();
      const approvedArgs = normalizePendingToolArgs(
        pending.toolName,
        args ?? pending.args,
        input.project,
        input.prompt,
        input.agentCtx,
        input.providerConfig,
        runId
      );

      if (action === "cancel") {
        run.status = "cancelled";
        run.currentStep = `${pending.toolName}:cancelled`;
        run.endedAt = Date.now();
        run.lastHeartbeatAt = Date.now();
        saveRun(input.agentCtx.projectId, run).catch(() => {});
        yield {
          type: "tool.completed",
          data: {
            runId,
            approvalId,
            toolName: pending.toolName,
            toolCallId: pending.toolCallId,
            ok: false,
            outputSummary: `${pending.toolName} was cancelled by the user.`,
            output: {
              ok: false,
              summary: `${pending.toolName} was cancelled by the user.`,
              data: { cancelled: true, approvalId },
            },
          },
        };
        await hookManager.afterRun({
          runId,
          threadId: run.threadId,
          projectId: input.agentCtx.projectId,
          phase: run.phase,
          project: input.project,
          status: "cancelled",
          durationMs: Date.now() - runStartTime,
        });
        yield { type: "run.cancelled", data: { runId, approvalId } };
        return;
      }

      const agentTool = toolRegistry.get(pending.toolName);
      if (!agentTool) throw new Error(`Unknown approved tool: ${pending.toolName}`);

      const finalArgs = { ...approvedArgs, confirmed: true, approvalId };
      const hookCtx = {
        runId,
        threadId: run.threadId,
        projectId: input.agentCtx.projectId,
        phase: run.phase,
        project: input.project,
      };

      yield {
        type: "thinking.delta",
        data: {
          text: `\nUser approved ${pending.toolName}. Executing the approved tool now.\n`,
          runId,
        },
      };
      yield {
        type: "tool.started",
        data: {
          runId,
          toolName: pending.toolName,
          toolCallId: pending.toolCallId,
          args: finalArgs,
          approved: true,
        },
      };

      await hookManager.beforeTool({
        ...hookCtx,
        toolName: pending.toolName,
        toolArgs: finalArgs,
      });

      const started = Date.now();
      const result = await toolRegistry.execute(pending.toolName, finalArgs, {
        project: input.project,
        userMessage: input.prompt,
        agentCtx: input.agentCtx,
        providerConfig: input.providerConfig,
        runId,
        toolCallId: pending.toolCallId,
        abortSignal: abortController.signal,
      });
      const durationMs = Date.now() - started;

      await hookManager.afterTool({
        ...hookCtx,
        toolName: pending.toolName,
        toolArgs: finalArgs,
        result: { summary: result.summary, data: result.data },
        durationMs,
      });

      run.currentStep = `${pending.toolName}:done`;
      const currentPhase = input.agentCtx.scratch.__currentPhase;
      if (typeof currentPhase === "string") {
        run.phase = currentPhase as AgentPhase;
      }
      run.status = "completed";
      run.endedAt = Date.now();
      run.lastHeartbeatAt = Date.now();
      saveRun(input.agentCtx.projectId, run).catch(() => {});

      yield {
        type: "tool.completed",
        data: {
          runId,
          approvalId,
          toolName: pending.toolName,
          toolCallId: pending.toolCallId,
          output: {
            ok: true,
            summary: result.summary,
            data: result.data,
          },
          outputSummary: result.summary,
          ok: true,
          approved: true,
        },
      };

      if (result.updatedProject) {
        await saveProjectToVad(result.updatedProject).catch(() => undefined);
        yield {
          type: "project.update",
          data: { runId, project: result.updatedProject },
        };
      }

      await hookManager.afterRun({
        runId,
        threadId: run.threadId,
        projectId: input.agentCtx.projectId,
        phase: run.phase,
        project: result.updatedProject ?? input.project,
        status: "completed",
        durationMs: Date.now() - runStartTime,
      });
      yield {
        type: "run.completed",
        data: { runId, approvalId, waitingForUser: false, approvedTool: pending.toolName },
      };
    } catch (e) {
      if (abortController.signal.aborted) {
        run.status = "cancelled";
        run.endedAt = Date.now();
        run.lastHeartbeatAt = Date.now();
        saveRun(input.agentCtx.projectId, run).catch(() => {});
        yield { type: "run.cancelled", data: { runId, error: (e as Error).message } };
        return;
      }

      const errMsg = (e as Error).message;
      run.status = "failed";
      run.error = errMsg;
      run.endedAt = Date.now();
      run.lastHeartbeatAt = Date.now();
      saveRun(input.agentCtx.projectId, run).catch(() => {});
      await hookManager.afterRun({
        runId,
        threadId: run.threadId,
        projectId: input.agentCtx.projectId,
        phase: run.phase,
        project: input.project,
        status: "failed",
        durationMs: Date.now() - runStartTime,
        error: errMsg,
      });
      yield {
        type: "run.failed",
        data: {
          runId,
          error: errMsg,
          code: classifyAgentError(e as Error),
          retryable: isAgentRetryable(e as Error),
        },
      };
    } finally {
      clearInterval(heartbeat);
      this.abortControllers.delete(runId);
      this.resumeLocks.delete(runId);
    }
  }

  cancel(runId: string) {
    const run = this.runs.get(runId);
    if (run?.status === "waiting_user") {
      run.status = "cancelled";
      run.endedAt = Date.now();
      run.lastHeartbeatAt = Date.now();
      saveRun(run.projectId, run).catch(() => {});
      return;
    }
    if (run && (run.status === "accepted" || run.status === "running")) {
      run.status = "cancelling";
      run.lastHeartbeatAt = Date.now();
      saveRun(run.projectId, run).catch(() => {});
    }
    this.abortControllers.get(runId)?.abort();
  }

  /** 用户开新一轮时清掉卡住的等待确认 / 无心跳僵尸 run。 */
  supersedeBlockingRun(runId: string): AgentRun | undefined {
    const run = this.runs.get(runId);
    if (!run) return undefined;
    if (run.pendingToolApproval?.status === "pending") {
      run.pendingToolApproval = { ...run.pendingToolApproval, status: "cancelled" };
    }
    run.status = "cancelled";
    run.endedAt = Date.now();
    run.lastHeartbeatAt = Date.now();
    this.abortControllers.get(runId)?.abort();
    this.abortControllers.delete(runId);
    this.resumeLocks.delete(runId);
    saveRun(run.projectId, run).catch(() => {});
    return run;
  }

  getRun(runId: string): AgentRun | undefined {
    return this.runs.get(runId);
  }

  listRuns(projectId?: string): AgentRun[] {
    return [...this.runs.values()]
      .filter((run) => !projectId || run.projectId === projectId)
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  getActiveRunForThread(threadId: string): AgentRun | undefined {
    return [...this.runs.values()].find(
      (run) => run.threadId === threadId && runBlocksNewAgentTurn(run)
    );
  }

  /** 需求确认 / 方向确认：用户下一条消息开新轮，先结束等待中的 chat wait */
  releaseWaitingChatTurn(threadId: string): AgentRun | undefined {
    const run = [...this.runs.values()].find(
      (item) => item.threadId === threadId && isWaitingChatTurn(item)
    );
    if (!run) return undefined;
    run.status = "completed";
    run.endedAt = Date.now();
    run.lastHeartbeatAt = Date.now();
    saveRun(run.projectId, run).catch(() => {});
    return run;
  }

  /** 将 Job 关联到 Run */
  addJobToRun(runId: string, jobId: string): void {
    const run = this.runs.get(runId);
    if (run) {
      run.jobIds.push(jobId);
    }
  }

  /*
  private async persistMessages(
    input: CreateRunInput,
    assistantText: string,
    toolCalls: Array<{ name: string; summary?: string }>
  ): Promise<void> {
    try {
      const projectId = input.agentCtx.projectId;
      const now = new Date().toISOString();

      // 加载已有历史
      const existing = await loadChatHistoryFromVad(projectId).catch(() => [] as ChatMessage[]);

      const userMsg: ChatMessage = {
        id: nanoid(12),
        role: "user",
        content: input.prompt,
        createdAt: now,
      };

      const assistantMsg: ChatMessage = {
        id: nanoid(12),
        role: "assistant",
        content: assistantText || "(无文本输出)",
        createdAt: now,
      };

      const updated = [...existing, userMsg, assistantMsg];
      await saveChatHistoryToVad(projectId, updated);
    } catch {
      // 持久化失败不影响运行结果
    }
  }
}

  */
}

export const agentRuns = new AgentRunService();

function summarizePrompt(prompt: string): string {
  const oneLine = prompt.replace(/\s+/g, " ").trim();
  if (oneLine.length <= 160) return oneLine;
  return `${oneLine.slice(0, 157)}...`;
}

function normalizePendingToolArgs(
  toolName: string,
  args: Record<string, unknown>,
  project: ProjectFile | null,
  userMessage: string,
  agentCtx: AgentContext,
  providerConfig: ProviderConfig,
  runId: string
): Record<string, unknown> {
  if (toolName !== "generate_images") return args;
  return normalizeGenerateImagesApprovalArgs(args, {
    project,
    userMessage,
    agentCtx,
    providerConfig,
    runId,
  });
}

function isToolMessageOrderingError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("assistant message with 'tool_calls'") &&
    normalized.includes("tool messages responding to each 'tool_call_id'")
  ) || (
    normalized.includes("tool_calls") &&
    normalized.includes("insufficient tool messages")
  );
}

function classifyAgentError(err: Error): string {
  const msg = err.message.toLowerCase();
  if (msg.includes("api key") || msg.includes("unauthorized") || msg.includes("401")) return "AUTH_ERROR";
  if (msg.includes("rate limit") || msg.includes("429") || msg.includes("quota")) return "RATE_LIMIT";
  if (msg.includes("timeout") || msg.includes("timed out")) return "TIMEOUT";
  if (msg.includes("network") || msg.includes("econnrefused") || msg.includes("fetch")) return "NETWORK_ERROR";
  if (msg.includes("recursion") || msg.includes("max iterations")) return "AGENT_LIMIT";
  if (isToolMessageOrderingError(err.message)) return "CHECKPOINT_TOOL_MESSAGE_ORDER";
  if (isContextLengthError(err.message)) return "CONTEXT_LENGTH_EXCEEDED";
  if (msg.includes("mock")) return "MOCK_PROVIDER";
  if (msg.includes("insufficient") || msg.includes("credits") || msg.includes("billing")) return "BILLING_ERROR";
  if (msg.includes("plan limit") || msg.includes("subscription")) return "PLAN_LIMIT";
  return "INTERNAL_ERROR";
}

function isAgentRetryable(err: Error): boolean {
  return ["RATE_LIMIT", "TIMEOUT", "NETWORK_ERROR"].includes(classifyAgentError(err));
}

/** 从用户消息【参考图】前缀 + project.references 预填 scratch，供 generate_images 消费 */
function seedReferenceScratch(
  agentCtx: AgentContext,
  project: ProjectFile | null,
  prompt: string
): void {
  const parsed = parsePageReference(prompt);
  const preferIds = [
    ...parsed.referenceIds,
    ...(parsed.assetId ? [parsed.assetId] : []),
  ];
  if (preferIds.length > 0) {
    agentCtx.scratch.composerReferenceIds = preferIds;
    agentCtx.scratch.composerReferenceLabels = parsed.referenceLabels;
    if (parsed.assetId) agentCtx.scratch.citedAssetId = parsed.assetId;
  }
  const collected = collectProjectReferenceImages(project, {
    preferIds,
    max: 3,
  });
  if (collected.srcs.length === 0) return;
  agentCtx.scratch.referenceImages = collected.srcs;
  agentCtx.scratch.referenceLabels = collected.labels;
  agentCtx.scratch.referenceIds = collected.ids;
}
