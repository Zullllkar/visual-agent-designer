/**
 * .vad 文件系统持久化层
 * --------------------------------------------------------------
 * 统一项目、画布快照、对话历史、页面 JSON 的落盘与读取。
 * IndexedDB 仍为浏览器主缓存；本模块负责与 .vad/ 双写。
 *
 * @author：wangjunhua
 */

import { promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ProjectFile } from "@/lib/project/schema";
import type { ChatMessage } from "@/lib/agents/chat-schema";
import {
  VAD_PROJECTS_DIR,
  canvasJsonPath,
  chatHistoryPath,
  projectDir,
  projectJsonPath,
  EDITABLE_EXTENSIONS,
  EDITABLE_PREFIXES,
} from "./paths";

import type { VadFileNode } from "./types";
export type { VadFileNode } from "./types";

export async function ensureDir(path: string): Promise<void> {
  await fs.mkdir(path, { recursive: true });
}

type AssetLike = { id: string; src: string };

/** 将 assets/references 中 base64 提炼为磁盘文件并改写 src。 */
export async function processBase64Assets<T extends AssetLike>(
  projectId: string,
  assets: T[] = [] as T[],
  subFolder: "assets" | "references" = "assets"
): Promise<T[]> {
  const processed: T[] = [];
  const dir = join(projectDir(projectId), subFolder);

  for (const asset of assets ?? []) {
    if (!asset?.src) {
      if (asset) processed.push(asset);
      continue;
    }
    const { id, src } = asset;
    if (src.startsWith("data:image/")) {
      await ensureDir(dir);
      const matches = src.match(/^data:image\/([a-zA-Z+]+);base64,(.+)$/);
      if (matches?.length === 3) {
        const ext = matches[1];
        const buffer = Buffer.from(matches[2], "base64");
        const filename = `${id}.${ext}`;
        await fs.writeFile(join(dir, filename), buffer);
        processed.push({
          ...asset,
          src: `/api/assets/${projectId}/${subFolder}/${filename}`,
        });
        continue;
      }
    }
    processed.push(asset);
  }
  return processed;
}

/**
 * 完整保存项目到 .vad/projects/<id>/。
 */
export async function saveProjectToVad(project: ProjectFile): Promise<ProjectFile> {
  const id = project.id;
  const dir = projectDir(id);
  await ensureDir(dir);

  const assets = await processBase64Assets(id, project.assets, "assets");
  const references = project.references
    ? await processBase64Assets(id, project.references, "references")
    : undefined;

  const updated: ProjectFile = {
    ...project,
    assets,
    references,
  };

  if (project.canvasSnapshot) {
    await fs.writeFile(
      canvasJsonPath(id),
      JSON.stringify(project.canvasSnapshot, null, 2),
      "utf8"
    );
  }

  const pagesDir = join(dir, "design", "pages");
  await ensureDir(pagesDir);
  for (const page of updated.pages) {
    const slug = page.id.replace(/[^a-zA-Z0-9-_]/g, "-");
    await fs.writeFile(
      join(pagesDir, `${slug}.canvas.json`),
      JSON.stringify(page, null, 2),
      "utf8"
    );
  }

  if (updated.critique) {
    const promptsDir = join(dir, "prompts");
    await ensureDir(promptsDir);
    let report = `# Visual Audit Report\n\n**Overall:** ${updated.critique.overallScore}/10\n\n`;
    for (const r of updated.critique.reports) {
      report += `## ${r.pageId} (${r.score}/10)\n> ${r.summary}\n\n`;
      for (const issue of r.issues) {
        report += `- [${issue.severity}] ${issue.message}\n`;
      }
      report += "\n";
    }
    await fs.writeFile(join(promptsDir, "critique-report.md"), report, "utf8");
  }

  await fs.writeFile(projectJsonPath(id), JSON.stringify(updated, null, 2), "utf8");
  return updated;
}

export async function loadProjectFromVad(
  projectId: string
): Promise<ProjectFile | null> {
  try {
    const raw = await fs.readFile(projectJsonPath(projectId), "utf8");
    return JSON.parse(raw) as ProjectFile;
  } catch {
    return null;
  }
}

export async function listProjectsFromVad(): Promise<ProjectFile[]> {
  await ensureDir(VAD_PROJECTS_DIR);
  const dirs = await fs.readdir(VAD_PROJECTS_DIR);
  const projects: ProjectFile[] = [];
  for (const dir of dirs) {
    const p = await loadProjectFromVad(dir);
    if (p) projects.push(p);
  }
  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** 追加/覆盖 chat-history.jsonl（每行一条 JSON ChatMessage）。 */
export async function saveChatHistoryToVad(
  projectId: string,
  messages: ChatMessage[]
): Promise<void> {
  await ensureDir(projectDir(projectId));
  const lines = messages.map((m) => JSON.stringify(m)).join("\n");
  await fs.writeFile(chatHistoryPath(projectId), lines + (lines ? "\n" : ""), "utf8");
}

export async function loadChatHistoryFromVad(
  projectId: string
): Promise<ChatMessage[]> {
  try {
    const raw = await fs.readFile(chatHistoryPath(projectId), "utf8");
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l) as ChatMessage);
  } catch {
    return [];
  }
}

async function statNode(
  baseDir: string,
  relPath: string,
  name: string
): Promise<VadFileNode> {
  const full = join(baseDir, relPath);
  const st = await fs.stat(full);
  if (st.isDirectory()) {
    const entries = await fs.readdir(full);
    const children: VadFileNode[] = [];
    for (const entry of entries.sort()) {
      children.push(
        await statNode(baseDir, join(relPath, entry), entry)
      );
    }
    return { path: relPath.replace(/\\/g, "/"), name, kind: "directory", children };
  }
  return {
    path: relPath.replace(/\\/g, "/"),
    name,
    kind: "file",
    size: st.size,
  };
}

/** 列出项目目录下的 artifact 文件树（相对路径）。 */
export async function listProjectFileTree(
  projectId: string
): Promise<VadFileNode[]> {
  const base = projectDir(projectId);
  try {
    await fs.access(base);
  } catch {
    return [];
  }

  const top = await fs.readdir(base);
  const roots: VadFileNode[] = [];
  for (const name of top.sort()) {
    roots.push(await statNode(base, name, name));
  }
  return roots;
}

function assertSafeRelativePath(relPath: string): void {
  const normalized = relPath.replace(/\\/g, "/");
  if (normalized.includes("..") || normalized.startsWith("/")) {
    throw new Error("invalid_path");
  }
}

function assertEditable(relPath: string): void {
  const normalized = relPath.replace(/\\/g, "/");
  const allowedPrefix = EDITABLE_PREFIXES.some((p) => normalized.startsWith(p));
  const allowedRoot =
    normalized === "project.json" || normalized === "canvas.json";
  const ext = normalized.slice(normalized.lastIndexOf("."));
  const allowedExt = EDITABLE_EXTENSIONS.some((e) => normalized.endsWith(e));
  if (!allowedPrefix && !allowedRoot && !allowedExt) {
    throw new Error("path_not_editable");
  }
}

export async function readProjectFile(
  projectId: string,
  relPath: string
): Promise<string> {
  assertSafeRelativePath(relPath);
  const full = resolve(projectDir(projectId), relPath);
  const base = resolve(projectDir(projectId));
  if (!full.startsWith(base)) throw new Error("invalid_path");
  return fs.readFile(full, "utf8");
}

export async function writeProjectFile(
  projectId: string,
  relPath: string,
  content: string
): Promise<void> {
  assertSafeRelativePath(relPath);
  assertEditable(relPath);
  const full = resolve(projectDir(projectId), relPath);
  const base = resolve(projectDir(projectId));
  if (!full.startsWith(base)) throw new Error("invalid_path");
  await ensureDir(dirname(full));
  await fs.writeFile(full, content, "utf8");
}
