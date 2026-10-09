/**
 * 三端 CLI 启动参数（纯函数）
 * --------------------------------------------------------------
 * 从 Open Design 的 runtimes/defs 收窄到 claude / codex / cursor，
 * 保留已经踩过的坑：
 *   - prompt 走 stdin，不进 argv（Windows ENAMETOOLONG / Linux E2BIG）
 *   - cursor-agent 不要传 `-`，会被当成字面 prompt
 *   - cursor `--trust`、claude `--include-partial-messages` 必须先探测 help
 *   - Windows / WSL 上 Codex 的 workspace-write 会拦 shell，改 danger-full-access
 */

import { createHash } from "node:crypto";
import { CODEX_VAD_SHELL_ENVIRONMENT_ARGS } from "./build-env";
import type { BridgeAgentSlug } from "./install-planner";

export interface BuildCaps {
  cursorTrust?: boolean;
  claudePartialMessages?: boolean;
  claudeAddDir?: boolean;
}

export interface BuildArgOptions {
  cwd: string;
  model?: string;
  extraAllowedDirs?: string[];
  caps?: BuildCaps;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

export function codexNeedsDangerFullAccessSandbox(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const override = env.VAD_CODEX_SANDBOX?.trim() || env.OD_CODEX_SANDBOX?.trim();
  if (override === "danger-full-access") return true;
  if (override === "workspace-write") return false;
  if (platform === "win32") return true;
  return Boolean(env.WSL_DISTRO_NAME?.trim());
}

export function buildAgentArgs(slug: BridgeAgentSlug, opts: BuildArgOptions): string[] {
  switch (slug) {
    case "cursor":
      return buildCursorArgs(opts);
    case "claude":
      return buildClaudeArgs(opts);
    case "codex":
      return buildCodexArgs(opts);
  }
}

function buildCursorArgs(opts: BuildArgOptions): string[] {
  const caps = opts.caps ?? {};
  const args = ["--print", "--output-format", "stream-json", "--stream-partial-output", "--force"];
  if (caps.cursorTrust) args.push("--trust");
  if (opts.cwd) args.push("--workspace", opts.cwd);
  if (opts.model && opts.model !== "default") args.push("--model", opts.model);
  return args;
}

function buildClaudeArgs(opts: BuildArgOptions): string[] {
  const caps = opts.caps ?? {};
  const args = ["-p", "--input-format", "text", "--output-format", "stream-json", "--verbose"];
  if (caps.claudePartialMessages) args.push("--include-partial-messages");
  if (opts.model && opts.model !== "default") args.push("--model", opts.model);
  const dirs = (opts.extraAllowedDirs ?? []).filter((d) => d.length > 0);
  if (dirs.length > 0 && caps.claudeAddDir !== false) {
    args.push("--add-dir", ...dirs);
  }
  args.push("--permission-mode", "bypassPermissions");
  return args;
}

function buildCodexArgs(opts: BuildArgOptions): string[] {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const danger = codexNeedsDangerFullAccessSandbox(platform, env);
  const sandboxArgs = danger
    ? (["--sandbox", "danger-full-access"] as const)
    : ([
        "--sandbox",
        "workspace-write",
        "-c",
        "sandbox_workspace_write.network_access=true",
      ] as const);
  const args: string[] = [
    "exec",
    "--json",
    "--skip-git-repo-check",
    ...sandboxArgs,
    ...CODEX_VAD_SHELL_ENVIRONMENT_ARGS,
  ];
  if (opts.cwd) args.push("-C", opts.cwd);
  for (const dir of opts.extraAllowedDirs ?? []) {
    if (dir) args.push("--add-dir", dir);
  }
  if (opts.model && opts.model !== "default") args.push("--model", opts.model);
  return args;
}

export function quotePreviewArg(value: string): string {
  if (!/[\s"'\\]/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function formatCommandPreview(bin: string, argv: string[]): string {
  return [quotePreviewArg(bin), ...argv.map(quotePreviewArg)].join(" ");
}

export function buildCommandFingerprint(input: {
  slug: BridgeAgentSlug;
  bin: string;
  argv: string[];
  cwd: string;
  prompt: string;
}): string {
  const payload = JSON.stringify({
    slug: input.slug,
    bin: input.bin,
    argv: input.argv,
    cwd: input.cwd.replace(/\\/g, "/"),
    prompt: input.prompt,
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}
