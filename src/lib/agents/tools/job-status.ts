/**
 * job_status 工具
 * --------------------------------------------------------------
 * Agent 可查询异步 Job（视频生成等）的当前状态和进度。
 */

import { jobManager } from "@/lib/providers/video/job-manager";
import { jobScheduler } from "@/lib/agents/job/job-scheduler";
import type { AgentTool, ToolContext, ToolResult } from "./types";

export const jobStatusTool: AgentTool = {
  name: "job_status",
  description: "查询异步 Job（视频生成等）的状态和进度",
  riskLevel: "safe",
  parameters: {
    type: "object",
    properties: {
      jobId: { type: "string", description: "Job ID" },
      action: {
        type: "string",
        enum: ["get", "list", "cancel"],
        description: "操作类型：get 查询单个、list 列出所有、cancel 取消",
      },
    },
    required: ["action"],
  },

  async execute(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    const action = args.action as string;

    if (action === "list") {
      const schedulerJobs = jobScheduler.listJobs({ projectId: ctx.agentCtx.projectId });
      const legacyJobs = jobManager.listJobs(ctx.agentCtx.projectId);
      const jobs = [...schedulerJobs, ...legacyJobs];
      return {
        summary: `当前项目 ${jobs.length} 个 Job`,
        data: { jobs },
      };
    }

    if (action === "cancel") {
      const jobId = args.jobId as string;
      if (!jobId) throw new Error("cancel 操作需要 jobId 参数");
      const schedulerJob = jobScheduler.getJob(jobId);
      if (schedulerJob) {
        jobScheduler.cancel(jobId);
        return {
          summary: `Job ${jobId} 已取消`,
          data: { jobId, cancelled: true },
        };
      }
      const ok = jobManager.cancelJob(jobId);
      return {
        summary: ok ? `Job ${jobId} 已取消` : `Job ${jobId} 取消失败（不存在或已完成）`,
        data: { jobId, cancelled: ok },
      };
    }

    // get
    const jobId = args.jobId as string;
    if (!jobId) throw new Error("get 操作需要 jobId 参数");
    const job = jobScheduler.getJob(jobId) ?? jobManager.getJob(jobId);
    if (!job) {
      return {
        summary: `Job ${jobId} 不存在`,
        data: { error: "job_not_found", jobId },
      };
    }
    return {
      summary: `Job ${jobId}: ${job.status} (${job.progress}%)`,
      data: job,
    };
  },

  async fallback(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    return this.execute(args, ctx);
  },
};
