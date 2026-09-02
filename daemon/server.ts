/**
 * Vibeboard Daemon 入口
 * --------------------------------------------------------------
 * 独立 Node 进程，专职 .vad/projects/ 文件系统读写。
 * 默认仅监听 127.0.0.1:3921，避免暴露到局域网。
 *
 * 启动：pnpm daemon
 * Next 转发：在 .env.local 设置 VAD_DAEMON_URL=http://127.0.0.1:3921
 *
 * @author：wangjunhua
 */

import { createServer } from "node:http";
import { DEFAULT_DAEMON_PORT } from "../src/lib/vad/daemon-config";
import { VAD_ROOT } from "../src/lib/vad/paths";
import { handleDaemonRequest } from "./router";
import { vadProjectWatcher } from "../src/lib/vad/project-watcher";

const HOST = process.env.VAD_DAEMON_HOST ?? "127.0.0.1";
const PORT = Number(process.env.VAD_DAEMON_PORT ?? DEFAULT_DAEMON_PORT);

const server = createServer((req, res) => {
  void handleDaemonRequest(req, res);
});

vadProjectWatcher.start();

server.listen(PORT, HOST, () => {
  console.log(`[vad-daemon] listening on http://${HOST}:${PORT}`);
  console.log(`[vad-daemon] VAD_ROOT=${VAD_ROOT}`);
  console.log(
    `[vad-daemon] auth=${process.env.VAD_DAEMON_TOKEN ? "token required" : "none"}`
  );
});

server.on("error", (err) => {
  console.error("[vad-daemon] fatal:", err);
  process.exit(1);
});

function shutdown() {
  console.log("[vad-daemon] shutting down…");
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
