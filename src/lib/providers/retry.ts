/**
 * Provider 请求重试与超时
 * --------------------------------------------------------------
 * 对 429 / 5xx 及网络瞬时错误做指数退避重试，避免单次抖动导致整轮失败。
 *
 * @author：wangjunhua
 */

export interface RetryOptions {
  /** 最大尝试次数（含首次），默认 3 */
  maxAttempts?: number;
  /** 首次退避毫秒，默认 400 */
  baseDelayMs?: number;
  /** 单次调用超时毫秒；0 表示不限制 */
  timeoutMs?: number;
  /** 是否应重试该错误，默认按 status / 消息判断 */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** 取消请求及重试等待。 */
  signal?: AbortSignal;
}

const DEFAULT_RETRYABLE = /429|5\d{2}|timeout|ETIMEDOUT|ECONNRESET|fetch failed|socket/i;

function isRetryableError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message;
    if (DEFAULT_RETRYABLE.test(msg)) return true;
    const status = (err as Error & { status?: number }).status;
    if (status === 429 || (status != null && status >= 500)) return true;
  }
  return false;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true }
    );
  });
}

/**
 * 包装异步调用：超时 + 指数退避重试。
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 400;
  const timeoutMs = opts.timeoutMs ?? 0;
  const shouldRetry = opts.shouldRetry ?? ((e) => isRetryableError(e));

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (opts.signal?.aborted) throw abortError();
    try {
      if (timeoutMs > 0) {
        return await withTimeout(fn(), timeoutMs, opts.signal);
      }
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt >= maxAttempts || !shouldRetry(e, attempt)) {
        throw e;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await sleep(delay, opts.signal);
    }
  }

  throw lastError;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout after ${timeoutMs}ms`)),
      timeoutMs
    );
    const onAbort = () => reject(abortError());
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    });
  });
}

function abortError(): Error {
  const error = new Error("Request cancelled");
  error.name = "AbortError";
  return error;
}
