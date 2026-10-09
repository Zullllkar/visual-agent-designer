/**
 * CLI 能力探测
 * --------------------------------------------------------------
 * `--trust` / `--include-partial-messages` 只在较新的版本存在，
 * 老版本遇到 unknown option 会直接 exit 1。先读 help 再决定要不要加。
 */

import { spawnSync } from "node:child_process";
import type { BuildCaps } from "./build-args";
import { createCommandInvocation } from "./build-spawn";
import type { BridgeAgentSlug } from "./install-planner";

const cache = new Map<string, { at: number; text: string }>();
const TTL_MS = 10 * 60 * 1000;

export function probeHelpText(
  executable: string,
  helpArgs: string[],
  timeoutMs = 4000,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const key = `${executable}\0${helpArgs.join("\0")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.text;
  try {
    const invocation = createCommandInvocation({ command: executable, args: helpArgs, env });
    const result = spawnSync(invocation.command, invocation.args, {
      encoding: "utf8",
      timeout: timeoutMs,
      windowsHide: true,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      env,
    });
    const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    cache.set(key, { at: Date.now(), text });
    return text;
  } catch {
    cache.set(key, { at: Date.now(), text: "" });
    return "";
  }
}

export function probeBuildCaps(slug: BridgeAgentSlug, executable: string): BuildCaps {
  if (slug === "cursor") {
    const help = probeHelpText(executable, ["--help"]);
    return { cursorTrust: help.includes("--trust") };
  }
  if (slug === "claude") {
    const help = probeHelpText(executable, ["-p", "--help"]);
    return {
      claudePartialMessages: help.includes("--include-partial-messages"),
      claudeAddDir: help.includes("--add-dir"),
    };
  }
  return {};
}

export function resetBuildCapsCache(): void {
  cache.clear();
}
