import type { Job } from "./job-types";

type JobLike = Partial<Job> & {
  payloadSummary?: Record<string, unknown>;
  recoverablePayload?: Record<string, unknown>;
};

export type ClientJob = {
  id: string;
  type: Job["type"] | string;
  status: Job["status"] | string;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  runId?: string;
  batchId?: string;
  projectId?: string;
  threadId?: string;
  toolCallId?: string;
  progress?: number;
  progressDetail?: Job["progressDetail"];
  phase?: Job["phase"];
  payloadSummary?: Record<string, unknown>;
  result?: unknown;
};

/**
 * Polling GET /api/jobs must never serialize payload.project, data URIs,
 * or updatedProject — those payloads stall the Node event loop and freeze
 * the Agent WebSocket stream on "正在连接模型".
 */
export function toClientJob(job: JobLike | Record<string, unknown>): ClientJob {
  const record = job as JobLike;
  const payload = "payload" in record && isRecord(record.payload) ? record.payload : undefined;
  const payloadSummary = record.payloadSummary
    ? slimPayloadSummary(record.payloadSummary)
    : payload
      ? summarizePayload(payload)
      : undefined;

  return {
    id: String(record.id ?? ""),
    type: record.type,
    status: record.status,
    error: record.error,
    createdAt: Number(record.createdAt ?? 0),
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    runId: record.runId,
    batchId: record.batchId,
    projectId: record.projectId,
    threadId: record.threadId,
    toolCallId: record.toolCallId,
    progress: record.progress,
    progressDetail: record.progressDetail,
    phase: record.phase,
    payloadSummary,
    result: slimJobResult(record.result),
  };
}

export function summarizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const key of ["count", "total", "request", "pendingAssets"]) {
    const value = payload[key];
    if (key === "pendingAssets" && Array.isArray(value)) {
      summary.pendingAssetCount = value.length;
    } else if (key === "request" && isRecord(value)) {
      summary.request = slimRequest(value);
    } else if (value !== undefined && key !== "pendingAssets") {
      summary[key] = value;
    }
  }
  return summary;
}

export function slimRequest(request: Record<string, unknown>): Record<string, unknown> {
  const refs = Array.isArray(request.referenceImages) ? request.referenceImages : [];
  return {
    prompt: request.prompt,
    count: request.count,
    width: request.width,
    height: request.height,
    sourcePageId: request.sourcePageId,
    parentAssetId: request.parentAssetId,
    referenceImageCount: refs.length,
  };
}

export function slimRecoverableRequest(request: unknown): unknown {
  if (!isRecord(request)) return request;
  return {
    ...request,
    referenceImages: slimReferenceImages(request.referenceImages),
  };
}

export function slimJobResult(result: unknown): unknown {
  if (!isRecord(result)) return result;
  const assets = Array.isArray(result.assets)
    ? result.assets.map((item) => {
        if (!isRecord(item)) return item;
        return {
          id: item.id,
          status: item.status,
          prompt: typeof item.prompt === "string" ? item.prompt.slice(0, 120) : undefined,
        };
      })
    : undefined;
  return {
    succeeded: result.succeeded,
    failed: result.failed,
    cancelled: result.cancelled,
    mockupAssetId: result.mockupAssetId,
    assetId: result.assetId,
    assets,
  };
}

function slimPayloadSummary(summary: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(summary.request)) return summary;
  return { ...summary, request: slimRequest(summary.request) };
}

function slimReferenceImages(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    if (!isRecord(item)) return item;
    const src = typeof item.src === "string" ? item.src : "";
    const heavy = src.startsWith("data:") || src.length > 240;
    return {
      id: item.id,
      name: item.name,
      mime: item.mime ?? item.mediaType,
      assetId: item.assetId,
      src: heavy ? undefined : src,
      omitted: heavy || undefined,
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
