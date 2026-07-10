/**
 * Artifact 文件编辑 → 内存项目合并
 * --------------------------------------------------------------
 * 用户在 Artifact 面板保存 project.json / canvas.json / design/pages/*.canvas.json
 * 后，将变更合并进 ProjectFile 并写回 project.json，供前端 store 热更新。
 *
 * @author：wangjunhua
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import {
  ProjectFileSchema,
  CanvasSnapshotSchema,
  type ProjectFile,
} from "@/lib/project/schema";
import { CanvasPageSchema } from "@/lib/canvas/schema";
import { loadProjectFromVad, saveProjectToVad } from "./persist";
import { projectDir } from "./paths";

export type ApplyFileEditResult =
  | { synced: true; project: ProjectFile }
  | { synced: false; reason: "no_project" | "unchanged" | "parse_error"; message?: string };

/**
 * 将单文件编辑合并到项目；若影响 project 结构则落盘 project.json。
 */
export async function applyFileEditToProject(
  projectId: string,
  relPath: string,
  content: string
): Promise<ApplyFileEditResult> {
  const normalized = relPath.replace(/\\/g, "/");

  if (normalized === "project.json") {
    try {
      const parsed = ProjectFileSchema.parse(JSON.parse(content));
      if (parsed.id !== projectId) {
        return {
          synced: false,
          reason: "parse_error",
          message: "project.json id 与当前项目不一致",
        };
      }
      const saved = await saveProjectToVad({
        ...parsed,
        updatedAt: new Date().toISOString(),
      });
      return { synced: true, project: saved };
    } catch (e) {
      return {
        synced: false,
        reason: "parse_error",
        message: (e as Error).message,
      };
    }
  }

  const base = await loadProjectFromVad(projectId);
  if (!base) {
    return { synced: false, reason: "no_project" };
  }

  let project = base;
  let changed = false;

  if (normalized === "canvas.json") {
    try {
      const snap = CanvasSnapshotSchema.parse(JSON.parse(content));
      project = {
        ...project,
        canvasSnapshot: snap,
        updatedAt: new Date().toISOString(),
      };
      changed = true;
    } catch (e) {
      return {
        synced: false,
        reason: "parse_error",
        message: (e as Error).message,
      };
    }
  } else if (
    normalized.startsWith("design/pages/") &&
    normalized.endsWith(".canvas.json")
  ) {
    try {
      const page = CanvasPageSchema.parse(JSON.parse(content));
      const pages = [...project.pages];
      const idx = pages.findIndex((p) => p.id === page.id);
      if (idx >= 0) {
        pages[idx] = page;
      } else {
        pages.push(page);
      }
      project = {
        ...project,
        pages,
        updatedAt: new Date().toISOString(),
      };
      changed = true;
    } catch (e) {
      return {
        synced: false,
        reason: "parse_error",
        message: (e as Error).message,
      };
    }
  } else {
    // prompts/handoff 等纯文本 artifact 不映射到 project store
    return { synced: false, reason: "unchanged" };
  }

  if (!changed) {
    return { synced: false, reason: "unchanged" };
  }

  const saved = await saveProjectToVad(project);
  return { synced: true, project: saved };
}

/** 从磁盘读取完整项目（含 canvas.json 若 project.json 未内嵌快照）。 */
export async function loadMergedProjectFromVad(
  projectId: string
): Promise<ProjectFile | null> {
  const project = await loadProjectFromVad(projectId);
  if (!project) return null;

  try {
    const raw = await fs.readFile(
      join(projectDir(projectId), "canvas.json"),
      "utf8"
    );
    const snap = CanvasSnapshotSchema.parse(JSON.parse(raw));
    if (!project.canvasSnapshot) {
      return { ...project, canvasSnapshot: snap };
    }
  } catch {
    /* canvas.json 可选 */
  }

  return project;
}
