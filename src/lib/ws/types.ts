/**
 * WebSocket 消息 Schema
 * --------------------------------------------------------------
 * 客户端→服务端的命令和服务端→客户端的事件。
 */

import { z } from "zod";

export const WsCommandSchema = z.object({
  action: z.enum([
    "agent.run",
    "agent.approve",
    "agent.cancel",
    "tool.approve",
    "tool.cancel",
    "canvas.subscribe",
    "canvas.resume",
  ]),
  prompt: z.string().nullish(),
  /** 多类型生图：每条不同提示词 */
  prompts: z.array(z.string()).max(8).nullish(),
  projectId: z.string().nullish(),
  threadId: z.string().nullish(),
  turnId: z.string().nullish(),
  runId: z.string().nullish(),
  approvalId: z.string().nullish(),
  toolArgs: z.record(z.string(), z.unknown()).optional(),
  count: z.number().int().min(1).max(8).nullish(),
  lastSeq: z.number().int().min(0).optional(),
  providerConfig: z.unknown().optional(),
  attachments: z
    .array(
      z.object({
        id: z.string(),
        type: z.enum(["image", "file"]),
        url: z.string(),
        mimeType: z.string().nullish(),
        name: z.string().nullish(),
        width: z.number().nullish(),
        height: z.number().nullish(),
      })
    )
    .optional(),
  mentions: z
    .array(
      z.object({
        type: z.enum(["model", "brand_asset", "skill", "asset", "page"]),
        id: z.string(),
        label: z.string().nullish(),
      })
    )
    .optional(),
});

export const WsRpcResponseSchema = z.object({
  type: z.literal("rpc.response"),
  data: z.object({
    id: z.string(),
    result: z.unknown().optional(),
    error: z.unknown().optional(),
  }),
});

export type WsCommand = z.infer<typeof WsCommandSchema>;

export const WsEventSchema = z.object({
  type: z.enum([
    "command.ack",
    "run.started",
    "message.delta",
    "thinking.delta",
    "llm.requested",
    "llm.started",
    "llm.completed",
    "llm.failed",
    "agent.fallback",
    "tool.started",
    "tool.completed",
    "tool.confirm",
    "canvas.sync",
    "project.update",
    "handoff.download",
    "run.completed",
    "run.waiting_user",
    "run.cancelling",
    "run.interrupted",
    "run.failed",
    "run.cancelled",
    "job.queued",
    "job.started",
    "job.progress",
    "job.completed",
    "job.failed",
    "job.cancelled",
    "rpc.request",
    "keep-alive",
    "error",
    "discovery.questions",
    "direction.confirm",
    "image_generation.confirm",
    "bridge.request",
  ]),
  data: z.unknown(),
  seq: z.number().int().optional(),
  at: z.number().int().optional(),
});

export type WsEvent = z.infer<typeof WsEventSchema>;
