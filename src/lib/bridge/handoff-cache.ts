/**
 * Handoff 产物缓存
 * --------------------------------------------------------------
 * Bridge 工具需要"当前项目"的交付包内容。磁盘上的 handoff/ 目录只在
 * 客户端保存时同步，Agent 工具写盘不会触发，可能过期；这里按需在内存
 * 中构建，并以 updatedAt + 资产签名做缓存键，保证实时且不重复计算。
 */

import { createHash } from "node:crypto";
import { createHandoffTarget } from "@/lib/handoff/markdown-target";
import { resolveHandoffPackKind } from "@/lib/handoff/pack-kind";
import {
  defaultSelectedAssetIds,
  defaultSelectedReferenceIds,
  projectWithSelectedAssets,
} from "@/lib/handoff/select-assets";
import type { HandoffArtifact, HandoffTarget } from "@/lib/handoff/types";
import type { ProjectFile } from "@/lib/project/schema";

export interface HandoffFileEntry {
  path: string;
  bytes: number;
  mime: string;
  isText: boolean;
}

export interface BuiltHandoff {
  key: string;
  builtAt: number;
  target: HandoffTarget["name"];
  packKind: ReturnType<typeof resolveHandoffPackKind>;
  files: Map<string, string | Uint8Array>;
  index: HandoffFileEntry[];
}

const cache = new Map<string, BuiltHandoff>();
const MAX_CACHE_ENTRIES = 8;

let requestOriginForBuild = "";

/** 由 attachBridge 注入，供交付包构建时解析 /api/assets/... 的相对图片地址。 */
export function setHandoffBuildOrigin(origin: string): void {
  requestOriginForBuild = origin;
}

function signature(project: ProjectFile, target: string): string {
  const hash = createHash("sha1");
  hash.update(project.id);
  hash.update(project.updatedAt);
  hash.update(target);
  for (const a of project.assets ?? []) {
    hash.update(`${a.id}:${a.status ?? ""}:${a.src?.length ?? 0}:${a.designSpec ? 1 : 0}`);
  }
  for (const id of Object.keys(project.materializations ?? {})) hash.update(`m:${id}`);
  for (const r of project.references ?? []) hash.update(`r:${r.id}`);
  return hash.digest("hex").slice(0, 16);
}

export async function getBuiltHandoff(
  project: ProjectFile,
  target: HandoffTarget["name"] = "markdown"
): Promise<BuiltHandoff> {
  const key = `${project.id}:${signature(project, target)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const exportProject = projectWithSelectedAssets(
    project,
    defaultSelectedAssetIds(project),
    defaultSelectedReferenceIds(project)
  );
  const artifact: HandoffArtifact = await createHandoffTarget(target).build({
    project: exportProject,
    requestOrigin: requestOriginForBuild || undefined,
    screenshots: [],
    aiReferenceImages: [],
  });

  const files = new Map<string, string | Uint8Array>();
  const index: HandoffFileEntry[] = [];
  for (const file of artifact.files) {
    files.set(file.path, file.content);
    const isText = typeof file.content === "string";
    index.push({
      path: file.path,
      bytes: isText
        ? Buffer.byteLength(file.content as string, "utf8")
        : (file.content as Uint8Array).byteLength,
      mime: mimeForPath(file.path, isText),
      isText,
    });
  }
  index.sort((a, b) => a.path.localeCompare(b.path));

  const built: BuiltHandoff = {
    key,
    builtAt: Date.now(),
    target,
    packKind: resolveHandoffPackKind(project),
    files,
    index,
  };

  // 同一项目只保留最新一份，避免旧签名堆积
  for (const [k] of cache) {
    if (k.startsWith(`${project.id}:`)) cache.delete(k);
  }
  cache.set(key, built);
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].builtAt - b[1].builtAt)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  return built;
}

export function invalidateHandoffCache(projectId?: string): void {
  if (!projectId) {
    cache.clear();
    return;
  }
  for (const [k] of cache) {
    if (k.startsWith(`${projectId}:`)) cache.delete(k);
  }
}

export function mimeForPath(path: string, isText: boolean): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "md":
      return "text/markdown";
    case "json":
      return "application/json";
    case "svg":
      return "image/svg+xml";
    case "html":
      return "text/html";
    case "css":
      return "text/css";
    case "txt":
    case "cursorrules":
    case "mdc":
      return "text/plain";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return isText ? "text/plain" : "application/octet-stream";
  }
}

/** 文档类文件优先级：get_handoff 的 auto 模式按这个顺序内联正文。 */
export const HANDOFF_PRIMARY_DOCS = [
  "README.md",
  "DESIGN.md",
  "SPEC.md",
  "LAYOUT.md",
  "MATERIAL_MAP.md",
  "IMPLEMENTATION.md",
  "ASSET_MAP.md",
  "ART_BIBLE.md",
  "COPY.md",
  "STYLE_NOTES.md",
  "design/tokens.json",
] as const;
