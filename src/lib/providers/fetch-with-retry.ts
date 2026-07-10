/**
 * 带重试的 HTTP fetch（Provider 共用，仅服务端）
 * --------------------------------------------------------------
 * @author：wangjunhua
 */

import "server-only";
import { safeFetch } from "@/lib/utils/fetch-client";
import { withRetry, type RetryOptions } from "./retry";

export async function fetchWithRetry(
  url: string | URL,
  init?: RequestInit,
  retryOpts?: RetryOptions
): Promise<Response> {
  return withRetry(async () => {
    const res = await safeFetch(url, init);
    if (res.status === 429 || res.status >= 500) {
      const text = await res.text().catch(() => "");
      const err = new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`) as Error & {
        status?: number;
      };
      err.status = res.status;
      throw err;
    }
    return res;
  }, retryOpts);
}
