/**
 * Build runner：在关联仓库里 spawn 本机 coding agent CLI
 * --------------------------------------------------------------
 * 启动前必须经过 preview → 用户确认 fingerprint。同一项目同时只跑一个。
 * prompt 写入 stdin 后关闭；取消时 Windows 走 taskkill /T，Unix 杀进程组。
 */

import { type ChildProcess, spawn } from "node:child_process";
import { nanoid } from "nanoid";
import { buildRepoKickoffText } from "@/lib/handoff/kickoff-prompt";
import type { ProjectFile } from "@/lib/project/schema";
import {
  type BuildCaps,
  buildAgentArgs,
  buildCommandFingerprint,
  formatCommandPreview,
} from "./build-args";
import { probeBuildCaps } from "./build-caps";
import { injectedEnvKeys, spawnEnvForBuild } from "./build-env";
import { createCommandInvocation } from "./build-spawn";
import { type BuildLogEvent, createBuildStreamParser } from "./build-stream";
import { detectAgentCli } from "./detect";
import type { BridgeAgentSlug } from "./install-planner";
import { DEFAULT_MOUNT_DIR, validateRepoPath } from "./repo-path";
import { syncLinkedRepo } from "./repo-sync";

const MAX_EVENTS = 2000;
const MAX_RUNS = 16;
const KILL_GRACE_MS = 2500;

export type BuildRunStatus = "running" | "completed" | "failed" | "cancelled";

export interface PreparedBuild {
  slug: BridgeAgentSlug;
  bin: string;
  binPath: string;
  version: string | null;
  argv: string[];
  command: string;
  cwd: string;
  fingerprint: string;
  prompt: string;
  envKeys: string[];
  warnings: string[];
  caps: BuildCaps;
  installUrl: string;
}

export interface BuildRunPublic {
  id: string;
  projectId: string;
  slug: BridgeAgentSlug;
  status: BuildRunStatus;
  cwd: string;
  bin: string;
  command: string;
  fingerprint: string;
  startedAt: number;
  endedAt?: number;
  exitCode?: number | null;
  error?: string;
  events: BuildLogEvent[];
  promptChars: number;
  eventCount: number;
}

interface LiveRun {
  public: BuildRunPublic;
  prompt: string;
  child: ChildProcess | null;
  killed: boolean;
  emitted: number;
}

const runs = new Map<string, LiveRun>();

export interface PrepareBuildInput {
  project: ProjectFile;
  slug: BridgeAgentSlug;
  extraPrompt?: string;
  model?: string;
  bridgeUrl: string;
  bridgeToken: string | null;
}

export type PrepareBuildResult =
  | { ok: true; prepared: PreparedBuild }
  | { ok: false; error: string; code: string };

export function prepareBuild(input: PrepareBuildInput): PrepareBuildResult {
  const link = input.project.linkedRepo;
  if (!link?.path) {
    return {
      ok: false,
      code: "no_linked_repo",
      error: "先关联代码仓库（导出 → 同步到代码仓库），再从这里拉起 CLI。",
    };
  }
  const checked = validateRepoPath(link.path, { mountDir: link.mountDir });
  if (!checked.ok) {
    return { ok: false, code: "invalid_repo", error: checked.error };
  }

  const cli = detectAgentCli(input.slug);
  if (!cli.installed || !cli.path) {
    return {
      ok: false,
      code: "cli_missing",
      error: `未找到 ${cli.bin}。安装：${cli.installUrl}`,
    };
  }

  const caps = probeBuildCaps(input.slug, cli.path);
  const argv = buildAgentArgs(input.slug, {
    cwd: checked.path,
    model: input.model,
    caps,
  });
  const mount = link.mountDir || DEFAULT_MOUNT_DIR;
  const extra = input.extraPrompt?.trim();
  const prompt = extra
    ? `${buildRepoKickoffText(input.project, mount)}\n\n## Extra instructions\n\n${extra}`
    : buildRepoKickoffText(input.project, mount);
  const warnings: string[] = [];
  if (!checked.git) warnings.push("该目录不是 git 仓库。");
  if (input.slug === "codex" && process.platform === "win32") {
    warnings.push("Windows 上 Codex 会以 danger-full-access 运行（否则 shell 会被沙箱拦掉）。");
  }
  if (input.slug === "claude") {
    warnings.push("Claude Code 将使用 --permission-mode bypassPermissions，请只在可信仓库里启动。");
  }
  if (input.slug === "cursor" && !caps.cursorTrust) {
    warnings.push("当前 cursor-agent 没有 --trust，headless 运行可能卡在工作区信任提示。");
  }

  const prepared: PreparedBuild = {
    slug: input.slug,
    bin: cli.bin,
    binPath: cli.path,
    version: cli.version,
    argv,
    command: formatCommandPreview(cli.path, argv),
    cwd: checked.path,
    fingerprint: buildCommandFingerprint({
      slug: input.slug,
      bin: cli.path,
      argv,
      cwd: checked.path,
      prompt,
    }),
    prompt,
    envKeys: injectedEnvKeys(input.bridgeToken),
    warnings,
    caps,
    installUrl: cli.installUrl,
  };
  return { ok: true, prepared };
}

export async function startBuild(opts: {
  project: ProjectFile;
  slug: BridgeAgentSlug;
  extraPrompt?: string;
  model?: string;
  fingerprint: string;
  confirm: boolean;
  bridgeUrl: string;
  bridgeToken: string | null;
}): Promise<
  | { ok: true; run: BuildRunPublic }
  | { ok: false; error: string; code: string; prepared?: PreparedBuild }
> {
  if (!opts.confirm) {
    return { ok: false, code: "confirm_required", error: "必须先预览命令并确认后再启动。" };
  }
  const prepared = prepareBuild(opts);
  if (!prepared.ok) return prepared;
  if (prepared.prepared.fingerprint !== opts.fingerprint) {
    return {
      ok: false,
      code: "fingerprint_mismatch",
      error: "命令已变化，请重新预览后再确认启动。",
      prepared: prepared.prepared,
    };
  }

  const existing = [...runs.values()].find(
    (r) => r.public.projectId === opts.project.id && r.public.status === "running",
  );
  if (existing) {
    return {
      ok: false,
      code: "already_running",
      error: `项目里已有一次 ${existing.public.slug} 运行（${existing.public.id}）。`,
    };
  }

  const id = `bld_${nanoid(10)}`;
  const pub: BuildRunPublic = {
    id,
    projectId: opts.project.id,
    slug: opts.slug,
    status: "running",
    cwd: prepared.prepared.cwd,
    bin: prepared.prepared.bin,
    command: prepared.prepared.command,
    fingerprint: prepared.prepared.fingerprint,
    startedAt: Date.now(),
    events: [],
    promptChars: prepared.prepared.prompt.length,
    eventCount: 0,
  };
  const live: LiveRun = {
    public: pub,
    prompt: prepared.prepared.prompt,
    child: null,
    killed: false,
    emitted: 0,
  };
  runs.set(id, live);
  pruneRuns();

  pushEvent(live, {
    ts: Date.now(),
    kind: "status",
    text: `同步设计稿到 ${opts.project.linkedRepo?.mountDir ?? DEFAULT_MOUNT_DIR}`,
  });
  try {
    const sync = await syncLinkedRepo(opts.project);
    if (!sync.ok) {
      pushEvent(live, { ts: Date.now(), kind: "error", text: sync.error || "仓库同步失败" });
    } else {
      pushEvent(live, {
        ts: Date.now(),
        kind: "status",
        text: `已写入 ${sync.written} 个文件${sync.warnings.length ? `（${sync.warnings.join("；")}）` : ""}`,
      });
    }
  } catch (err) {
    pushEvent(live, { ts: Date.now(), kind: "error", text: `同步失败：${(err as Error).message}` });
  }

  const env = spawnEnvForBuild({
    inject: { url: opts.bridgeUrl, token: opts.bridgeToken, projectId: opts.project.id },
    binPath: prepared.prepared.binPath,
  });
  const invocation = createCommandInvocation({
    command: prepared.prepared.binPath,
    args: prepared.prepared.argv,
    env,
  });

  try {
    const child = spawn(invocation.command, invocation.args, {
      cwd: prepared.prepared.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      detached: process.platform !== "win32",
    });
    live.child = child;
    const parser = createBuildStreamParser(opts.slug);

    child.stdout?.on("data", (buf: Buffer) => {
      for (const ev of parser.push(buf.toString("utf8"), "stdout")) pushEvent(live, ev);
    });
    child.stderr?.on("data", (buf: Buffer) => {
      for (const ev of parser.push(buf.toString("utf8"), "stderr")) pushEvent(live, ev);
    });
    child.stdin?.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EPIPE" || err.code === "EOF" || err.message === "write EOF") return;
      pushEvent(live, { ts: Date.now(), kind: "error", text: `stdin: ${err.message}` });
    });
    try {
      child.stdin?.write(prepared.prepared.prompt);
      child.stdin?.end();
    } catch {
      // 子进程可能已经退出
    }

    child.on("error", (err) => {
      if (live.public.status !== "running") return;
      live.public.status = "failed";
      live.public.error = err.message;
      live.public.endedAt = Date.now();
      pushEvent(live, { ts: Date.now(), kind: "error", text: err.message });
    });
    child.on("close", (code, signal) => {
      for (const ev of parser.flush()) pushEvent(live, ev);
      live.child = null;
      live.public.exitCode = code;
      live.public.endedAt = Date.now();
      if (live.killed || live.public.status === "cancelled") {
        live.public.status = "cancelled";
        pushEvent(live, { ts: Date.now(), kind: "status", text: "已取消" });
        return;
      }
      if (code === 0) {
        live.public.status = "completed";
        pushEvent(live, { ts: Date.now(), kind: "status", text: "退出码 0" });
      } else {
        live.public.status = "failed";
        live.public.error = signal ? `killed ${signal}` : `exit ${code ?? "?"}`;
        pushEvent(live, { ts: Date.now(), kind: "error", text: live.public.error });
      }
    });
  } catch (err) {
    live.public.status = "failed";
    live.public.error = (err as Error).message;
    live.public.endedAt = Date.now();
    pushEvent(live, { ts: Date.now(), kind: "error", text: live.public.error });
  }

  return { ok: true, run: publicRun(live, 0) };
}

export function cancelBuild(
  runId: string,
): { ok: true; run: BuildRunPublic } | { ok: false; error: string; code: string } {
  const live = runs.get(runId);
  if (!live) return { ok: false, code: "not_found", error: "找不到这次运行。" };
  if (live.public.status !== "running") {
    return { ok: false, code: "not_running", error: "这次运行已经结束。" };
  }
  live.killed = true;
  live.public.status = "cancelled";
  killChild(live.child);
  return { ok: true, run: publicRun(live, 0) };
}

export function getBuild(runId: string, after = 0): BuildRunPublic | null {
  const live = runs.get(runId);
  return live ? publicRun(live, after) : null;
}

export function listBuilds(projectId: string): BuildRunPublic[] {
  return [...runs.values()]
    .filter((r) => r.public.projectId === projectId)
    .sort((a, b) => b.public.startedAt - a.public.startedAt)
    .map((r) => publicRun(r, Math.max(0, r.emitted - 40)));
}

export function resetBuildRunsForTests(): void {
  for (const live of runs.values()) killChild(live.child);
  runs.clear();
}

function publicRun(live: LiveRun, after: number): BuildRunPublic {
  const pending = Math.max(0, live.emitted - Math.max(0, after));
  const start = Math.max(0, live.public.events.length - pending);
  return {
    ...live.public,
    events: live.public.events.slice(start),
    eventCount: live.emitted,
  };
}

function pushEvent(live: LiveRun, ev: BuildLogEvent): void {
  live.emitted += 1;
  live.public.events.push({ ...ev, seq: live.emitted });
  live.public.eventCount = live.emitted;
  if (live.public.events.length > MAX_EVENTS) {
    live.public.events.splice(0, live.public.events.length - MAX_EVENTS);
  }
}

function pruneRuns(): void {
  if (runs.size <= MAX_RUNS) return;
  const finished = [...runs.values()]
    .filter((r) => r.public.status !== "running")
    .sort((a, b) => (a.public.endedAt ?? 0) - (b.public.endedAt ?? 0));
  while (runs.size > MAX_RUNS && finished.length > 0) {
    const drop = finished.shift();
    if (drop) runs.delete(drop.public.id);
  }
}

function killChild(child: ChildProcess | null): void {
  if (!child || child.killed || child.exitCode != null) return;
  const pid = child.pid;
  if (typeof pid !== "number") {
    child.kill("SIGTERM");
    return;
  }
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore",
    }).unref();
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  setTimeout(() => {
    if (child.exitCode != null) return;
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }, KILL_GRACE_MS).unref();
}
