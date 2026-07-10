/**
 * 设计流水线执行日志
 * --------------------------------------------------------------
 * 记录 Brief → 生图 → 评审各阶段的时间、结果与错误；
 * 支持控制台、SSE 推送与 .vad 落盘。
 *
 * @author：wangjunhua
 */

import { nanoid } from "nanoid";

export type PipelineLogLevel = "info" | "warn" | "error" | "success";

export interface PipelineLogEntry {
  id: string;
  at: string;
  level: PipelineLogLevel;
  stage?: string;
  message: string;
  durationMs?: number;
  meta?: Record<string, unknown>;
}

/** 阶段 id → 中文展示名 */
export const PIPELINE_STAGE_LABELS: Record<string, string> = {
  init: "初始化",
  brief: "Brief Agent",
  architecture: "产品架构",
  design_direction: "视觉方向",
  design_system: "设计系统",
  layout: "页面结构 Layout",
  content: "文案润色",
  image_plan: "生图规划",
  image_execute: "生图执行",
  image_variants: "图片候选",
  image_restyle: "图片统一风格",
  image_task: "单张位图",
  edit: "页面编辑",
  critique: "质量评审",
  repair: "页面修复",
  critic_round: "评审轮次",
  orchestrator: "编排规划",
  handoff: "Handoff 导出",
  answer: "问答",
  done: "完成",
};

export type PipelineLogSink = (entry: PipelineLogEntry) => void;

export interface PipelineLoggerOptions {
  runId?: string;
  projectId: string;
  source: "generate" | "chat" | "api";
  idea?: string;
  /** 额外推送（如 SSE） */
  onEntry?: PipelineLogSink;
}

export class PipelineLogger {
  readonly runId: string;
  readonly projectId: string;
  readonly source: string;
  readonly startedAt: string;
  private entries: PipelineLogEntry[] = [];
  private readonly onEntry?: PipelineLogSink;
  private stageTimers = new Map<string, number>();

  constructor(opts: PipelineLoggerOptions) {
    this.runId = opts.runId ?? nanoid(8);
    this.projectId = opts.projectId;
    this.source = opts.source;
    this.startedAt = new Date().toISOString();
    this.onEntry = opts.onEntry;
    this.push("info", "init", "流水线开始", {
      source: opts.source,
      idea: opts.idea?.slice(0, 200),
    });
  }

  getEntries(): PipelineLogEntry[] {
    return [...this.entries];
  }

  push(
    level: PipelineLogLevel,
    stage: string | undefined,
    message: string,
    meta?: Record<string, unknown>,
    durationMs?: number
  ): PipelineLogEntry {
    const entry: PipelineLogEntry = {
      id: nanoid(6),
      at: new Date().toISOString(),
      level,
      stage,
      message,
      ...(durationMs != null ? { durationMs } : {}),
      ...(meta && Object.keys(meta).length > 0 ? { meta } : {}),
    };
    this.entries.push(entry);
    this.onEntry?.(entry);
    const label = stage ? PIPELINE_STAGE_LABELS[stage] ?? stage : "—";
    const dur = durationMs != null ? ` (${durationMs}ms)` : "";
    const line = `[VAD][${this.runId}] [${label}] ${message}${dur}`;
    if (level === "error") console.error(line, meta ?? "");
    else if (level === "warn") console.warn(line, meta ?? "");
    else console.info(line);
    return entry;
  }

  info(stage: string | undefined, message: string, meta?: Record<string, unknown>) {
    return this.push("info", stage, message, meta);
  }

  warn(stage: string | undefined, message: string, meta?: Record<string, unknown>) {
    return this.push("warn", stage, message, meta);
  }

  error(stage: string | undefined, message: string, meta?: Record<string, unknown>) {
    return this.push("error", stage, message, meta);
  }

  success(stage: string | undefined, message: string, meta?: Record<string, unknown>) {
    return this.push("success", stage, message, meta);
  }

  stageStart(stage: string, detail?: string) {
    this.stageTimers.set(stage, Date.now());
    const label = PIPELINE_STAGE_LABELS[stage] ?? stage;
    this.info(stage, detail ? `开始：${label} — ${detail}` : `开始：${label}`);
  }

  stageEnd(stage: string, detail?: string, meta?: Record<string, unknown>) {
    const t0 = this.stageTimers.get(stage);
    const durationMs = t0 != null ? Date.now() - t0 : undefined;
    this.stageTimers.delete(stage);
    const label = PIPELINE_STAGE_LABELS[stage] ?? stage;
    this.push(
      "success",
      stage,
      detail ? `完成：${label} — ${detail}` : `完成：${label}`,
      meta,
      durationMs
    );
  }

  stageError(stage: string, err: unknown) {
    const t0 = this.stageTimers.get(stage);
    const durationMs = t0 != null ? Date.now() - t0 : undefined;
    this.stageTimers.delete(stage);
    const msg = err instanceof Error ? err.message : String(err);
    this.push("error", stage, `失败：${PIPELINE_STAGE_LABELS[stage] ?? stage} — ${msg}`, undefined, durationMs);
  }

  /** 执行某阶段并自动记录开始/结束/异常 */
  async runStage<T>(
    stage: string,
    detail: string | undefined,
    fn: () => Promise<T>,
    onSuccessMeta?: (result: T) => Record<string, unknown>
  ): Promise<T> {
    this.stageStart(stage, detail);
    try {
      const result = await fn();
      this.stageEnd(stage, detail, onSuccessMeta?.(result));
      return result;
    } catch (e) {
      this.stageError(stage, e);
      throw e;
    }
  }

  complete(summary?: string) {
    const totalMs = Date.now() - new Date(this.startedAt).getTime();
    this.success("done", summary ?? "流水线执行结束", { totalMs });
  }

  fail(err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    this.error("done", `流水线中止：${msg}`);
  }
}
