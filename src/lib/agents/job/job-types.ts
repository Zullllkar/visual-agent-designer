/**
 * Job 类型定义
 * --------------------------------------------------------------
 * Job 是异步后台任务的抽象，与 Agent Run 分离。
 * Agent 工具可以提交 Job，由 JobScheduler 异步执行。
 */

import type { AgentPhase } from "@/lib/agents/agent-phase";

export type JobType =
  | "image_generation"
  | "direct_image_generation"
  | "materialize_slots"
  | "video_generation"
  | "export"
  | "custom";

export type JobStatus =
  | "pending"      // 等待执行
  | "running"      // 正在执行
  | "completed"    // 成功完成
  | "failed"       // 执行失败
  | "cancelled";   // 被取消

export interface Job<T = unknown> {
  id: string;
  type: JobType;
  status: JobStatus;
  payload: Record<string, unknown>;
  result?: T;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  /** 关联的 Agent Run ID */
  runId?: string;
  batchId?: string;
  /** 关联的项目 ID */
  projectId?: string;
  /** 关联的对话线程，用于断线回放。 */
  threadId?: string;
  /** Tool call that created this job, when available. */
  toolCallId?: string;
  /** 进度 0-100 */
  progress?: number;
  /** 当前任务阶段和批次明细，供侧边栏恢复展示。 */
  progressDetail?: JobProgressDetail;
  /** 触发此 Job 的阶段 */
  phase?: AgentPhase;
}

/** Job 提交参数 */
export interface SubmitJobInput {
  type: JobType;
  payload: Record<string, unknown>;
  runId?: string;
  batchId?: string;
  projectId?: string;
  threadId?: string;
  toolCallId?: string;
  phase?: AgentPhase;
}

export interface JobProgressDetail {
  stage: "queued" | "planning" | "generating" | "persisting";
  completed: number;
  failed: number;
  cancelled?: number;
  total: number;
  currentTaskId?: string;
  message?: string;
}

export interface JobHandlerContext {
  signal: AbortSignal;
  reportProgress: (detail: JobProgressDetail) => void;
}

/** Job 处理函数。 */
export type JobHandler<T = unknown> = (
  job: Job,
  context: JobHandlerContext
) => Promise<T>;

interface JobEventBase {
  jobId: string;
  jobType: JobType;
  batchId?: string;
  projectId?: string;
  runId?: string;
  threadId?: string;
  toolCallId?: string;
  /** 关联整图 / mockup，供侧边栏展示缩略图 */
  assetId?: string;
}

/** Job 事件（用于 WebSocket 推送）。每个事件都携带隔离所需的归属信息。 */
export type JobEvent =
  | { type: "job.queued"; data: JobEventBase & { progress: number; detail?: JobProgressDetail } }
  | { type: "job.started"; data: JobEventBase & { progress: number; detail?: JobProgressDetail } }
  | {
      type: "job.progress";
      data: JobEventBase & { progress: number; detail: JobProgressDetail };
    }
  | { type: "job.completed"; data: JobEventBase & { progress: 100; result: unknown } }
  | { type: "job.failed"; data: JobEventBase & { error: string } }
  | { type: "job.cancelled"; data: JobEventBase & { progress: number } };
