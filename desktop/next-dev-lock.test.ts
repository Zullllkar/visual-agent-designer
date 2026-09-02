import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  commandLineLooksLikeThisRepoNext,
  parseListeningPids,
  parseNextAlreadyRunning,
  shouldKillConflictingNext,
  releaseConflictingNextDev,
} = require("./next-dev-lock.cjs") as {
  parseNextAlreadyRunning: (
    text: string,
  ) => { pid: number; port: number | null } | null;
  parseListeningPids: (netstatOutput: string, port: number) => number[];
  shouldKillConflictingNext: (input: {
    keepPort: number;
    runningPort: number | null;
  }) => boolean;
  commandLineLooksLikeThisRepoNext: (commandLine: string, repoRoot: string) => boolean;
  releaseConflictingNextDev: (input: {
    repoRoot: string;
    keepPort: number;
    netstatOutput?: string;
    readPidCommandLine?: (pid: number) => string;
    kill?: (pid: number) => boolean;
  }) => { pid: number; port: number } | null;
};

describe("parseNextAlreadyRunning", () => {
  const sample = `
Another next dev server is already running.

- Local:        http://localhost:3000
- PID:          14496
- Dir:          E:\\idea_jihuo\\idea-windows\\visual-agent-designer
`;

  it("reads pid and port from the Next lock message", () => {
    expect(parseNextAlreadyRunning(sample)).toEqual({ pid: 14496, port: 3000 });
  });

  it("returns null when the message is unrelated", () => {
    expect(parseNextAlreadyRunning("Listening on http://127.0.0.1:18765")).toBeNull();
  });
});

describe("parseListeningPids", () => {
  it("collects LISTENING pids for a port", () => {
    const output = `
  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       14496
  TCP    127.0.0.1:3000         127.0.0.1:52315        CLOSE_WAIT      14496
  TCP    [::]:3000              [::]:0                 LISTENING       14496
`;
    expect(parseListeningPids(output, 3000)).toEqual([14496]);
  });
});

describe("shouldKillConflictingNext", () => {
  it("keeps a server already bound to the desktop port", () => {
    expect(shouldKillConflictingNext({ keepPort: 18765, runningPort: 18765 })).toBe(false);
  });

  it("stops a leftover Next on another port", () => {
    expect(shouldKillConflictingNext({ keepPort: 18765, runningPort: 3000 })).toBe(true);
  });
});

describe("commandLineLooksLikeThisRepoNext", () => {
  it("matches this repo's Next start-server", () => {
    expect(
      commandLineLooksLikeThisRepoNext(
        String.raw`D:\node-js\node.exe E:\idea_jihuo\idea-windows\visual-agent-designer\node_modules\.pnpm\next@16.2.6\node_modules\next\dist\server\lib\start-server.js`,
        String.raw`E:\idea_jihuo\idea-windows\visual-agent-designer`,
      ),
    ).toBe(true);
  });

  it("ignores another project's Next", () => {
    expect(
      commandLineLooksLikeThisRepoNext(
        String.raw`C:\other\app\node_modules\next\dist\server\lib\start-server.js`,
        String.raw`E:\idea_jihuo\idea-windows\visual-agent-designer`,
      ),
    ).toBe(false);
  });
});

describe("releaseConflictingNextDev", () => {
  it("kills this repo's leftover Next on :3000", () => {
    const killed: number[] = [];
    const released = releaseConflictingNextDev({
      repoRoot: String.raw`E:\idea_jihuo\idea-windows\visual-agent-designer`,
      keepPort: 18765,
      netstatOutput: "  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       14496\n",
      readPidCommandLine: () =>
        String.raw`D:\node-js\node.exe E:\idea_jihuo\idea-windows\visual-agent-designer\node_modules\next\dist\server\lib\start-server.js`,
      kill: (pid) => {
        killed.push(pid);
        return true;
      },
    });
    expect(released).toEqual({ pid: 14496, port: 3000 });
    expect(killed).toEqual([14496]);
  });
});
