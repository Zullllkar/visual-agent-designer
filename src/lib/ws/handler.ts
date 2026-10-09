/**
 * WebSocket Handler
 * --------------------------------------------------------------
 * 处理 WebSocket 连接和消息分发。
 */

import "server-only";

import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { resolveAgentContextProjectId } from "@/lib/agents/resolve-agent-project";

import {
  WsCommandSchema,
  WsRpcResponseSchema,
  type WsCommand,
  type WsEvent,
} from "./types";
import { eventBuffer } from "./event-buffer";
import { connectionManager } from "./connection-manager";
import { wsLogger } from "./logger";
import { agentRuns } from "@/lib/agents/agent-run-service";
import { shouldSupersedeForNewTurn } from "@/lib/agents/run-lock";
import { resolveAgentRunThreadId } from "@/lib/chat/resolve-run-thread";
import { restoreSession } from "@/lib/agents/session-memory";
import { resolveProviders, type ProviderConfig } from "@/lib/providers/registry";
import { resolveSkillContext } from "@/lib/skills/context";
import { injectProviderScratch } from "@/lib/agents/content-preferences";
import { loadMergedProjectFromVad } from "@/lib/vad/storage";
import type { AgentContext } from "@/lib/agents/types";
import type { ProjectFile } from "@/lib/project/schema";
import { jobScheduler } from "@/lib/agents/job/job-scheduler";
import { registerAllJobHandlers } from "@/lib/agents/job/job-handlers";
import type { JobEvent } from "@/lib/agents/job/job-types";
import { appendEvent } from "@/lib/agents/event-persist";
import { shouldCanvasSyncOnToolCompleted } from "@/lib/agents/approved-tool-events";
import { interruptActiveRunsOnStartup, loadPendingApprovalRuns, loadRun } from "@/lib/agents/run-persist";
import { formatImageConfirmMarker } from "@/lib/agents/image-prompts";
import {
  bindCommandToWaitingRun,
  matchWaitingApproval,
  resumeBlockedImageApproval,
  rewriteMissingToolApproval,
} from "@/lib/ws/missing-run-fallback";
import { loadConversationsFromVad } from "@/lib/vad/persist";
import { activeContext } from "@/lib/bridge/active-context";
import { bridgeRequests } from "@/lib/bridge/pending-requests";
import { rememberProviderConfig } from "@/lib/bridge/provider-cache";
import { clearThreadMemory } from "@/lib/agents/checkpoint";
import { VAD_PROJECTS_DIR } from "@/lib/vad/paths";
import { promises as fs } from "node:fs";

let jobForwarderAttached = false;
let runRecoveryStarted = false;
let bridgeRequestForwarderAttached = false;

async function threadIdFromProjectChat(projectId: string): Promise<string | undefined> {
  const data = await loadConversationsFromVad(projectId);
  if (!data?.conversations) return undefined;
  const asThread = (value: unknown): string | undefined => {
    if (!value || typeof value !== "object") return undefined;
    const threadId = (value as { threadId?: unknown }).threadId;
    return typeof threadId === "string" && threadId.trim() ? threadId.trim() : undefined;
  };
  const active = data.conversations.find((item) => {
    if (!item || typeof item !== "object" || !data.activeId) return false;
    return (item as { id?: unknown }).id === data.activeId;
  });
  return asThread(active) ?? data.conversations.map(asThread).find(Boolean);
}

export function attachWebSocketHandler(server: Server): void {
  registerAllJobHandlers();
  if (!runRecoveryStarted) {
    runRecoveryStarted = true;
    interruptActiveRunsOnStartup()
      .then(async () => {
        const pending = await loadPendingApprovalRuns();
        for (const run of pending) agentRuns.hydrateRun(run);
        try {
          const projectIds = await fs.readdir(VAD_PROJECTS_DIR);
          for (const projectId of projectIds) {
            await jobScheduler.recoverProjectJobs(projectId);
          }
        } catch {
          // A workspace may not have a global .vad/projects directory.
        }
      })
      .catch(() => undefined);
  }
  const wss = new WebSocketServer({ noServer: true });

  if (!jobForwarderAttached) {
    jobForwarderAttached = true;
    jobScheduler.onEvent((event: JobEvent) => {
      if (!event.data.projectId) return;
      const outgoing = event.data.threadId
        ? eventBuffer.push(event.data.threadId, event)
        : event;
      connectionManager.pushToCanvas(event.data.projectId, outgoing);

      if (event.type !== "job.completed") return;
      const result = event.data.result as { updatedProject?: ProjectFile } | undefined;
      const project = result?.updatedProject;
      if (!project) return;
      connectionManager.pushToCanvas(event.data.projectId, {
        type: "project.update",
        data: { project, jobId: event.data.jobId },
      });
    });
  }

  if (!bridgeRequestForwarderAttached) {
    bridgeRequestForwarderAttached = true;
    bridgeRequests.onChange((request) => {
      connectionManager.pushToCanvas(request.projectId, {
        type: "bridge.request",
        data: {
          projectId: request.projectId,
          requestId: request.id,
          kind: request.kind,
          status: request.status,
        },
      });
    });
  }

  server.on("upgrade", (request, socket, head) => {
    const { pathname } = new URL(request.url || "", "http://localhost");
    if (pathname === "/ws") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    }
    // Other upgrade requests (e.g. /_next/webpack-hmr) are ignored here
    // and will be handled by Next.js's own WebSocket server.
  });

  wss.on("connection", (ws: WebSocket) => {
    let subscribedProjectId: string | undefined;
    let lastPong = Date.now();

    wsLogger.connection("connect");

    ws.on("pong", () => {
      lastPong = Date.now();
      // IDE 页面存活即视为用户仍在看这个项目（供 Bridge get_active_context 使用）
      activeContext.touch(subscribedProjectId, lastPong);
    });

    const pingInterval = setInterval(() => {
      if (Date.now() - lastPong > 60_000) {
        ws.terminate();
        return;
      }
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30_000);

    const keepAlive = setInterval(() => {
      sendJson(ws, { type: "keep-alive" });
    }, 15_000);
    /*

    // 转发 Job 事件到 WebSocket 客户端
    const jobListener = (event: JobEvent) => {
    */
    ws.on("message", async (raw: Buffer) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        sendJson(ws, { type: "error", data: { message: "无效的 JSON" } });
        return;
      }

      const obj = parsed as Record<string, unknown>;
      if (obj.type === "rpc.response") {
        try {
          const rpcRes = WsRpcResponseSchema.parse(parsed);
          const { id, result, error } = rpcRes.data;
          connectionManager.handleRpcResponse(id, result, error);
        } catch {
          // 忽略格式错误的 rpc.response
        }
        return;
      }

      let cmd: WsCommand;
      try {
        cmd = WsCommandSchema.parse(parsed);
      } catch (e) {
        sendJson(ws, {
          type: "error",
          data: {
            message: "无效的消息格式",
            detail: e instanceof Error ? e.message : undefined,
          },
        });
        return;
      }
      activeContext.touch(cmd.projectId);
      // Bridge 的 request_asset 没有浏览器会话，借用这里看到的凭证（仅内存）
      rememberProviderConfig(cmd.projectId, cmd.providerConfig as ProviderConfig | undefined);

      if (
        (cmd.action === "agent.approve" || cmd.action === "agent.run") &&
        cmd.projectId
      ) {
        const waiting =
          matchWaitingApproval(agentRuns.listRuns(cmd.projectId), {
            projectId: cmd.projectId,
            approvalId: cmd.approvalId,
          }) ??
          matchWaitingApproval(await loadPendingApprovalRuns(), {
            projectId: cmd.projectId,
            approvalId: cmd.approvalId,
          });
        if (waiting) {
          agentRuns.hydrateRun(waiting);
          const resumed = resumeBlockedImageApproval(cmd, waiting);
          if (resumed) cmd = resumed;
        }
      }

      if (cmd.action === "agent.approve") {
        if (!cmd.prompt || !cmd.projectId) {
          sendJson(ws, {
            type: "error",
            data: { message: "Missing approval prompt or projectId", code: "INVALID_APPROVAL" },
          });
          return;
        }
        const approvePrompts = Array.isArray(cmd.prompts)
          ? cmd.prompts.map((p) => String(p).trim()).filter(Boolean)
          : undefined;
        cmd = {
          ...cmd,
          action: "agent.run",
          prompt: formatImageConfirmMarker({
            count: cmd.count ?? (approvePrompts?.length || 1),
            prompt: cmd.prompt.trim(),
            prompts: approvePrompts,
          }),
        };
      }

      if (
        (cmd.action === "tool.approve" || cmd.action === "tool.cancel") &&
        cmd.runId &&
        cmd.projectId
      ) {
        let storedRun =
          agentRuns.getRun(cmd.runId) ??
          (await loadRun(cmd.projectId, cmd.runId)) ??
          matchWaitingApproval(agentRuns.listRuns(cmd.projectId), {
            projectId: cmd.projectId,
            approvalId: cmd.approvalId,
          });
        if (!storedRun || storedRun.projectId !== cmd.projectId) {
          storedRun = matchWaitingApproval(await loadPendingApprovalRuns(), {
            projectId: cmd.projectId,
            approvalId: cmd.approvalId,
          });
        }
        if (storedRun && storedRun.projectId === cmd.projectId) {
          cmd = bindCommandToWaitingRun(cmd, storedRun);
        } else if (cmd.action === "tool.cancel") {
          sendJson(ws, {
            type: "command.ack",
            data: { action: cmd.action, runId: cmd.runId, approvalId: cmd.approvalId },
          });
          return;
        } else {
          let rewritten = rewriteMissingToolApproval(cmd);
          if (rewritten && !rewritten.threadId) {
            const threadId = await threadIdFromProjectChat(cmd.projectId);
            if (threadId) rewritten = { ...rewritten, threadId };
          }
          if (!rewritten?.threadId) {
            sendJson(ws, {
              type: "error",
              data: {
                message: "Run not found",
                code: "RUN_NOT_FOUND",
                runId: cmd.runId,
              },
            });
            return;
          }
          cmd = rewritten;
        }
      }

      switch (cmd.action) {
        case "agent.run": {
          if (!cmd.prompt || !cmd.projectId) {
            sendJson(ws, {
              type: "error",
              data: { message: "缺少 prompt 或 projectId" },
            });
            return;
          }

          const resolvedThread = resolveAgentRunThreadId({
            projectId: cmd.projectId,
            threadId: cmd.threadId,
          });
          if (!resolvedThread.ok) {
            sendJson(ws, {
              type: "error",
              data: {
                message: resolvedThread.message,
                code: resolvedThread.code,
              },
            });
            return;
          }
          const threadId = resolvedThread.threadId;
          if (/^\/(reset-memory|new-context)\b/i.test(cmd.prompt.trim())) {
            clearThreadMemory(threadId);
            const runId = `memory-${Date.now()}`;
            sendJson(ws, { type: "command.ack", data: { runId, threadId } });
            sendJson(ws, { type: "message.delta", data: { runId, text: "已清理当前会话记忆，项目文件和画布保持不变。接下来我会从当前项目状态重新开始。" } });
            sendJson(ws, { type: "run.completed", data: { runId, reason: "memory_reset" } });
            break;
          }
          const providerConfig = cmd.providerConfig as ProviderConfig | undefined;

          agentRuns.releaseWaitingChatTurn(threadId);
          const activeRun = agentRuns.getActiveRunForThread(threadId);
          if (activeRun && shouldSupersedeForNewTurn(activeRun)) {
            agentRuns.supersedeBlockingRun(activeRun.runId);
          } else if (activeRun) {
            sendJson(ws, {
              type: "error",
              data: {
                message: "当前项目已有 Agent 任务正在执行，请先停止或等待完成。",
                code: "RUN_IN_PROGRESS",
                runId: activeRun.runId,
              },
            });
            return;
          }

          const currentProject = await loadMergedProjectFromVad(cmd.projectId);
          const agentCtx = await buildAgentContext(
            providerConfig,
            currentProject,
            cmd.projectId
          );
          agentCtx.threadId = threadId;

          if (cmd.attachments && cmd.attachments.length > 0) {
            agentCtx.scratch.attachments = cmd.attachments;
            const imageAtts = cmd.attachments.filter((a) => a.type === "image");
            if (imageAtts.length > 0) {
              const attDesc = imageAtts
                .map((a) => `[图片: ${a.name ?? a.id}, ${a.width ?? "?"}x${a.height ?? "?"}]`)
                .join(" ");
              cmd.prompt = `${cmd.prompt}\n\n[用户附件] ${attDesc}`;
            }
          }

          if (cmd.mentions && cmd.mentions.length > 0) {
            agentCtx.scratch.mentions = cmd.mentions;
            const mentionDesc = cmd.mentions
              .map((m) => `@${m.type}:${m.label ?? m.id}`)
              .join(" ");
            cmd.prompt = `${cmd.prompt}\n\n[用户提及] ${mentionDesc}`;
          }

          const run = agentRuns.createRun({
            turnId: typeof (cmd as { turnId?: unknown }).turnId === "string" ? (cmd as { turnId: string }).turnId : undefined,
            threadId,
            prompt: cmd.prompt,
            project: currentProject,
            agentCtx,
            providerConfig: providerConfig ?? {},
          });

          connectionManager.subscribeToCanvas(ws, cmd.projectId);
          subscribedProjectId = cmd.projectId;

          sendWithRetry(ws, {
            type: "command.ack",
            data: { runId: run.runId, threadId },
          });

          try {
            for await (const event of agentRuns.streamRun(run.runId, {
              threadId,
              prompt: cmd.prompt,
              project: currentProject,
              agentCtx,
              providerConfig: providerConfig ?? {},
            })) {
              const wsEvent = event as WsEvent;
              const seqEvent = eventBuffer.push(threadId, wsEvent);
              connectionManager.pushToCanvas(cmd.projectId!, seqEvent, ws);
              sendJson(ws, seqEvent);
              // 持久化事件到日志
              appendEvent(cmd.projectId!, seqEvent).catch(() => {});

              // 生图占位靠 project.update；立刻 canvas.sync 会把尚未落盘的空画布刷回来
              if (
                wsEvent.type === "tool.completed" &&
                shouldCanvasSyncOnToolCompleted(
                  typeof (wsEvent.data as { toolName?: unknown })?.toolName ===
                    "string"
                    ? (wsEvent.data as { toolName: string }).toolName
                    : undefined
                )
              ) {
                const syncEvent = eventBuffer.push(threadId, {
                  type: "canvas.sync" as const,
                  data: { projectId: cmd.projectId, reason: "tool_completed" },
                });
                connectionManager.pushToCanvas(cmd.projectId!, syncEvent, ws);
                sendJson(ws, syncEvent);
              }
            }
          } catch (e) {
            const err = e as Error;
            const errEvent: WsEvent = {
              type: "run.failed",
              data: {
                runId: run.runId,
                error: err.message,
                code: classifyError(err),
                retryable: isRetryableError(err),
              },
            };
            const seqEvent = eventBuffer.push(threadId, errEvent);
            sendJson(ws, seqEvent);
          }

          // 发送 run.completed 后也推送 canvas.sync
          const finalSync = eventBuffer.push(threadId, {
            type: "canvas.sync" as const,
            data: { projectId: cmd.projectId, reason: "run_completed" },
          });
          connectionManager.pushToCanvas(cmd.projectId!, finalSync, ws);
          sendJson(ws, finalSync);
          break;
        }

        case "tool.approve":
        case "tool.cancel": {
          if (!cmd.runId || !cmd.projectId || !cmd.approvalId) {
            sendJson(ws, {
              type: "error",
              data: {
                message: "Missing runId, projectId or approvalId",
                code: "INVALID_TOOL_APPROVAL",
              },
            });
            return;
          }

          const providerConfig = cmd.providerConfig as ProviderConfig | undefined;
          const storedRun =
            agentRuns.getRun(cmd.runId) ??
            (await loadRun(cmd.projectId, cmd.runId)) ??
            matchWaitingApproval(agentRuns.listRuns(cmd.projectId), {
              projectId: cmd.projectId,
              approvalId: cmd.approvalId,
            });
          if (!storedRun || storedRun.projectId !== cmd.projectId) {
            sendJson(ws, {
              type: "error",
              data: {
                message: "Run not found",
                code: "RUN_NOT_FOUND",
                runId: cmd.runId,
              },
            });
            return;
          }

          const run = agentRuns.hydrateRun(storedRun);
          const currentProject = await loadMergedProjectFromVad(cmd.projectId);
          const agentCtx = await buildAgentContext(
            providerConfig,
            currentProject,
            cmd.projectId
          );
          agentCtx.threadId = run.threadId;

          connectionManager.subscribeToCanvas(ws, cmd.projectId);
          subscribedProjectId = cmd.projectId;
          sendJson(ws, {
            type: "command.ack",
            data: {
              action: cmd.action,
              runId: run.runId,
              threadId: run.threadId,
              approvalId: cmd.approvalId,
            },
          });

          try {
            for await (const event of agentRuns.resumeToolApproval(
              run.runId,
              {
                threadId: run.threadId,
                prompt: run.prompt ?? "",
                project: currentProject,
                agentCtx,
                providerConfig: providerConfig ?? {},
              },
              cmd.approvalId,
              cmd.action === "tool.approve" ? "approve" : "cancel",
              cmd.action === "tool.approve" ? cmd.toolArgs : undefined
            )) {
              const wsEvent = event as WsEvent;
              const seqEvent = eventBuffer.push(run.threadId, wsEvent);
              connectionManager.pushToCanvas(cmd.projectId, seqEvent, ws);
              sendJson(ws, seqEvent);
              appendEvent(cmd.projectId, seqEvent).catch(() => {});

              if (
                wsEvent.type === "tool.completed" &&
                shouldCanvasSyncOnToolCompleted(
                  typeof (wsEvent.data as { toolName?: unknown })?.toolName ===
                    "string"
                    ? (wsEvent.data as { toolName: string }).toolName
                    : undefined
                )
              ) {
                const syncEvent = eventBuffer.push(run.threadId, {
                  type: "canvas.sync" as const,
                  data: { projectId: cmd.projectId, reason: "tool_completed" },
                });
                connectionManager.pushToCanvas(cmd.projectId, syncEvent, ws);
                sendJson(ws, syncEvent);
              }
            }
          } catch (e) {
            const err = e as Error;
            const errEvent: WsEvent = {
              type: "run.failed",
              data: {
                runId: run.runId,
                error: err.message,
                code: classifyError(err),
                retryable: isRetryableError(err),
              },
            };
            const seqEvent = eventBuffer.push(run.threadId, errEvent);
            sendJson(ws, seqEvent);
          }

          const finalSync = eventBuffer.push(run.threadId, {
            type: "canvas.sync" as const,
            data: { projectId: cmd.projectId, reason: "tool_approval_resumed" },
          });
          connectionManager.pushToCanvas(cmd.projectId, finalSync, ws);
          sendJson(ws, finalSync);
          break;
        }

        case "agent.cancel": {
          if (cmd.runId) {
            agentRuns.cancel(cmd.runId);
            sendJson(ws, {
              type: "run.cancelling",
              data: { runId: cmd.runId },
            });
            const cancelledRun = agentRuns.getRun(cmd.runId);
            if (cancelledRun?.status === "cancelled") {
              sendJson(ws, {
                type: "run.cancelled",
                data: { runId: cmd.runId },
              });
            }
            for (const job of jobScheduler.listJobs({ runId: cmd.runId })) {
              if (job.status === "pending" || job.status === "running") {
                jobScheduler.cancel(job.id);
              }
            }
          }
          break;
        }

        case "canvas.subscribe": {
          if (cmd.projectId) {
            connectionManager.subscribeToCanvas(ws, cmd.projectId);
            subscribedProjectId = cmd.projectId;
            if (cmd.threadId) {
              for (const event of eventBuffer.getRecent(cmd.threadId)) {
                sendJson(ws, event);
              }

              try {
                const { getCheckpointer } = await import("@/lib/agents/checkpoint");
                const checkpointer = getCheckpointer();
                const memory = await restoreSession(checkpointer, cmd.threadId);
                if (memory) {
                  sendJson(ws, {
                    type: "project.update",
                    data: {
                      threadId: cmd.threadId,
                      memory,
                    },
                  });
                }
              } catch {
                // checkpoint 恢复失败不影响正常连接
              }
            }
          }
          break;
        }

        case "canvas.resume": {
          if (cmd.projectId && cmd.threadId) {
            connectionManager.subscribeToCanvas(ws, cmd.projectId);
            subscribedProjectId = cmd.projectId;

            const lastSeq = cmd.lastSeq ?? 0;
            const missed = eventBuffer.getAfter(cmd.threadId, lastSeq);
            const latestSeq = eventBuffer.getLatestSeq(cmd.threadId);

            sendJson(ws, {
              type: "command.ack",
              data: {
                action: "canvas.resume",
                projectId: cmd.projectId,
                latestSeq,
                replayed: missed.length,
              },
            });

            for (const event of missed) {
              sendJson(ws, event);
            }
          }
          break;
        }
      }
    });

    ws.on("close", () => {
      clearInterval(pingInterval);
      clearInterval(keepAlive);
      if (subscribedProjectId) {
        connectionManager.unsubscribe(ws, subscribedProjectId);
        wsLogger.subscription("unsubscribe", subscribedProjectId);
      }
      wsLogger.connection("disconnect");
    });

    ws.on("error", () => {
      clearInterval(pingInterval);
      clearInterval(keepAlive);
      if (subscribedProjectId) {
        connectionManager.unsubscribe(ws, subscribedProjectId);
      }
      wsLogger.connection("disconnect");
    });
  });
}

async function buildAgentContext(
  providerConfig?: ProviderConfig,
  project?: ProjectFile | null,
  requestedProjectId?: string | null
): Promise<AgentContext> {
  const { skill, designSystem } = await resolveSkillContext(providerConfig, project);
  const scratch: Record<string, unknown> = {};
  injectProviderScratch(scratch, providerConfig);
  return {
    projectId: resolveAgentContextProjectId(project, requestedProjectId),
    scratch,
    providers: resolveProviders(providerConfig),
    skill,
    designSystem,
  };
}

function classifyError(err: Error): string {
  const msg = err.message.toLowerCase();
  if (msg.includes("api key") || msg.includes("unauthorized") || msg.includes("401")) {
    return "AUTH_ERROR";
  }
  if (msg.includes("rate limit") || msg.includes("429") || msg.includes("quota")) {
    return "RATE_LIMIT";
  }
  if (msg.includes("timeout") || msg.includes("timed out")) {
    return "TIMEOUT";
  }
  if (msg.includes("network") || msg.includes("econnrefused") || msg.includes("fetch failed")) {
    return "NETWORK_ERROR";
  }
  if (msg.includes("model") && msg.includes("not found")) {
    return "MODEL_NOT_FOUND";
  }
  if (msg.includes("recursion") || msg.includes("max iterations")) {
    return "AGENT_LIMIT";
  }
  if (msg.includes("mock")) {
    return "MOCK_PROVIDER";
  }
  if (msg.includes("insufficient") || msg.includes("credits") || msg.includes("billing")) {
    return "BILLING_ERROR";
  }
  if (msg.includes("plan limit") || msg.includes("subscription")) {
    return "PLAN_LIMIT";
  }
  return "INTERNAL_ERROR";
}

function isRetryableError(err: Error): boolean {
  const code = classifyError(err);
  return ["RATE_LIMIT", "TIMEOUT", "NETWORK_ERROR"].includes(code);
}

function sendJson(ws: WebSocket, data: unknown): boolean {
  if (ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

function sendWithRetry(ws: WebSocket, data: unknown, maxRetries = 5): void {
  const payload = JSON.stringify(data);
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(payload);
        return;
      } catch {
        // 发送失败，等待后重试
      }
    }
    // 同步重试不可能等待，直接尝试下一次
  }
  // 所有重试失败，静默丢弃（连接已断开）
}
