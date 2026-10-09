/**
 * 关联仓库同步
 * --------------------------------------------------------------
 * 把当前项目的 handoff 包写到 <repo>/<mountDir>/，维护一份清单以便下次
 * 只删除「上次是我们写的、这次没有了」的文件。可选写入 AGENTS.md /
 * CLAUDE.md 受管片段、.cursor/rules、项目级 MCP 配置。
 */

import { promises as fs } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import type { LinkedRepo, ProjectFile } from "@/lib/project/schema";
import { BRIDGE_SERVER_NAME, readBridgeDiscovery } from "./config";
import { getBuiltHandoff } from "./handoff-cache";
import { applyJsonInstall, upsertTomlTable, type JsonInstallPlan } from "./install-planner";
import {
  cursorRuleFile,
  designTruthSnippet,
  hasManagedSnippet,
  upsertManagedSnippet,
} from "./managed-snippet";
import { DEFAULT_MOUNT_DIR, mountAbsolute, validateRepoPath } from "./repo-path";

const MANIFEST_NAME = ".vibeboard-manifest.json";

export interface RepoManifest {
  version: 1;
  projectId: string;
  mountDir: string;
  files: string[];
  updatedAt: string;
}

export interface RepoSyncResult {
  ok: boolean;
  path: string;
  mountDir: string;
  git: boolean;
  written: number;
  removed: number;
  agentFiles: string[];
  mcpFiles: string[];
  warnings: string[];
  error?: string;
}

const pending = new Map<string, ReturnType<typeof setTimeout>>();

/** 保存项目后防抖同步，避免 Agent 连续写盘时反复重建 zip 级产物。 */
export function scheduleLinkedRepoSync(project: ProjectFile, delayMs = 1500): void {
  if (!project.linkedRepo?.path) return;
  const prev = pending.get(project.id);
  if (prev) clearTimeout(prev);
  pending.set(
    project.id,
    setTimeout(() => {
      pending.delete(project.id);
      void syncLinkedRepo(project).catch((err) => {
        console.warn("[repo-sync] scheduled sync failed:", (err as Error).message);
      });
    }, delayMs)
  );
}

export async function syncLinkedRepo(project: ProjectFile): Promise<RepoSyncResult> {
  const link = project.linkedRepo;
  if (!link?.path) {
    return {
      ok: false,
      path: "",
      mountDir: DEFAULT_MOUNT_DIR,
      git: false,
      written: 0,
      removed: 0,
      agentFiles: [],
      mcpFiles: [],
      warnings: [],
      error: "Project has no linked repository.",
    };
  }

  const checked = validateRepoPath(link.path, { mountDir: link.mountDir });
  if (!checked.ok) {
    return emptyFail(link, checked.error);
  }

  const warnings: string[] = [];
  if (!checked.git) {
    warnings.push("Folder is not a git repository. Linking anyway.");
  }

  const mountDir = checked.mountDir;
  const destRoot = mountAbsolute(checked.path, mountDir);
  const destRootResolved = resolve(destRoot);
  const repoResolved = resolve(checked.path);
  if (relative(repoResolved, destRootResolved).startsWith("..")) {
    return emptyFail(link, "mountDir escaped the repository.");
  }

  const built = await getBuiltHandoff(project);
  const nextFiles = [...built.files.keys()].map((p) => p.replace(/\\/g, "/"));

  const manifestPath = join(destRoot, MANIFEST_NAME);
  const prev = await readManifest(manifestPath);
  const prevFiles = prev?.projectId === project.id ? prev.files : [];

  await fs.mkdir(destRoot, { recursive: true });

  let written = 0;
  for (const relPath of nextFiles) {
    const content = built.files.get(relPath);
    if (content === undefined) continue;
    const full = join(destRoot, ...relPath.split("/"));
    if (relative(destRootResolved, resolve(full)).startsWith("..")) continue;
    await atomicWrite(full, content);
    written += 1;
  }

  let removed = 0;
  const nextSet = new Set(nextFiles);
  for (const relPath of prevFiles) {
    if (nextSet.has(relPath) || relPath === MANIFEST_NAME) continue;
    const full = join(destRoot, ...relPath.split("/"));
    if (relative(destRootResolved, resolve(full)).startsWith("..")) continue;
    try {
      await fs.unlink(full);
      removed += 1;
    } catch {
      // 用户可能已经手动删了
    }
  }

  const manifest: RepoManifest = {
    version: 1,
    projectId: project.id,
    mountDir,
    files: nextFiles,
    updatedAt: new Date().toISOString(),
  };
  await atomicWrite(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  const agentFiles: string[] = [];
  if (link.writeAgentFiles !== false) {
    agentFiles.push(
      ...(await writeAgentFiles(checked.path, mountDir).catch((err) => {
        warnings.push(`Agent files: ${(err as Error).message}`);
        return [] as string[];
      }))
    );
  }

  const mcpFiles: string[] = [];
  if (link.writeMcpConfig !== false) {
    mcpFiles.push(
      ...(await writeProjectMcpConfigs(checked.path).catch((err) => {
        warnings.push(`MCP config: ${(err as Error).message}`);
        return [] as string[];
      }))
    );
  }

  return {
    ok: true,
    path: checked.path,
    mountDir,
    git: checked.git,
    written,
    removed,
    agentFiles,
    mcpFiles,
    warnings,
  };
}

async function writeAgentFiles(repoPath: string, mountDir: string): Promise<string[]> {
  const written: string[] = [];
  const snippet = designTruthSnippet(mountDir);
  for (const name of ["AGENTS.md", "CLAUDE.md"] as const) {
    const full = join(repoPath, name);
    const existing = await readOrNull(full);
    await atomicWrite(full, upsertManagedSnippet(existing, snippet));
    written.push(name);
  }

  const ruleRel = join(".cursor", "rules", "vibeboard-design.mdc");
  const ruleFull = join(repoPath, ruleRel);
  const existingRule = await readOrNull(ruleFull);
  if (existingRule && !hasManagedSnippet(existingRule) && !existingRule.includes("alwaysApply: true")) {
    // 用户手写的规则文件，不覆盖
  } else {
    await atomicWrite(ruleFull, cursorRuleFile(mountDir));
    written.push(ruleRel.replace(/\\/g, "/"));
  }
  return written;
}

async function writeProjectMcpConfigs(repoPath: string): Promise<string[]> {
  const disc = await readBridgeDiscovery();
  if (!disc?.url) return [];
  const endpoint = {
    url: disc.url,
    token: disc.token,
    serverName: BRIDGE_SERVER_NAME,
  };
  const written: string[] = [];

  const cursorPlan: JsonInstallPlan = {
    kind: "json",
    slug: "cursor",
    configPath: join(repoPath, ".cursor", "mcp.json"),
    keyPath: ["mcpServers"],
    serverKey: BRIDGE_SERVER_NAME,
    entry: {
      type: "http",
      url: endpoint.url,
      ...(endpoint.token ? { headers: { Authorization: `Bearer ${endpoint.token}` } } : {}),
    },
  };
  const cursorExisting = await readOrNull(cursorPlan.configPath);
  await atomicWrite(cursorPlan.configPath, applyJsonInstall(cursorExisting, cursorPlan));
  written.push(".cursor/mcp.json");

  const claudePlan: JsonInstallPlan = {
    kind: "json",
    slug: "claude",
    configPath: join(repoPath, ".mcp.json"),
    keyPath: ["mcpServers"],
    serverKey: BRIDGE_SERVER_NAME,
    entry: {
      type: "http",
      url: endpoint.url,
      ...(endpoint.token ? { headers: { Authorization: `Bearer ${endpoint.token}` } } : {}),
    },
  };
  const claudeExisting = await readOrNull(claudePlan.configPath);
  await atomicWrite(claudePlan.configPath, applyJsonInstall(claudeExisting, claudePlan));
  written.push(".mcp.json");

  const tomlPath = join(repoPath, ".codex", "config.toml");
  const tomlExisting = await readOrNull(tomlPath);
  // required 必须为 false：Codex 对 required 服务器握手失败会直接拒绝开对话（与 install-planner 一致）
  const entries: Record<string, string> = {
    url: JSON.stringify(endpoint.url),
    required: "false",
    startup_timeout_sec: "10.0",
  };
  if (endpoint.token) {
    entries.http_headers = `{ Authorization = ${JSON.stringify(`Bearer ${endpoint.token}`)} }`;
  }
  await atomicWrite(tomlPath, upsertTomlTable(tomlExisting, `mcp_servers.${BRIDGE_SERVER_NAME}`, entries));
  written.push(".codex/config.toml");

  return written;
}

export function toLinkedRepo(
  checked: { path: string; git: boolean; mountDir: string },
  flags: Pick<LinkedRepo, "writeAgentFiles" | "writeMcpConfig">,
  sync?: { lastSyncedAt?: string; lastError?: string }
): LinkedRepo {
  return {
    path: checked.path,
    mountDir: checked.mountDir,
    writeAgentFiles: flags.writeAgentFiles !== false,
    writeMcpConfig: flags.writeMcpConfig !== false,
    git: checked.git,
    lastSyncedAt: sync?.lastSyncedAt,
    lastError: sync?.lastError,
  };
}

async function readManifest(path: string): Promise<RepoManifest | null> {
  try {
    const raw = await fs.readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<RepoManifest>;
    if (parsed.version !== 1 || !Array.isArray(parsed.files)) return null;
    return parsed as RepoManifest;
  } catch {
    return null;
  }
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function atomicWrite(full: string, content: string | Uint8Array): Promise<void> {
  await fs.mkdir(dirname(full), { recursive: true });
  const tmp = `${full}.tmp-vb`;
  if (typeof content === "string") await fs.writeFile(tmp, content, "utf8");
  else await fs.writeFile(tmp, content);
  try {
    await fs.rename(tmp, full);
  } catch {
    await fs.unlink(full).catch(() => undefined);
    await fs.rename(tmp, full);
  }
}

function emptyFail(link: LinkedRepo, error: string): RepoSyncResult {
  return {
    ok: false,
    path: link.path,
    mountDir: link.mountDir ?? DEFAULT_MOUNT_DIR,
    git: Boolean(link.git),
    written: 0,
    removed: 0,
    agentFiles: [],
    mcpFiles: [],
    warnings: [],
    error,
  };
}
