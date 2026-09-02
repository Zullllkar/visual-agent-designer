/**
 * Vibeboard Daemon 配置
 * --------------------------------------------------------------
 * 设置 VAD_DAEMON_URL 后，Next.js API 将落盘请求转发到独立 Daemon 进程。
 *
 * @author：wangjunhua
 */

/** Daemon 默认监听端口 */
export const DEFAULT_DAEMON_PORT = 3921;

/** 解析 Daemon 基址（无尾部斜杠）；未配置则返回 null */
export function getDaemonBaseUrl(): string | null {
  const raw =
    process.env.VAD_DAEMON_URL?.trim() ||
    (process.env.VAD_USE_DAEMON === "true"
      ? `http://127.0.0.1:${process.env.VAD_DAEMON_PORT ?? DEFAULT_DAEMON_PORT}`
      : "");
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

export function isDaemonEnabled(): boolean {
  return getDaemonBaseUrl() != null;
}

export function getDaemonAuthToken(): string | undefined {
  const t = process.env.VAD_DAEMON_TOKEN?.trim();
  return t || undefined;
}
