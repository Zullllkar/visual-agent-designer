/**
 * Next 16 每个仓库只允许一个 dev 实例。
 * 桌面端走 18765，浏览器 `pnpm dev` 常占 3000，会抢 .next 编译锁。
 */

const { execFileSync, spawnSync } = require("node:child_process");
const path = require("node:path");

function parseNextAlreadyRunning(text) {
  const raw = String(text || "");
  if (!/Another next dev server is already running/i.test(raw)) return null;
  const pid = Number(/PID:\s+(\d+)/.exec(raw)?.[1]);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const port = Number(
    /localhost:(\d+)/.exec(raw)?.[1] || /127\.0\.0\.1:(\d+)/.exec(raw)?.[1],
  );
  return { pid, port: Number.isInteger(port) && port > 0 ? port : null };
}

function parseListeningPids(netstatOutput, port) {
  const wanted = Number(port);
  if (!Number.isInteger(wanted) || wanted <= 0) return [];
  const pids = new Set();
  for (const line of String(netstatOutput || "").split(/\r?\n/)) {
    if (!/LISTENING/i.test(line)) continue;
    const match = line.match(/[:\]](\d+)\s+\S+\s+LISTENING\s+(\d+)/i);
    if (!match) continue;
    if (Number(match[1]) !== wanted) continue;
    pids.add(Number(match[2]));
  }
  return [...pids];
}

function shouldKillConflictingNext({ keepPort, runningPort }) {
  const keep = Number(keepPort);
  const running = Number(runningPort);
  if (!Number.isInteger(running) || running <= 0) return false;
  return running !== keep;
}

function commandLineLooksLikeThisRepoNext(commandLine, repoRoot) {
  const line = String(commandLine || "")
    .replaceAll("\\", "/")
    .toLowerCase();
  const root = path
    .resolve(String(repoRoot || ""))
    .replaceAll("\\", "/")
    .toLowerCase();
  if (!line.includes(root)) return false;
  return (
    line.includes("start-server.js") ||
    line.includes("/server.ts") ||
    line.includes("/next/")
  );
}

function readNetstat() {
  try {
    return execFileSync("netstat", ["-ano"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 8000,
    });
  } catch {
    return "";
  }
}

function readCommandLine(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return "";
  if (process.platform === "win32") {
    try {
      return execFileSync(
        "wmic",
        ["process", "where", `ProcessId=${pid}`, "get", "CommandLine", "/VALUE"],
        { encoding: "utf8", windowsHide: true, timeout: 8000 },
      );
    } catch {
      return "";
    }
  }
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "args="], {
      encoding: "utf8",
      timeout: 4000,
    });
  } catch {
    return "";
  }
}

function killPidTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
    });
    return result.status === 0;
  }
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

function uniquePids(values) {
  return [...new Set(values.filter((pid) => Number.isInteger(pid) && pid > 0))];
}

function releaseConflictingNextDev({
  repoRoot,
  keepPort,
  netstatOutput,
  readPidCommandLine = readCommandLine,
  kill = killPidTree,
} = {}) {
  const output = netstatOutput == null ? readNetstat() : netstatOutput;
  const leftoverPort = 3000;
  if (!shouldKillConflictingNext({ keepPort, runningPort: leftoverPort })) {
    return null;
  }
  const pids = uniquePids(parseListeningPids(output, leftoverPort));
  for (const pid of pids) {
    const commandLine = readPidCommandLine(pid);
    if (!commandLineLooksLikeThisRepoNext(commandLine, repoRoot)) continue;
    if (!kill(pid)) continue;
    return { pid, port: leftoverPort };
  }
  return null;
}

module.exports = {
  parseNextAlreadyRunning,
  parseListeningPids,
  shouldKillConflictingNext,
  commandLineLooksLikeThisRepoNext,
  releaseConflictingNextDev,
  killPidTree,
};
