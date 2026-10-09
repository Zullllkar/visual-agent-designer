/**
 * 当前异步调用链上的项目 id。生成记录只在这里有项目时落盘。
 */

import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage<{ projectId: string }>();

export function bindGenerationProject(projectId: string | undefined): void {
  if (!projectId) return;
  storage.enterWith({ projectId });
}

export function currentGenerationProjectId(): string | undefined {
  return storage.getStore()?.projectId;
}
