/**
 * 子进程环境
 * --------------------------------------------------------------
 * 继承用户本机 CLI 的登录态（OAuth / API key），只额外注入
 * VAD_BRIDGE_URL / VAD_BRIDGE_TOKEN / VAD_PROJECT_ID。
 *
 * Codex 会对自己的 shell 工具再套一层 `shell_environment_policy`，
 * 必须把 VAD_* 写进 include_only，否则 prompt 里看到的变量在实际
 * shell 里是空的（Open Design 用 OD_* 踩过同样的坑）。
 */

import path from "node:path";

export const VAD_BRIDGE_ENV_KEYS = [
  "VAD_BRIDGE_URL",
  "VAD_BRIDGE_TOKEN",
  "VAD_PROJECT_ID",
] as const;

export interface VadBridgeEnvInput {
  url: string;
  token: string | null;
  projectId: string;
}

const CODEX_SHELL_INCLUDE_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "TERM",
  "COLORTERM",
  "SYSTEMROOT",
  "COMSPEC",
  "PATHEXT",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "HOMEDRIVE",
  "HOMEPATH",
  ...VAD_BRIDGE_ENV_KEYS,
] as const;

export const CODEX_VAD_SHELL_ENVIRONMENT_ARGS: string[] = [
  "-c",
  "allow_login_shell=false",
  "-c",
  'shell_environment_policy.inherit="all"',
  "-c",
  "shell_environment_policy.ignore_default_excludes=true",
  "-c",
  `shell_environment_policy.include_only=[${CODEX_SHELL_INCLUDE_KEYS.map((k) => `"${k}"`).join(",")}]`,
];

export function vadBridgeEnv(input: VadBridgeEnvInput): Record<string, string> {
  const out: Record<string, string> = {
    VAD_BRIDGE_URL: input.url,
    VAD_PROJECT_ID: input.projectId,
  };
  if (input.token) out.VAD_BRIDGE_TOKEN = input.token;
  return out;
}

export function injectedEnvKeys(token: string | null): string[] {
  return token ? [...VAD_BRIDGE_ENV_KEYS] : ["VAD_BRIDGE_URL", "VAD_PROJECT_ID"];
}

export function spawnEnvForBuild(opts: {
  base?: NodeJS.ProcessEnv;
  inject: VadBridgeEnvInput;
  binPath?: string | null;
  platform?: NodeJS.Platform;
}): NodeJS.ProcessEnv {
  const platform = opts.platform ?? process.platform;
  const env: NodeJS.ProcessEnv = { ...(opts.base ?? process.env), ...vadBridgeEnv(opts.inject) };
  const binDir = opts.binPath ? path.dirname(opts.binPath) : "";
  if (binDir) prependPath(env, binDir, platform);
  return env;
}

function prependPath(env: NodeJS.ProcessEnv, dir: string, platform: NodeJS.Platform): void {
  const current = env.PATH ?? env.Path ?? "";
  const next = current ? `${dir}${path.delimiter}${current}` : dir;
  env.PATH = next;
  if (platform === "win32") env.Path = next;
}
