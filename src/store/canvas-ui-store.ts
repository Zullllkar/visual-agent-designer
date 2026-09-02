"use client";

/**
 * 画布 UI 联动 store
 * --------------------------------------------------------------
 * 画布 shape（如交付卡）需要触发 IDE 壳层的 UI（Handoff 弹窗）。
 * 聊天缩略图点击后通过 requestFocusAsset 驱动画布 zoom。
 * 作品板「设为参考」通过 offerComposerRef 推入 Composer chips。
 *
 * @author：wangjunhua
 */

import { create } from "zustand";
import type { ReferenceAsset } from "@/lib/project/assets-schema";

export type CanvasFocusKind = "asset" | "page";

interface CanvasUiState {
  handoffRequestToken: number;
  requestHandoff: () => void;
  focusToken: number;
  focusTarget: { kind: CanvasFocusKind; id: string } | null;
  requestFocusAsset: (assetId: string) => void;
  requestFocusPage: (pageId: string) => void;
  /** 空态 CTA：请求聚焦右侧 Composer */
  composerFocusToken: number;
  requestComposerFocus: () => void;
  /** 画布 → Composer 参考图 */
  composerRefToken: number;
  composerRefOffer: ReferenceAsset | null;
  offerComposerRef: (ref: ReferenceAsset) => void;
  clearComposerRefOffer: () => void;
  /** 画布点阵网格 */
  showCanvasGrid: boolean;
  toggleCanvasGrid: () => void;
  /** 右上角小地图 */
  showCanvasMinimap: boolean;
  toggleCanvasMinimap: () => void;
  /** Agent 本轮执行中（供空占位卡显示 loading） */
  agentRunBusy: boolean;
  setAgentRunBusy: (busy: boolean) => void;
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
  composerFocusToken: 0,
  requestComposerFocus: () =>
    set((s) => ({ composerFocusToken: s.composerFocusToken + 1 })),
  composerRefToken: 0,
  composerRefOffer: null,
  offerComposerRef: (ref) =>
    set((s) => ({
      composerRefToken: s.composerRefToken + 1,
      composerRefOffer: ref,
      // 与 offer 同一次更新里聚焦，避免两次 store 通知引发重复消费
      composerFocusToken: s.composerFocusToken + 1,
    })),
  clearComposerRefOffer: () => set({ composerRefOffer: null }),
  showCanvasGrid: true,
  toggleCanvasGrid: () =>
    set((s) => ({ showCanvasGrid: !s.showCanvasGrid })),
  showCanvasMinimap: true,
  toggleCanvasMinimap: () =>
    set((s) => ({ showCanvasMinimap: !s.showCanvasMinimap })),
  agentRunBusy: false,
  setAgentRunBusy: (busy) => set({ agentRunBusy: busy }),
}));
