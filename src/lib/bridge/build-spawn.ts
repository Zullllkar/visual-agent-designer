/**
 * Windows `.cmd` / `.bat` shim 启动
 * --------------------------------------------------------------
 * npm 全局装的 claude / codex / cursor-agent 在 Windows 上经常是
 * `.cmd` 包装。直接 spawn 那个路径会失败；必须走
 * `cmd.exe /d /s /c "..."` 且 `windowsVerbatimArguments: true`，
 * 否则带空格的路径会被拆开，`%VAR%` 还会被 cmd 展开。
 */

export interface CommandInvocation {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

export function quoteWindowsCommandArg(value: string): string {
  if (!/[\s"&<>|^%]/.test(value)) return value;
  const escaped = value.replace(/"/g, '""').replace(/%/g, '"^%"');
  return `"${escaped}"`;
}

export function createCommandInvocation(opts: {
  command: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): CommandInvocation {
  const platform = opts.platform ?? process.platform;
  const args = opts.args ?? [];
  if (platform === "win32" && /\.(bat|cmd)$/i.test(opts.command)) {
    const env = opts.env ?? process.env;
    const inner = [opts.command, ...args].map(quoteWindowsCommandArg).join(" ");
    return {
      command: env.ComSpec ?? env.COMSPEC ?? "cmd.exe",
      args: ["/d", "/s", "/c", `"${inner}"`],
      windowsVerbatimArguments: true,
    };
  }
  return { command: opts.command, args };
}
