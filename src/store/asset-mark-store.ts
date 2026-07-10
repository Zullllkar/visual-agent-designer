"use client";

/**
 * 素材框选 Mark 状态（Lovart Touch Edit 式）
 * @author：wangjunhua
 */

import { create } from "zustand";

export interface MarkRegion {
  /** 相对图片内容区 0–1 */
  x: number;
  y: number;
  w: number;
  h: number;
}

interface AssetMarkState {
  mode: "idle" | "marking" | "instruct";
  projectId: string | null;
  assetId: string | null;
  region: MarkRegion | null;
  /** 拖拽中的临时矩形（归一化） */
  draft: MarkRegion | null;
  instruction: string;
  startMarking: (projectId: string, assetId: string) => void;
  setDraft: (region: MarkRegion | null) => void;
  commitRegion: (region: MarkRegion) => void;
  setInstruction: (text: string) => void;
  cancel: () => void;
  resetAfterSubmit: () => void;
}

const empty = {
  mode: "idle" as const,
  projectId: null,
  assetId: null,
  region: null,
  draft: null,
  instruction: "",
};

export const useAssetMarkStore = create<AssetMarkState>((set) => ({
  ...empty,
  startMarking: (projectId, assetId) =>
    set({
      mode: "marking",
      projectId,
      assetId,
      region: null,
      draft: null,
      instruction: "",
    }),
  setDraft: (draft) => set({ draft }),
  commitRegion: (region) =>
    set({
      region,
      draft: null,
      mode: "instruct",
    }),
  setInstruction: (instruction) => set({ instruction }),
  cancel: () => set({ ...empty }),
  resetAfterSubmit: () => set({ ...empty }),
}));

export function normalizeRegion(
  x0: number,
  y0: number,
  x1: number,
  y1: number
): MarkRegion {
  const left = Math.min(x0, x1);
  const top = Math.min(y0, y1);
  const right = Math.max(x0, x1);
  const bottom = Math.max(y0, y1);
  return {
    x: clamp01(left),
    y: clamp01(top),
    w: clamp01(right - left),
    h: clamp01(bottom - top),
  };
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

export function isValidMarkRegion(r: MarkRegion | null | undefined): boolean {
  return !!r && r.w >= 0.04 && r.h >= 0.04;
}
