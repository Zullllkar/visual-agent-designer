import "server-only";

import { createHash } from "node:crypto";
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { parseImageGenerationConfirmation } from "@/lib/agents/image-generation-confirmation";
import {
  applyApprovalDecision,
  awaitUserToolApproval,
  readTrustedToolResume,
  shouldPauseToolForConfirmation,
} from "@/lib/agents/tool-confirmation-pause";

import { createRunBudgetState, reserveToolBudget } from "@/lib/agents/agent-budget";
import { bindGenerationProject } from "@/lib/generation/ledger-context";
import { inferInitialPhase, phaseLabel, resolveNextPhase, type AgentPhase } from "@/lib/agents/agent-phase";
import { isChatInlineTool } from "@/lib/agents/chat-inline-tools";
import { truncateToolResultForLlm } from "@/lib/agents/context-budget";
import { createContextWindowPreModelHook } from "@/lib/agents/context-window";
import { costTracker } from "@/lib/agents/cost-tracker";
import { hookManager } from "@/lib/agents/hooks";
import { buildEnhancedSystemPrompt } from "@/lib/agents/enhanced-system-prompt";
import { registerAllTools, toolRegistry } from "@/lib/agents/tools";
import {
  imageToolApprovalId,
  prepareGenerateImagesApproval,
} from "@/lib/agents/tools/generate-images-approval";
import { prepareVariantImageApproval } from "@/lib/agents/tools/generate-image-variants";
import { toolRequiresConfirmation, toolRiskLevel } from "@/lib/agents/tools/tool-risk";
import { isToolGrantedByProject } from "@/lib/agents/tool-approval-policy";
import type { ToolContext } from "@/lib/agents/tools/types";
import type { AgentContext } from "@/lib/agents/types";
import type { ProjectFile } from "@/lib/project/schema";
import type { ProviderConfig } from "@/lib/providers/registry";

export interface CreateAgentOptions {
  providerConfig: ProviderConfig;
  project: ProjectFile | null;
  agentCtx: AgentContext;
  userMessage: string;
  checkpointer?: BaseCheckpointSaver;
  threadId?: string;
  runId?: string;
  rulesPrompt?: string;
  abortSignal?: AbortSignal;
}

export function createVadAgent(options: CreateAgentOptions) {
  bindGenerationProject(options.agentCtx.projectId);
  const llm = createChatModel(options.providerConfig, options.agentCtx.projectId);
  registerAllTools();
  if (options.project?.targetId) {
    options.agentCtx.scratch.targetId = options.project.targetId;
  }
  if (options.project?.directionCardId) {
    options.agentCtx.scratch.directionCardId = options.project.directionCardId;
  }

  const toolCtx: ToolContext = {
    project: options.project,
    userMessage: options.userMessage,
    agentCtx: options.agentCtx,
    providerConfig: options.providerConfig,
    runId: options.runId,
    abortSignal: options.abortSignal,
    onProjectUpdate: (project) => {
      options.agentCtx.scratch.__updatedProject = project;
      toolCtx.project = project;
    },
  };

  const completedToolCalls = new Set<string>();
  const budget = createRunBudgetState();
  let currentPhase: AgentPhase =
    typeof options.agentCtx.scratch.__currentPhase === "string"
      ? (options.agentCtx.scratch.__currentPhase as AgentPhase)
      : inferInitialPhase(options.project);
  options.agentCtx.scratch.__currentPhase = currentPhase;

  // Chat-inline tools (e.g. answer_question) stay registered for fallback/compat
  // but are not exposed to the ReAct agent — pure Q&A must stream as assistant text.
  const langchainTools: StructuredToolInterface[] = toolRegistry
    .list()
    .filter((agentTool) => !isChatInlineTool(agentTool.name))
    .map((agentTool) =>
    tool(
      async (
        args: Record<string, unknown>,
        runtime?: { toolCallId?: string; toolCall?: { id?: string } }
      ) => {
        let toolArgs = args;
        const nativeToolCallId = runtime?.toolCallId ?? runtime?.toolCall?.id;
        const trustedResume = readTrustedToolResume(options.agentCtx.scratch);
        if (trustedResume?.toolName === agentTool.name) {
          toolArgs = {
            ...toolArgs,
            ...trustedResume.args,
            confirmed: true,
            approvalId: trustedResume.approvalId,
          };
        }
        const imageApproval =
          agentTool.name === "generate_images"
            ? prepareGenerateImagesApproval(toolArgs, toolCtx)
            : agentTool.name === "generate_image_variants"
              ? prepareVariantImageApproval(toolArgs, toolCtx)
              : null;
        const needsGenericConfirmation = shouldPauseToolForConfirmation({
          toolName: agentTool.name,
          requiresConfirmation:
            shouldRequireConfirmation(agentTool.name, toolArgs, agentTool.requiresConfirmation),
          args: toolArgs,
          userMessageConfirmed: parseImageGenerationConfirmation(options.userMessage)
            .confirmed,
          trustedResume: trustedResume?.toolName === agentTool.name,
          projectId: options.agentCtx.projectId,
          confirmationPolicy: toolRegistry.confirmationPolicy(agentTool.name),
          projectGranted: isToolGrantedByProject(options.project, agentTool.name),
        });

        if (needsGenericConfirmation) {
          const approvalArgs = imageApproval?.approvedArgs ?? toolArgs;
          const existingConfirmation = options.agentCtx.scratch.__toolConfirmation as
            | { approvalId?: string; toolName?: string }
            | undefined;
          const isImageTool =
            agentTool.name === "generate_images" ||
            agentTool.name === "generate_image_variants";
          const approvalId =
            existingConfirmation?.toolName === agentTool.name &&
            existingConfirmation.approvalId
              ? existingConfirmation.approvalId
              : isImageTool
                ? imageToolApprovalId(options.runId, agentTool.name)
                : [
                    options.runId ?? "run",
                    agentTool.name,
                    nativeToolCallId ?? stableArgsKey(approvalArgs),
                  ].join(":");
          const approvalPayload = {
            approvalId,
            title: imageApproval?.preview.title ?? `Execute ${agentTool.name}`,
            toolName: agentTool.name,
            toolCallId: nativeToolCallId,
            riskLevel: toolRiskLevel(agentTool.name),
            args: approvalArgs,
            pausedByInterrupt: true,
            reason: imageApproval?.preview.reason ??
              "This tool can modify project state or trigger side effects, so it needs user approval before execution.",
            model:
              options.providerConfig.image && "model" in options.providerConfig.image
                ? options.providerConfig.image.model
                : undefined,
            estimatedSeconds: isImageTool ? Math.max(15, Number(imageApproval?.preview.count ?? 1) * 15) : undefined,
            affectedAssets: Array.isArray(approvalArgs.assetIds)
              ? approvalArgs.assetIds.filter((id): id is string => typeof id === "string")
              : undefined,
          };
          options.agentCtx.scratch.__toolConfirmation = approvalPayload;
          const applied = applyApprovalDecision(
            approvalPayload,
            awaitUserToolApproval(approvalPayload)
          );
          if (applied.cancelled) {
            return JSON.stringify({
              ok: false,
              summary: `${agentTool.name} was cancelled by the user.`,
              data: { cancelled: true, approvalId },
            });
          }
          toolArgs = applied.args;
        }

        if (agentTool.inputPhase && !agentTool.inputPhase.includes(currentPhase)) {
          return JSON.stringify({
            ok: false,
            summary: `${agentTool.name} cannot run during ${phaseLabel(currentPhase)}. Allowed phases: ${agentTool.inputPhase.map(phaseLabel).join(", ")}`,
          });
        }

        const callKey = agentTool.idempotencyKey
          ? `${agentTool.name}:${agentTool.idempotencyKey(toolArgs)}`
          : `${agentTool.name}:${stableStringify(toolArgs)}`;
        if (completedToolCalls.has(callKey)) {
          return JSON.stringify({
            ok: true,
            summary: `${agentTool.name} already completed with the same arguments.`,
          });
        }

        const toolStartTime = Date.now();
        reserveToolBudget(budget, agentTool.name);
        const hookCtx = {
          runId: options.runId ?? "",
          threadId: options.threadId ?? "",
          projectId: options.agentCtx.projectId,
          phase: currentPhase,
          project: toolCtx.project,
        };
        await hookManager.beforeTool({
          ...hookCtx,
          toolName: agentTool.name,
          toolArgs,
        });

        const execToolCtx: ToolContext = {
          ...toolCtx,
          toolCallId: nativeToolCallId,
        };
        const execPromise = toolRegistry.execute(agentTool.name, toolArgs, execToolCtx);

        let result;
        if (agentTool.timeoutMs) {
          const timeoutController = new AbortController();
          const timeoutId = setTimeout(
            () => timeoutController.abort(),
            agentTool.timeoutMs
          );
          try {
            result = await Promise.race([
              execPromise,
              new Promise<never>((_, reject) => {
                timeoutController.signal.addEventListener("abort", () =>
                  reject(new Error(`${agentTool.name} timed out (${agentTool.timeoutMs}ms)`))
                );
              }),
            ]);
          } finally {
            clearTimeout(timeoutId);
          }
        } else {
          result = await execPromise;
        }

        completedToolCalls.add(callKey);
        if (result.updatedProject) {
          options.agentCtx.scratch.__updatedProject = result.updatedProject;
          toolCtx.project = result.updatedProject;
        }

        const toolDuration = Date.now() - toolStartTime;
        await hookManager.afterTool({
          ...hookCtx,
          toolName: agentTool.name,
          toolArgs,
          result: { summary: result.summary, data: result.data },
          durationMs: toolDuration,
        });

        costTracker.record({
          runId: options.runId ?? "",
          projectId: options.agentCtx.projectId,
          toolName: agentTool.name,
          phase: currentPhase,
          durationMs: toolDuration,
          timestamp: Date.now(),
          success: true,
        });

        if (agentTool.outputPhase) {
          const nextPhase = resolveNextPhase(currentPhase, agentTool.outputPhase);
          if (nextPhase !== currentPhase) {
            currentPhase = nextPhase;
            options.agentCtx.scratch.__currentPhase = currentPhase;
          }
        }

        return JSON.stringify(
          truncateToolResultForLlm({
            ok: true,
            summary: result.summary,
            data: result.data,
          })
        );
      },
      {
        name: agentTool.name,
        description: agentTool.description,
        schema: agentTool.parameters as unknown as z.ZodObject<any>,
      }
    )
    );

  return createReactAgent({
    llm,
    tools: langchainTools,
    prompt: buildEnhancedSystemPrompt(options.project, options.agentCtx, options.rulesPrompt),
    checkpointer: options.checkpointer,
    // 每次调模型前：滑动窗口 + 旧消息摘要；超阈值写回 checkpoint
    preModelHook: createContextWindowPreModelHook(),
  });
}

function stableArgsKey(args: Record<string, unknown>): string {
  return createHash("sha1").update(stableStringify(args)).digest("hex").slice(0, 12);
}

function shouldRequireConfirmation(
  toolName: string,
  args: Record<string, unknown>,
  toolRequiresApproval?: boolean
): boolean {
  if (toolName === "file_system") {
    return args.action === "write";
  }
  return Boolean(toolRequiresApproval || toolRequiresConfirmation(toolName));
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
    .join(",")}}`;
}

function ledgerCallbacks(projectId: string | undefined, model: string, provider: string) {
  if (!projectId) return [];
  return [
    {
      handleLLMEnd(output: {
        llmOutput?: { tokenUsage?: { promptTokens?: number; completionTokens?: number } };
        generations?: Array<
          Array<{
            message?: {
              usage_metadata?: { input_tokens?: number; output_tokens?: number };
            };
          }>
        >;
      }) {
        const meta = output.generations?.[0]?.[0]?.message?.usage_metadata;
        const legacy = output.llmOutput?.tokenUsage;
        const inputTokens = meta?.input_tokens ?? legacy?.promptTokens ?? 0;
        const outputTokens = meta?.output_tokens ?? legacy?.completionTokens ?? 0;
        void import("@/lib/generation/ledger-store").then(({ noteLlmGeneration }) =>
          noteLlmGeneration(projectId, {
            model,
            provider,
            purpose: "对话",
            inputTokens,
            outputTokens,
          })
        );
      },
    },
  ];
}

function createChatModel(config: ProviderConfig, projectId?: string) {
  if (!config.llm || config.llm.kind === "mock") {
    throw new Error("LangGraph Agent requires a real LLM provider, current provider is mock.");
  }

  if (config.llm.kind === "openai-compatible") {
    return new ChatOpenAI({
      apiKey: config.llm.apiKey,
      configuration: { baseURL: config.llm.baseURL },
      model: config.llm.model,
      streaming: true,
      callbacks: ledgerCallbacks(projectId, config.llm.model, "openai-compatible"),
    });
  }

  if (config.llm.kind === "deepseek") {
    return new ChatOpenAI({
      apiKey: config.llm.apiKey,
      configuration: { baseURL: "https://api.deepseek.com/v1" },
      model: config.llm.model,
      streaming: true,
      callbacks: ledgerCallbacks(projectId, config.llm.model, "deepseek"),
    });
  }

  if (config.llm.kind === "anthropic") {
    return new ChatAnthropic({
      apiKey: config.llm.apiKey,
      model: config.llm.model,
      ...(config.llm.baseURL ? { baseURL: config.llm.baseURL } : {}),
      callbacks: ledgerCallbacks(projectId, config.llm.model, "anthropic"),
    }) as unknown as InstanceType<typeof ChatAnthropic>;
  }

  if (config.llm.kind === "gemini") {
    return new ChatGoogleGenerativeAI({
      apiKey: config.llm.apiKey,
      model: config.llm.model,
      ...(config.llm.baseURL ? { baseURL: config.llm.baseURL } : {}),
      callbacks: ledgerCallbacks(projectId, config.llm.model, "gemini"),
    }) as unknown as InstanceType<typeof ChatGoogleGenerativeAI>;
  }

  throw new Error(`Unsupported LLM provider: ${(config.llm as { kind: string }).kind}`);
}
