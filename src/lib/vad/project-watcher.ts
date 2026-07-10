/**
 * .vad 项目目录文件监听
 * --------------------------------------------------------------
 * 监听 .vad/projects/ 下关键 artifact 变更，供 Daemon SSE 与 Next 内联模式共用。
 *
 * @author：wangjunhua
 */

import { mkdirSync, watch, type FSWatcher } from "node:fs";
import { EventEmitter } from "node:events";
import { VAD_PROJECTS_DIR } from "./paths";
import type { VadWatchEvent, VadWatchKind } from "./watch-types";

const DEBOUNCE_MS = 350;

/** 将监听到的相对路径分类为事件类型 */
export function classifyVadRelPath(relPath: string): VadWatchKind | null {
  const p = relPath.replace(/\\/g, "/");
  if (p === "project.json") return "project";
  if (p === "canvas.json") return "canvas";
  if (p === "chat-history.jsonl") return "chat";
  if (p.startsWith("design/pages/") && p.endsWith(".canvas.json")) return "page";
  if (
    p.startsWith("prompts/") ||
    p.startsWith("handoff/") ||
    p.startsWith("design/") ||
    p.startsWith("html-artifact/") ||
    p.startsWith("assets/") ||
    p.startsWith("references/")
  ) {
    return "artifact";
  }
  return null;
}

function parseProjectsRelPath(
  filename: string | null | undefined
): { projectId: string; relPath: string } | null {
  if (!filename) return null;
  const norm = filename.replace(/\\/g, "/");
  const parts = norm.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const [projectId, ...rest] = parts;
  if (!projectId) return null;
  return { projectId, relPath: rest.join("/") };
}

class VadProjectWatcher {
  private bus = new EventEmitter();
  private rootWatcher: FSWatcher | null = null;
  private debounce = new Map<string, ReturnType<typeof setTimeout>>();
  private started = false;

  /** 启动对 .vad/projects 的全局递归监听（幂等） */
  start(): void {
    if (this.started) return;
    this.started = true;
    try {
      mkdirSync(VAD_PROJECTS_DIR, { recursive: true });
      this.rootWatcher = watch(
        VAD_PROJECTS_DIR,
        { recursive: true },
        (_eventType, filename) => {
          const parsed = parseProjectsRelPath(filename);
          if (!parsed) return;
          const kind = classifyVadRelPath(parsed.relPath);
          if (!kind) return;
          this.scheduleEmit(parsed.projectId, kind, parsed.relPath);
        }
      );
      this.rootWatcher.on("error", (err) => {
        console.warn("[vad-watcher] root watch error:", err);
      });
    } catch (e) {
      console.warn("[vad-watcher] failed to start:", e);
    }
  }

  private scheduleEmit(
    projectId: string,
    kind: VadWatchKind,
    relPath: string
  ): void {
    const key = `${projectId}:${relPath}`;
    const prev = this.debounce.get(key);
    if (prev) clearTimeout(prev);
    this.debounce.set(
      key,
      setTimeout(() => {
        this.debounce.delete(key);
        const ev: VadWatchEvent = {
          projectId,
          kind,
          relPath,
          at: new Date().toISOString(),
        };
        this.bus.emit("change", ev);
        this.bus.emit(`change:${projectId}`, ev);
      }, DEBOUNCE_MS)
    );
  }

  subscribe(
    projectId: string,
    handler: (ev: VadWatchEvent) => void
  ): () => void {
    this.start();
    const channel = `change:${projectId}`;
    this.bus.on(channel, handler);
    return () => this.bus.off(channel, handler);
  }

  subscribeAll(handler: (ev: VadWatchEvent) => void): () => void {
    this.start();
    this.bus.on("change", handler);
    return () => this.bus.off("change", handler);
  }
}

/** 进程内单例 */
export const vadProjectWatcher = new VadProjectWatcher();

/** 格式化为 SSE data 行 */
export function formatWatchSse(ev: VadWatchEvent): string {
  return `data: ${JSON.stringify(ev)}\n\n`;
}
