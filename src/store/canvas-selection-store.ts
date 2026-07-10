"use client";

/**
 * Canvas Selection Store (B6 Comment Mode 共享状态)
 * --------------------------------------------------------------
 * tldraw 画布选中的 shape ↔ ChatPane 引用 tag 的桥梁。
 *
 * 选中规则：
 *   - 在 tldraw 上选中一个 canvas-page shape 时 → 这里写入页面引用
 *   - 选择多个 shape 或取消选择 → 清空
 *
 * ChatPane 读取这里的状态，在输入框上方展示一个可关闭的引用 tag，
 * 发送时把 `[引用页面: <name>]` 前缀拼到 message 内容里。
 *
 * 不持久化（每次刷新画布选中状态就丢了，符合直觉）。
 */

import { create } from "zustand";

export interface CanvasSelection {
  /** 选中所属的 projectId（避免跨项目串扰） */
  projectId: string;
  /** 引用类型：结构稿页面 vs 画布生图卡片 */
  kind: "page" | "asset";
  /** 业务层 pageId（asset 选中时可为关联页或空） */
  pageId: string;
  /** 展示名：页面名或 prompt 摘要 */
  pageName: string;
  /** 选中 image-asset 时的资产 id */
  assetId?: string;
  nodeId?: string;
  nodeLabel?: string;
}

interface CanvasSelectionState {
  selection: CanvasSelection | null;
  set(s: CanvasSelection | null): void;
  clear(): void;
}

export const useCanvasSelectionStore = create<CanvasSelectionState>((set) => ({
  selection: null,
  set: (s) => set({ selection: s }),
  clear: () => set({ selection: null }),
}));
