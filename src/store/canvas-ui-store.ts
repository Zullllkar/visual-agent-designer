"use client";

/**
 * 画布 UI 联动 store
 * --------------------------------------------------------------
 * 画布 shape（如交付卡）需要触发 IDE 壳层的 UI（Handoff 弹窗）。
 * 聊天缩略图点击后通过 requestFocusAsset 驱动画布 zoom。
 *
 * @author：wangjunhua
 */

import { create } from "zustand";

export type CanvasFocusKind = "asset" | "page";

interface CanvasUiState {
  handoffRequestToken: number;
  requestHandoff: () => void;
  focusToken: number;
  focusTarget: { kind: CanvasFocusKind; id: string } | null;
  requestFocusAsset: (assetId: string) => void;
  requestFocusPage: (pageId: string) => void;
}

export const useCanvasUiStore = create<CanvasUiState>((set) => ({
  handoffRequestToken: 0,
  requestHandoff: () =>
    set((s) => ({ handoffRequestToken: s.handoffRequestToken + 1 })),
  focusToken: 0,
  focusTarget: null,
  requestFocusAsset: (assetId) =>
    set((s) => ({
      focusToken: s.focusToken + 1,
      focusTarget: { kind: "asset", id: assetId },
    })),
  requestFocusPage: (pageId) =>
    set((s) => ({
      focusToken: s.focusToken + 1,
      focusTarget: { kind: "page", id: pageId },
    })),
}));
