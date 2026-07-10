/**
 * GET /api/daemon/status
 * --------------------------------------------------------------
 * 供设置页 / IDE 展示 Daemon 是否已配置且可达。
 *
 * @author：wangjunhua
 */

import { getDaemonBaseUrl, isDaemonEnabled } from "@/lib/vad/daemon-config";
import { daemonHealth } from "@/lib/vad/daemon-client";

export async function GET() {
  const enabled = isDaemonEnabled();
  const url = getDaemonBaseUrl();

  if (!enabled) {
    return Response.json({
      enabled: false,
      connected: false,
      mode: "inline",
      message: "未配置 VAD_DAEMON_URL，落盘由 Next.js 进程直接写 .vad/",
    });
  }

  try {
    const health = await daemonHealth();
    return Response.json({
      enabled: true,
      connected: health.ok,
      mode: "daemon",
      url,
      version: health.version,
      vadRoot: health.vadRoot,
      message: health.ok
        ? "Daemon 已连接"
        : "Daemon 不可达，落盘将自动回退到 Next 进程内写盘",
    });
  } catch (e) {
    return Response.json({
      enabled: true,
      connected: false,
      mode: "daemon-fallback",
      url,
      message: (e as Error).message,
    });
  }
}
