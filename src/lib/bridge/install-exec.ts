/**
 * Install 执行器（IO）
 * --------------------------------------------------------------
 * 按 planner 的计划落地：shell out 到 agent 自带的 `mcp add`、深合并 JSON、
 * upsert TOML 表。每次覆盖用户配置前先留一份 *.vibeboard.bak。
 */

import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { findExecutable } from "./detect";
import {
  applyJsonInstall,
  jsonHasInstall,
  planAgentInstall,
  removeJsonInstall,
  removeTomlTable,
  tomlHasTable,
  upsertTomlTable,
  type BridgeAgentSlug,
  type BridgeEndpoint,
  type CliInstallPlan,
  type InstallPlan,
  type JsonInstallPlan,
  type TomlInstallPlan,
} from "./install-planner";

export interface InstallResult {
  ok: boolean;
  slug: BridgeAgentSlug;
  action: "install" | "uninstall";
  method: InstallPlan["kind"];
  message: string;
  configPath?: string;
  command?: string;
  stdout?: string;
  stderr?: string;
}

export interface RegistrationStatus {
  slug: BridgeAgentSlug;
  registered: boolean;
  method: InstallPlan["kind"];
  configPath?: string;
  detail?: string;
}

function buildPlan(slug: BridgeAgentSlug, endpoint: BridgeEndpoint): InstallPlan {
  const hasCli = slug === "codex" ? Boolean(findExecutable("codex")) : slug === "claude" ? Boolean(findExecutable("claude")) : false;
  return planAgentInstall(slug, endpoint, { home: homedir(), platform: process.platform, hasCli });
}

export async function installAgent(slug: BridgeAgentSlug, endpoint: BridgeEndpoint): Promise<InstallResult> {
  const plan = buildPlan(slug, endpoint);
  switch (plan.kind) {
    case "cli":
      return runCliPlan(plan, "install");
    case "json":
      return runJsonPlan(plan, "install");
    case "toml":
      return runTomlPlan(plan, "install");
  }
}

export async function uninstallAgent(slug: BridgeAgentSlug, endpoint: BridgeEndpoint): Promise<InstallResult> {
  const plan = buildPlan(slug, endpoint);
  switch (plan.kind) {
    case "cli":
      return runCliPlan(plan, "uninstall");
    case "json":
      return runJsonPlan(plan, "uninstall");
    case "toml":
      return runTomlPlan(plan, "uninstall");
  }
}

export async function registrationStatus(slug: BridgeAgentSlug, endpoint: BridgeEndpoint): Promise<RegistrationStatus> {
  const plan = buildPlan(slug, endpoint);
  if (plan.kind === "json") {
    const text = await readOrNull(plan.configPath);
    return { slug, registered: jsonHasInstall(text, plan), method: "json", configPath: plan.configPath };
  }
  if (plan.kind === "toml") {
    const text = await readOrNull(plan.configPath);
    return { slug, registered: tomlHasTable(text, plan.table), method: "toml", configPath: plan.configPath };
  }
  // cli：优先问 CLI；失败再看配置文件（codex 有 TOML，claude 看 ~/.claude.json）
  const bin = findExecutable(plan.bin);
  if (bin) {
    const result = execCli(bin, plan.getArgv, 8000);
    if (result.status === 0) return { slug, registered: true, method: "cli", detail: result.stdout.trim().slice(0, 200) };
    if (plan.tomlPatch) {
      const text = await readOrNull(plan.tomlPatch.configPath);
      return { slug, registered: tomlHasTable(text, plan.tomlPatch.table), method: "cli", configPath: plan.tomlPatch.configPath };
    }
    return { slug, registered: false, method: "cli", detail: result.stderr.trim().slice(0, 200) };
  }
  if (plan.tomlPatch) {
    const text = await readOrNull(plan.tomlPatch.configPath);
    return { slug, registered: tomlHasTable(text, plan.tomlPatch.table), method: "toml", configPath: plan.tomlPatch.configPath };
  }
  if (slug === "claude") {
    const text = await readOrNull(path.join(homedir(), ".claude.json"));
    const registered = Boolean(text && new RegExp(`"${endpoint.serverName}"\\s*:`).test(text));
    return { slug, registered, method: "cli", configPath: path.join(homedir(), ".claude.json") };
  }
  return { slug, registered: false, method: "cli", detail: `${plan.bin} CLI not found` };
}

// ───────────────────────── strategies ─────────────────────────

async function runCliPlan(plan: CliInstallPlan, action: "install" | "uninstall"): Promise<InstallResult> {
  const bin = findExecutable(plan.bin);
  if (!bin) {
    return {
      ok: false,
      slug: plan.slug,
      action,
      method: "cli",
      message: `${plan.bin} CLI not found on this machine. Install it first, or copy the command and run it manually.`,
      command: `${plan.bin} ${plan.addArgv.join(" ")}`,
    };
  }
  const argv = action === "install" ? plan.addArgv : plan.removeArgv;
  const result = execCli(bin, argv, 20_000);
  const command = `${plan.bin} ${argv.join(" ")}`;
  if (result.status !== 0) {
    return {
      ok: false,
      slug: plan.slug,
      action,
      method: "cli",
      message: `${command} exited with ${result.status}`,
      command,
      stdout: result.stdout.trim().slice(0, 800),
      stderr: result.stderr.trim().slice(0, 800),
    };
  }
  if (plan.tomlPatch) {
    const patched = action === "install" ? await runTomlPlan(plan.tomlPatch, "install") : { ok: true, message: "" };
    if (!patched.ok) {
      return { ...patched, slug: plan.slug, action, method: "cli", command };
    }
  }
  return {
    ok: true,
    slug: plan.slug,
    action,
    method: "cli",
    message:
      action === "install"
        ? `Registered via ${plan.bin} CLI.${plan.tomlPatch ? ` Patched ${plan.tomlPatch.configPath}.` : ""}`
        : `Removed via ${plan.bin} CLI.`,
    command,
    configPath: plan.tomlPatch?.configPath,
    stdout: result.stdout.trim().slice(0, 400),
  };
}

async function runJsonPlan(plan: JsonInstallPlan, action: "install" | "uninstall"): Promise<InstallResult> {
  const existing = await readOrNull(plan.configPath);
  try {
    const next = action === "install" ? applyJsonInstall(existing, plan) : removeJsonInstall(existing, plan);
    if (next === null) {
      return { ok: true, slug: plan.slug, action, method: "json", message: "Nothing to remove.", configPath: plan.configPath };
    }
    await writeWithBackup(plan.configPath, existing, next);
    return {
      ok: true,
      slug: plan.slug,
      action,
      method: "json",
      message: `${action === "install" ? "Merged" : "Removed"} ${plan.keyPath.join(".")}.${plan.serverKey} in ${plan.configPath}`,
      configPath: plan.configPath,
    };
  } catch (err) {
    return { ok: false, slug: plan.slug, action, method: "json", message: (err as Error).message, configPath: plan.configPath };
  }
}

async function runTomlPlan(plan: TomlInstallPlan, action: "install" | "uninstall"): Promise<InstallResult> {
  const existing = await readOrNull(plan.configPath);
  try {
    const next = action === "install" ? upsertTomlTable(existing, plan.table, plan.entries) : removeTomlTable(existing, plan.table);
    if (next === null) {
      return { ok: true, slug: plan.slug, action, method: "toml", message: "Nothing to remove.", configPath: plan.configPath };
    }
    await writeWithBackup(plan.configPath, existing, next);
    return {
      ok: true,
      slug: plan.slug,
      action,
      method: "toml",
      message: `${action === "install" ? "Upserted" : "Removed"} [${plan.table}] in ${plan.configPath}`,
      configPath: plan.configPath,
    };
  } catch (err) {
    return { ok: false, slug: plan.slug, action, method: "toml", message: (err as Error).message, configPath: plan.configPath };
  }
}

// ───────────────────────── io helpers ─────────────────────────

async function readOrNull(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function writeWithBackup(file: string, previous: string | null, next: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  if (previous !== null && previous !== next) {
    await fs.writeFile(`${file}.vibeboard.bak`, previous, "utf8").catch(() => undefined);
  }
  const tmp = `${file}.tmp-vibeboard`;
  await fs.writeFile(tmp, next, "utf8");
  await fs.rename(tmp, file);
}

function execCli(executable: string, args: string[], timeoutMs: number): { status: number | null; stdout: string; stderr: string } {
  const useShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(executable);
  const result = spawnSync(
    useShell ? `"${executable}"` : executable,
    useShell ? args.map(quoteForCmd) : args,
    { encoding: "utf8", timeout: timeoutMs, shell: useShell, windowsHide: true }
  );
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? (result.error?.message ?? "") };
}

function quoteForCmd(arg: string): string {
  if (/^[A-Za-z0-9_./:=,@+-]+$/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}
