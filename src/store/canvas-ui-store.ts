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
import {
  type CanvasGridStyle,
  isCanvasGridVisible,
  persistCanvasGridStyle,
  readStoredCanvasGridStyle,
} from "@/lib/canvas/grid-style";

export type CanvasFocusKind = "asset" | "page" | "note";

export interface CiteMenuState {
  projectId: string;
  assetId: string;
  fromClientX: number;
  fromClientY: number;
  toClientX?: number;
  toClientY?: number;
  parentBox?: { x: number; y: number; w: number; h: number };
  dropAt?: { x: number; y: number };
}

let lastVisibleGridStyle: Exclude<CanvasGridStyle, "none"> = "dots";

interface CanvasUiState {
  handoffRequestToken: number;
  requestHandoff: () => void;
  focusToken: number;
  focusTarget: { kind: CanvasFocusKind; id: string } | null;
  requestFocusAsset: (assetId: string) => void;
  requestFocusPage: (pageId: string) => void;
  requestFocusNote: (noteId: string) => void;
  composerFocusToken: number;
  requestComposerFocus: () => void;
  composerRefToken: number;
  composerRefOffer: ReferenceAsset | null;
  offerComposerRef: (ref: ReferenceAsset) => void;
  clearComposerRefOffer: () => void;
  composerDraftToken: number;
  composerDraftOffer: string | null;
  offerComposerDraft: (text: string) => void;
  clearComposerDraftOffer: () => void;
  citeMenu: CiteMenuState | null;
  openCiteMenu: (menu: CiteMenuState) => void;
  closeCiteMenu: () => void;
  spawnPoint: { x: number; y: number } | null;
  offerSpawnPoint: (point: { x: number; y: number }) => void;
  takeSpawnPoint: () => { x: number; y: number } | null;
  canvasGridStyle: CanvasGridStyle;
  setCanvasGridStyle: (style: CanvasGridStyle) => void;
  toggleCanvasGrid: () => void;
  appearanceMenuOpen: boolean;
  setAppearanceMenuOpen: (open: boolean) => void;
  showCanvasMinimap: boolean;
  toggleCanvasMinimap: () => void;
  agentRunBusy: boolean;
  setAgentRunBusy: (busy: boolean) => void;
  imageJobBusy: boolean;
  setImageJobBusy: (busy: boolean) => void;
}

export const useCanvasUiStore = create<CanvasUiState>((set, get) => ({
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
  requestFocusNote: (noteId) =>
    set((s) => ({
      focusToken: s.focusToken + 1,
      focusTarget: { kind: "note", id: noteId },
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
      composerFocusToken: s.composerFocusToken + 1,
    })),
  clearComposerRefOffer: () => set({ composerRefOffer: null }),
  composerDraftToken: 0,
  composerDraftOffer: null,
  offerComposerDraft: (text) =>
    set((s) => ({
      composerDraftToken: s.composerDraftToken + 1,
      composerDraftOffer: text,
      composerFocusToken: s.composerFocusToken + 1,
    })),
  clearComposerDraftOffer: () => set({ composerDraftOffer: null }),
  citeMenu: null,
  openCiteMenu: (menu) => set({ citeMenu: menu }),
  closeCiteMenu: () => set({ citeMenu: null }),
  spawnPoint: null,
  offerSpawnPoint: (point) => set({ spawnPoint: point }),
  takeSpawnPoint: () => {
    const point = get().spawnPoint;
    if (point) set({ spawnPoint: null });
    return point;
  },
  canvasGridStyle: "dots",
  setCanvasGridStyle: (style) => {
    persistCanvasGridStyle(style);
    if (style !== "none") lastVisibleGridStyle = style;
    set({ canvasGridStyle: style });
  },
  appearanceMenuOpen: false,
  setAppearanceMenuOpen: (open) => set({ appearanceMenuOpen: open }),
  toggleCanvasGrid: () =>
    set((s) => {
      const next: CanvasGridStyle = isCanvasGridVisible(s.canvasGridStyle)
        ? "none"
        : lastVisibleGridStyle;
      persistCanvasGridStyle(next);
      return { canvasGridStyle: next };
    }),
  showCanvasMinimap: true,
  toggleCanvasMinimap: () =>
    set((s) => ({ showCanvasMinimap: !s.showCanvasMinimap })),
  agentRunBusy: false,
  setAgentRunBusy: (busy) => set({ agentRunBusy: busy }),
  imageJobBusy: false,
  setImageJobBusy: (busy) => set({ imageJobBusy: busy }),
}));

export function hydrateCanvasGridStyle(): void {
  const stored = readStoredCanvasGridStyle();
  if (stored !== "none") lastVisibleGridStyle = stored;
  if (useCanvasUiStore.getState().canvasGridStyle !== stored) {
    useCanvasUiStore.setState({ canvasGridStyle: stored });
  }
}
