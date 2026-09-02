/**
 * File-based Store
 * --------------------------------------------------------------
 * LangGraph BaseStore 的文件系统实现。
 * 用于 Agent 长期记忆：跨会话保存和检索键值数据。
 * 数据存储在 .vad/projects/<projectId>/store/ 目录。
 */

import { promises as fs } from "node:fs";
import { resolve, join } from "node:path";
import { projectDir } from "@/lib/vad/paths";
import { ensureDir } from "@/lib/vad/persist";

interface StoreEntry {
  value: unknown;
  createdAt: string;
  updatedAt: string;
}

class FileStore {
  private cache = new Map<string, Map<string, StoreEntry>>();
  private loaded = new Set<string>();

  private storeDir(projectId: string): string {
    return resolve(projectDir(projectId), "store");
  }

  private namespaceDir(projectId: string, namespace: string): string {
    return join(this.storeDir(projectId), namespace);
  }

  private filePath(projectId: string, namespace: string, key: string): string {
    return join(this.namespaceDir(projectId, namespace), `${key}.json`);
  }

  async ensureLoaded(projectId: string): Promise<void> {
    if (this.loaded.has(projectId)) return;
    const dir = this.storeDir(projectId);
    try {
      await ensureDir(dir);
      const namespaces = await fs.readdir(dir);
      for (const ns of namespaces) {
        const nsDir = join(dir, ns);
        const stat = await fs.stat(nsDir);
        if (!stat.isDirectory()) continue;
        if (!this.cache.has(ns)) this.cache.set(ns, new Map());
        const files = await fs.readdir(nsDir);
        for (const file of files) {
          if (!file.endsWith(".json")) continue;
          const key = file.replace(/\.json$/, "");
          const content = await fs.readFile(join(nsDir, file), "utf-8");
          try {
            const entry = JSON.parse(content) as StoreEntry;
            this.cache.get(ns)!.set(key, entry);
          } catch {
            // 跳过损坏的文件
          }
        }
      }
    } catch {
      // 目录不存在，忽略
    }
    this.loaded.add(projectId);
  }

  async get(projectId: string, namespace: string, key: string): Promise<unknown | undefined> {
    await this.ensureLoaded(projectId);
    return this.cache.get(namespace)?.get(key)?.value;
  }

  async set(projectId: string, namespace: string, key: string, value: unknown): Promise<void> {
    await this.ensureLoaded(projectId);
    const now = new Date().toISOString();
    let ns = this.cache.get(namespace);
    if (!ns) {
      ns = new Map();
      this.cache.set(namespace, ns);
    }
    const existing = ns.get(key);
    const entry: StoreEntry = {
      value,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    ns.set(key, entry);

    // 持久化到文件
    const dir = this.namespaceDir(projectId, namespace);
    await ensureDir(dir);
    await fs.writeFile(this.filePath(projectId, namespace, key), JSON.stringify(entry, null, 2));
  }

  async delete(projectId: string, namespace: string, key: string): Promise<void> {
    await this.ensureLoaded(projectId);
    this.cache.get(namespace)?.delete(key);
    try {
      await fs.unlink(this.filePath(projectId, namespace, key));
    } catch {
      // 文件不存在，忽略
    }
  }

  async list(projectId: string, namespace: string): Promise<string[]> {
    await this.ensureLoaded(projectId);
    return Array.from(this.cache.get(namespace)?.keys() ?? []);
  }

  async search(
    projectId: string,
    namespace: string,
    prefix: string
  ): Promise<Array<{ key: string; value: unknown }>> {
    await this.ensureLoaded(projectId);
    const ns = this.cache.get(namespace);
    if (!ns) return [];
    const results: Array<{ key: string; value: unknown }> = [];
    for (const [key, entry] of ns) {
      if (key.startsWith(prefix)) {
        results.push({ key, value: entry.value });
      }
    }
    return results;
  }

  /** 清除项目的内存缓存（不影响磁盘文件） */
  evict(projectId: string): void {
    this.loaded.delete(projectId);
    this.cache.clear();
  }
}

export const fileStore = new FileStore();
