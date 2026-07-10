"use client";

/**
 * 画布排版重置信号
 * --------------------------------------------------------------
 * IDE 工具栏触发后，TldrawCanvas 监听并强制套用 Lovart 网格布局。
 *
 * @author：wangjunhua
 */

import { create } from "zustand";

interface CanvasBoardState {
  /** 递增令牌，避免重复点击无效 */
  resetToken: number;
  /** 待重置的项目 id */
  resetProjectId: string | null;
  requestResetLayout: (projectId: string) => void;
}

export const useCanvasBoardStore = create<CanvasBoardState>((set) => ({
  resetToken: 0,
  resetProjectId: null,
  requestResetLayout: (projectId) =>
    set({
      resetToken: Date.now(),
      resetProjectId: projectId,
    }),
}));
