/**
 * 首页「一键生成」→ 立即进入 IDE 后再启动流水线的任务队列
 * --------------------------------------------------------------
 * @author：wangjunhua
 */

import { create } from "zustand";
import type { ProviderConfig } from "@/lib/providers/registry";

export type HomeGenerateJob = {
  projectId: string;
  idea: string;
  providerConfig: ProviderConfig;
};

type HomeGenerateState = {
  job: HomeGenerateJob | null;
  setJob: (job: HomeGenerateJob) => void;
  /** 进入对应项目工作台时消费一次，避免重复启动 */
  consumeJob: (projectId: string) => HomeGenerateJob | null;
};

export const useHomeGenerateStore = create<HomeGenerateState>((set, get) => ({
  job: null,
  setJob: (job) => set({ job }),
  consumeJob: (projectId) => {
    const { job } = get();
    if (!job || job.projectId !== projectId) return null;
    set({ job: null });
    return job;
  },
}));
