/**
 * WebSocket 连接管理
 * --------------------------------------------------------------
 * 管理客户端连接，按 projectId 分组推送事件。
 * 支持 Server→Client RPC 请求（screenshot_canvas 等）。
 */

import type { WebSocket } from "ws";
import { randomUUID } from "node:crypto";

interface PendingRpc {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

class ConnectionManager {
  private subscriptions = new Map<string, Set<WebSocket>>();
  private pendingRpcs = new Map<string, PendingRpc>();

  subscribeToCanvas(ws: WebSocket, projectId?: string): void {
    if (!projectId) return;
    let subs = this.subscriptions.get(projectId);
    if (!subs) {
      subs = new Set();
      this.subscriptions.set(projectId, subs);
    }
    subs.add(ws);
  }

  unsubscribe(ws: WebSocket, projectId?: string): void {
    if (!projectId) return;
    const subs = this.subscriptions.get(projectId);
    if (subs) {
      subs.delete(ws);
      if (subs.size === 0) this.subscriptions.delete(projectId);
    }
  }

  pushToCanvas(projectId: string, event: unknown, exclude?: WebSocket): void {
    const subs = this.subscriptions.get(projectId);
    if (!subs) return;
    const msg = JSON.stringify(event);
    for (const ws of subs) {
      if (ws !== exclude && ws.readyState === ws.OPEN) {
        try {
          ws.send(msg);
        } catch {
          subs.delete(ws);
        }
      }
    }
  }

  getFirstConnection(projectId: string): WebSocket | undefined {
    const subs = this.subscriptions.get(projectId);
    if (!subs) return undefined;
    for (const ws of subs) {
      if (ws.readyState === ws.OPEN) return ws;
    }
    return undefined;
  }

  sendTo(ws: WebSocket, event: unknown): boolean {
    if (ws.readyState !== ws.OPEN) return false;
    try {
      ws.send(JSON.stringify(event));
      return true;
    } catch {
      return false;
    }
  }

  sendRpcTo(
    projectId: string,
    method: string,
    params?: unknown,
    timeoutMs = 30_000,
  ): Promise<unknown> {
    const ws = this.getFirstConnection(projectId);
    if (!ws) {
      return Promise.reject(new Error(`没有可用的 WebSocket 连接: ${projectId}`));
    }

    const rpcId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRpcs.delete(rpcId);
        reject(new Error(`RPC 请求超时: ${method} (${rpcId})`));
      }, timeoutMs);

      this.pendingRpcs.set(rpcId, { resolve, reject, timer });

      const sent = this.sendTo(ws, {
        type: "rpc.request",
        data: { id: rpcId, method, params },
      });

      if (!sent) {
        clearTimeout(timer);
        this.pendingRpcs.delete(rpcId);
        reject(new Error(`WebSocket 发送失败: ${method}`));
      }
    });
  }

  handleRpcResponse(rpcId: string, result?: unknown, error?: unknown): void {
    const pending = this.pendingRpcs.get(rpcId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingRpcs.delete(rpcId);
    if (error) {
      pending.reject(new Error(typeof error === "string" ? error : JSON.stringify(error)));
    } else {
      pending.resolve(result);
    }
  }
}

export const connectionManager = new ConnectionManager();
