/**
 * Bridge 待办请求
 * --------------------------------------------------------------
 * coding agent 通过 MCP 发起、需要设计侧人来处理的请求：
 *   asset    — request_asset：要一张新素材（默认需人工批准，涉及费用）
 *   question — ask_designer：设计上的歧义提问
 *
 * 工具会短暂等待（Codex 默认工具超时 60s，这里留足余量），超时则返回
 * requestId 让 agent 稍后用 get_answer / get_job 轮询。
 */

import { nanoid } from "nanoid";

export type BridgeRequestKind = "asset" | "question";

export type BridgeRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "answered"
  | "expired";

export interface BridgeAssetRequestInput {
  description: string;
  role?: string;
  width: number;
  height: number;
  count: number;
  referenceAssetId?: string;
  estimatedUsd?: number;
}

export interface BridgeQuestionInput {
  question: string;
  options?: string[];
  context?: string;
}

export interface BridgeRequest {
  id: string;
  kind: BridgeRequestKind;
  projectId: string;
  clientName?: string;
  status: BridgeRequestStatus;
  createdAt: number;
  resolvedAt?: number;
  asset?: BridgeAssetRequestInput;
  question?: BridgeQuestionInput;
  /** approved 后由工具写入，供 get_job 关联。 */
  jobId?: string;
  /** answered 时的回答文本。 */
  answer?: string;
  /** rejected 时的理由。 */
  reason?: string;
}

type Waiter = (request: BridgeRequest) => void;

const TTL_MS = 30 * 60_000;

class PendingRequestRegistry {
  private requests = new Map<string, BridgeRequest>();
  private waiters = new Map<string, Set<Waiter>>();
  private listeners = new Set<(request: BridgeRequest) => void>();

  onChange(listener: (request: BridgeRequest) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  create(
    input:
      | { kind: "asset"; projectId: string; clientName?: string; asset: BridgeAssetRequestInput }
      | { kind: "question"; projectId: string; clientName?: string; question: BridgeQuestionInput }
  ): BridgeRequest {
    this.evictStale();
    const request: BridgeRequest = {
      id: `${input.kind === "asset" ? "req" : "q"}_${nanoid(10)}`,
      kind: input.kind,
      projectId: input.projectId,
      clientName: input.clientName,
      status: "pending",
      createdAt: Date.now(),
      ...(input.kind === "asset" ? { asset: input.asset } : { question: input.question }),
    };
    this.requests.set(request.id, request);
    this.notify(request);
    return request;
  }

  get(id: string): BridgeRequest | undefined {
    return this.requests.get(id);
  }

  list(filter?: { projectId?: string; status?: BridgeRequestStatus }): BridgeRequest[] {
    this.evictStale();
    let out = [...this.requests.values()];
    if (filter?.projectId) out = out.filter((r) => r.projectId === filter.projectId);
    if (filter?.status) out = out.filter((r) => r.status === filter.status);
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  /** 用户在 UI 上处理请求。返回更新后的请求，或 undefined（不存在 / 已处理）。 */
  resolve(
    id: string,
    resolution:
      | { action: "approve" }
      | { action: "reject"; reason?: string }
      | { action: "answer"; answer: string }
  ): BridgeRequest | undefined {
    const request = this.requests.get(id);
    if (!request || request.status !== "pending") return undefined;

    if (resolution.action === "approve") {
      if (request.kind !== "asset") return undefined;
      request.status = "approved";
    } else if (resolution.action === "reject") {
      request.status = "rejected";
      request.reason = resolution.reason;
    } else {
      if (request.kind !== "question") return undefined;
      request.status = "answered";
      request.answer = resolution.answer;
    }
    request.resolvedAt = Date.now();
    this.flush(request);
    this.notify(request);
    return request;
  }

  /** 记录 approved 请求实际启动的 job。 */
  attachJob(id: string, jobId: string): void {
    const request = this.requests.get(id);
    if (!request) return;
    request.jobId = jobId;
    this.notify(request);
  }

  /** 等待用户处理；超时返回当前（仍 pending 的）请求。 */
  wait(id: string, timeoutMs: number): Promise<BridgeRequest> {
    const current = this.requests.get(id);
    if (!current) return Promise.reject(new Error(`Unknown bridge request: ${id}`));
    if (current.status !== "pending") return Promise.resolve(current);

    return new Promise<BridgeRequest>((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.get(id)?.delete(waiter);
        resolve(this.requests.get(id) ?? current);
      }, timeoutMs);

      const waiter: Waiter = (request) => {
        clearTimeout(timer);
        resolve(request);
      };
      const set = this.waiters.get(id) ?? new Set<Waiter>();
      set.add(waiter);
      this.waiters.set(id, set);
    });
  }

  private flush(request: BridgeRequest): void {
    const set = this.waiters.get(request.id);
    if (!set) return;
    this.waiters.delete(request.id);
    for (const waiter of set) waiter(request);
  }

  private notify(request: BridgeRequest): void {
    for (const listener of this.listeners) {
      try {
        listener(request);
      } catch (err) {
        console.error("[bridge-requests] listener error:", err);
      }
    }
  }

  private evictStale(now: number = Date.now()): void {
    for (const [id, request] of this.requests) {
      if (now - request.createdAt < TTL_MS) continue;
      if (request.status === "pending") {
        request.status = "expired";
        request.resolvedAt = now;
        this.flush(request);
      }
      this.requests.delete(id);
    }
  }
}

export const bridgeRequests = new PendingRequestRegistry();

/** 是否自动批准 request_asset（默认否；仅本进程内有效）。 */
let autoApproveAssets = process.env.VAD_BRIDGE_AUTO_APPROVE === "true";

export function setAutoApproveAssets(value: boolean): void {
  autoApproveAssets = value;
}

export function isAutoApproveAssets(): boolean {
  return autoApproveAssets;
}
