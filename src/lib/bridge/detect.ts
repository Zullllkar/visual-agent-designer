/**
 * coding agent CLI 检测
 * --------------------------------------------------------------
 * GUI 启动的 Electron 进程继承的是被裁过的 PATH，`npm i -g` 装的 CLI
 * 经常找不到。除 PATH 外再扫一遍用户级工具链目录（npm 全局、nvm、fnm、
 * volta、scoop、pnpm、bun、Cursor CLI 自带目录）。
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { BridgeAgentSlug } from "./install-planner";

export interface DetectedCli {
  slug: BridgeAgentSlug;
  bin: string;
  path: string | null;
  version: string | null;
  installed: boolean;
  /** Cursor 特有：IDE 本体是否安装（~/.cursor 存在） */
  appInstalled?: boolean;
  installUrl: string;
}

const CLI_BINS: Record<BridgeAgentSlug, { bin: string; alt?: string[]; installUrl: string }> = {
  claude: { bin: "claude", installUrl: "https://docs.anthropic.com/en/docs/claude-code/setup" },
  codex: { bin: "codex", installUrl: "https://developers.openai.com/codex/cli" },
  cursor: { bin: "cursor-agent", alt: ["agent"], installUrl: "https://cursor.com/docs/cli" },
};

export function wellKnownToolchainBins(
  home: string = homedir(),
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string[] {
  const dirs: string[] = [];
  const npmPrefix = (env.NPM_CONFIG_PREFIX ?? env.npm_config_prefix)?.trim();
  if (npmPrefix) {
    dirs.push(path.join(npmPrefix, "bin"));
    if (platform === "win32") dirs.push(npmPrefix);
  }
  if (platform === "win32") {
    const appData = env.APPDATA?.trim() || path.join(home, "AppData", "Roaming");
    const localAppData = env.LOCALAPPDATA?.trim() || path.join(home, "AppData", "Local");
    dirs.push(
      path.join(appData, "npm"),
      path.join(home, "scoop", "shims"),
      path.join(localAppData, "pnpm"),
      path.join(localAppData, "Programs", "cursor", "resources", "app", "bin")
    );
    for (const root of [env.FNM_DIR?.trim(), path.join(localAppData, "fnm"), path.join(appData, "fnm")]) {
      if (!root) continue;
      dirs.push(...versionedChildren(path.join(root, "node-versions"), ["installation"]));
    }
  }
  dirs.push(
    path.join(home, ".local", "bin"),
    path.join(home, ".cursor", "bin"),
    path.join(home, ".bun", "bin"),
    path.join(home, ".volta", "bin"),
    path.join(home, ".asdf", "shims"),
    path.join(home, "Library", "pnpm"),
    path.join(home, ".npm-global", "bin"),
    path.join(home, ".npm-packages", "bin"),
    path.join(home, ".local", "share", "mise", "shims"),
    path.join(home, ".nix-profile", "bin")
  );
  dirs.push(...versionedChildren(path.join(home, ".nvm", "versions", "node"), ["bin"]));
  dirs.push(...versionedChildren(path.join(home, ".local", "share", "fnm", "node-versions"), ["installation", "bin"]));
  if (platform !== "win32") dirs.push("/opt/homebrew/bin", "/usr/local/bin");
  return dirs;
}

function versionedChildren(root: string, segments: string[]): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() || d.isSymbolicLink())
      .map((d) => path.join(root, d.name, ...segments))
      .filter((p) => existsSync(p));
  } catch {
    return [];
  }
}

export function findExecutable(
  name: string,
  opts: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; home?: string } = {}
): string | null {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const home = opts.home ?? homedir();
  const pathDirs = (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean);
  const candidatesDirs = [...pathDirs, ...wellKnownToolchainBins(home, env, platform)];
  const exts =
    platform === "win32"
      ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").map((e) => e.toLowerCase()).concat([""])
      : [""];
  for (const dir of candidatesDirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, `${name}${ext}`);
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // 不存在，继续
      }
    }
  }
  return null;
}

export function probeVersion(executable: string, timeoutMs = 5000): string | null {
  try {
    const useShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(executable);
    const result = spawnSync(useShell ? `"${executable}"` : executable, ["--version"], {
      encoding: "utf8",
      timeout: timeoutMs,
      shell: useShell,
      windowsHide: true,
    });
    const out = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
    const m = out.match(/\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?/);
    return m ? m[0] : out.split("\n")[0]?.slice(0, 60) || null;
  } catch {
    return null;
  }
}

export function detectAgentCli(slug: BridgeAgentSlug): DetectedCli {
  const spec = CLI_BINS[slug];
  const names = [spec.bin, ...(spec.alt ?? [])];
  let found: string | null = null;
  let bin = spec.bin;
  for (const name of names) {
    const p = findExecutable(name);
    if (p) {
      found = p;
      bin = name;
      break;
    }
  }
  const out: DetectedCli = {
    slug,
    bin,
    path: found,
    version: found ? probeVersion(found) : null,
    installed: Boolean(found),
    installUrl: spec.installUrl,
  };
  if (slug === "cursor") {
    out.appInstalled = existsSync(path.join(homedir(), ".cursor"));
  }
  return out;
}

export function detectAllAgentClis(): DetectedCli[] {
  return (Object.keys(CLI_BINS) as BridgeAgentSlug[]).map(detectAgentCli);
}
