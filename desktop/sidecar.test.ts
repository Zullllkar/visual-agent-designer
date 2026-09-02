import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { resolveDevSidecarSpawn } = require("./sidecar.cjs") as {
  resolveDevSidecarSpawn: (input: {
    platform: NodeJS.Platform;
    repoRoot: string;
    env: NodeJS.ProcessEnv;
  }) => { command: string; args: string[]; options: { cwd: string; shell: boolean } };
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function specForThisMachine() {
  return resolveDevSidecarSpawn({
    platform: process.platform === "win32" ? "win32" : "linux",
    repoRoot,
    env: {
      ...process.env,
      npm_node_execpath: process.execPath,
    },
  });
}

describe("resolveDevSidecarSpawn", () => {
  it("does not spawn .cmd/.bat on Windows (avoids Node EINVAL)", () => {
    const spec = resolveDevSidecarSpawn({
      platform: "win32",
      repoRoot,
      env: {
        ...process.env,
        npm_node_execpath: process.execPath,
      },
    });
    expect(spec.command).not.toMatch(/\.(cmd|bat)$/i);
    expect(path.basename(spec.command).toLowerCase()).toMatch(/^node(\.exe)?$/);
    expect(spec.options.shell).toBe(false);
    expect(spec.args[0]).toMatch(/tsx[/\\]dist[/\\]cli\.mjs$/i);
    expect(spec.args.slice(1)).toEqual(["--import", "./preload.cjs", "server.ts"]);
    expect(spec.options.cwd).toBe(repoRoot);
  });

  it("can spawn the resolved node binary without EINVAL", async () => {
    const spec = specForThisMachine();
    await new Promise<void>((resolve, reject) => {
      const child = spawn(spec.command, ["-e", "process.exit(0)"], {
        shell: false,
        windowsHide: true,
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`exit ${code}`));
      });
    });
  });
});
