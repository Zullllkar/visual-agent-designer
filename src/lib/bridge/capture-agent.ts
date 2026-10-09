/**
 * 桌面截图代理（capture agent）
 * --------------------------------------------------------------
 * Cursor / Claude Code 本身不会截图。桌面端 Electron 主进程起一个回环
 * HTTP 服务，启动后把 {url, token} 注册到这里并定期心跳；
 * report_implementation 只拿到 url 时，就让它用隐藏 BrowserWindow 截整页。
 *
 * 纯浏览器模式（pnpm dev 未开桌面壳）下没有代理，工具会明确告诉 agent
 * 自己传 screenshotBase64。
 */

import { constantTimeEqual } from "./auth";

export interface CaptureAgentRegistration {
  url: string;
  token: string;
  registeredAt: number;
  lastSeenAt: number;
  pid?: number;
  version?: string;
}

export interface CaptureRequest {
  url: string;
  /** 视口宽度，默认 1440 */
  width?: number;
  /** 视口高度（仅 fullPage=false 时是最终高度），默认 900 */
  height?: number;
  /** 拉伸到文档高度截整页，默认 true */
  fullPage?: boolean;
  /** 加载完成后等待多久再截（字体 / 动画），默认 800ms */
  delayMs?: number;
  /** 整体超时，默认 25s */
  timeoutMs?: number;
}

export type CaptureResult =
  | {
      ok: true;
      dataUrl: string;
      width: number;
      height: number;
      finalUrl?: string;
      title?: string;
      elapsedMs: number;
    }
  | { ok: false; error: string; code: "no_agent" | "agent_error" | "bad_response" | "timeout" };

/** 超过这个时间没心跳就当桌面端已退出 */
const STALE_MS = 90_000;
const MAX_RESPONSE_BYTES = 40 * 1024 * 1024;

class CaptureAgentRegistry {
  private current: CaptureAgentRegistration | null = null;

  register(input: {
    url: string;
    token: string;
    pid?: number;
    version?: string;
  }): CaptureAgentRegistration {
    const now = Date.now();
    const prev = this.current;
    const sameEndpoint =
      prev && prev.url === input.url && constantTimeEqual(prev.token, input.token);
    this.current = {
      url: input.url,
      token: input.token,
      registeredAt: sameEndpoint ? prev.registeredAt : now,
      lastSeenAt: now,
      pid: input.pid,
      version: input.version,
    };
    return this.current;
  }

  unregister(token?: string): boolean {
    if (!this.current) return false;
    if (token && !constantTimeEqual(token, this.current.token)) return false;
    this.current = null;
    return true;
  }

  get(): CaptureAgentRegistration | null {
    if (!this.current) return null;
    if (Date.now() - this.current.lastSeenAt > STALE_MS) {
      this.current = null;
      return null;
    }
    return this.current;
  }

  status(): {
    available: boolean;
    registeredAt?: string;
    lastSeenAt?: string;
    pid?: number;
    version?: string;
  } {
    const cur = this.get();
    if (!cur) return { available: false };
    return {
      available: true,
      registeredAt: new Date(cur.registeredAt).toISOString(),
      lastSeenAt: new Date(cur.lastSeenAt).toISOString(),
      pid: cur.pid,
      version: cur.version,
    };
  }

  /** 测试用 */
  reset(): void {
    this.current = null;
  }
}

export const captureAgent = new CaptureAgentRegistry();

export async function captureViaDesktop(request: CaptureRequest): Promise<CaptureResult> {
  const agent = captureAgent.get();
  if (!agent) {
    return {
      ok: false,
      code: "no_agent",
      error:
        "Vibeboard desktop app is not running, so nothing can take the screenshot. Either launch the desktop app (pnpm dev:desktop) or capture the page yourself and pass screenshotBase64.",
    };
  }

  const timeoutMs = Math.min(Math.max(request.timeoutMs ?? 25_000, 3_000), 60_000);
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs + 2_000);
  try {
    const res = await fetch(`${agent.url.replace(/\/+$/, "")}/capture`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${agent.token}`,
      },
      body: JSON.stringify({
        url: request.url,
        width: request.width ?? 1440,
        height: request.height ?? 900,
        fullPage: request.fullPage ?? true,
        delayMs: request.delayMs ?? 800,
        timeoutMs,
      }),
      signal: controller.signal,
    });
    const text = await readLimited(res, MAX_RESPONSE_BYTES);
    let body: {
      ok?: boolean;
      error?: string;
      pngBase64?: string;
      width?: number;
      height?: number;
      finalUrl?: string;
      title?: string;
    };
    try {
      body = JSON.parse(text);
    } catch {
      return {
        ok: false,
        code: "bad_response",
        error: `Desktop capture returned non-JSON (${res.status}).`,
      };
    }
    if (!res.ok || !body.ok || typeof body.pngBase64 !== "string") {
      return {
        ok: false,
        code: "agent_error",
        error: body.error ?? `Desktop capture failed with HTTP ${res.status}.`,
      };
    }
    return {
      ok: true,
      dataUrl: `data:image/png;base64,${body.pngBase64}`,
      width: body.width ?? 0,
      height: body.height ?? 0,
      finalUrl: body.finalUrl,
      title: body.title,
      elapsedMs: Date.now() - started,
    };
  } catch (err) {
    const aborted = (err as Error).name === "AbortError";
    return {
      ok: false,
      code: aborted ? "timeout" : "agent_error",
      error: aborted
        ? `Desktop capture timed out after ${timeoutMs}ms. Is ${request.url} reachable and does it finish loading?`
        : `Could not reach the desktop capture agent: ${(err as Error).message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readLimited(res: Response, limit: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return await res.text();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error("capture response too large");
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}
