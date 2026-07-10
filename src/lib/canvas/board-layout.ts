/**
 * 画布 Lovart 式排版
 * --------------------------------------------------------------
 * 将「生图候选 / 参考图」作为画布主视觉层（中心网格）。
 * 不再排版网页结构稿缩略图。
 *
 * @author：wangjunhua
 */

import type { ProjectFile } from "@/lib/project/schema";
import type { ImageAsset, ReferenceAsset } from "@/lib/project/assets-schema";
import type { CanvasPage } from "@/lib/canvas/schema";

/** 主视觉区：生图卡片列数 */
export const BOARD_ASSET_COLS = 3;
export const BOARD_GAP = 32;
export const BOARD_ORIGIN_X = 0;
export const BOARD_ORIGIN_Y = 0;

/** 结构稿缩略图最大宽（与 canvas-page-shape 一致） */
export const PAGE_THUMB_MAX_W = 280;

export interface DisplaySize {
  w: number;
  h: number;
}

export interface PlacedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 生图在画布上的展示尺寸（与 image-asset-shape 一致） */
export function displaySizeForImageAsset(
  width: number,
  height: number,
  max = 268
): DisplaySize {
  const aspect = width / Math.max(1, height);
  let dw = Math.min(max, width);
  let dh = dw / aspect;
  if (dh > max) {
    dh = max;
    dw = dh * aspect;
  }
  return { w: Math.round(dw), h: Math.round(dh) };
}

/** 页面结构稿缩略尺寸 */
export function displaySizeForPageThumb(page: CanvasPage): DisplaySize {
  const scale = Math.min(1, PAGE_THUMB_MAX_W / Math.max(1, page.width));
  return {
    w: Math.round(page.width * scale),
    h: Math.round(page.height * scale),
  };
}

function layoutGrid(
  items: DisplaySize[],
  cols: number,
  originX: number,
  originY: number,
  gap: number
): PlacedRect[] {
  const placed: PlacedRect[] = [];
  let x = originX;
  let y = originY;
  let rowMaxH = 0;
  let col = 0;

  for (const item of items) {
    if (col >= cols) {
      col = 0;
      y += rowMaxH + gap;
      x = originX;
      rowMaxH = 0;
    }
    placed.push({ x, y, w: item.w, h: item.h });
    x += item.w + gap;
    rowMaxH = Math.max(rowMaxH, item.h);
    col++;
  }
  return placed;
}

function referenceDisplaySizes(references: ReferenceAsset[]): DisplaySize[] {
  return references.map((r) => {
    const max = 200;
    const aspect = r.width / Math.max(1, r.height);
    let w = Math.min(max, r.width);
    let h = w / aspect;
    if (h > max) {
      h = max;
      w = h * aspect;
    }
    return { w: Math.round(w), h: Math.round(h) };
  });
}

/** 参考图横排 */
export function layoutReferences(
  references: ReferenceAsset[],
  originX: number,
  originY: number
): PlacedRect[] {
  if (references.length === 0) return [];
  const sizes = referenceDisplaySizes(references);
  return layoutGrid(
    sizes,
    Math.min(4, references.length),
    originX,
    originY,
    16
  );
}

/** 生图主网格 */
export function layoutImageAssets(
  assets: ImageAsset[],
  originX = BOARD_ORIGIN_X,
  originY = BOARD_ORIGIN_Y
): PlacedRect[] {
  const sizes = assets.map((a) =>
    displaySizeForImageAsset(a.width, a.height)
  );
  return layoutGrid(sizes, BOARD_ASSET_COLS, originX, originY, BOARD_GAP);
}

/** 结构稿缩略图横排（主网格下方） */
export function layoutStructurePages(
  pages: CanvasPage[],
  belowY: number,
  originX = BOARD_ORIGIN_X
): PlacedRect[] {
  const sizes = pages.map((p) => displaySizeForPageThumb(p));
  let x = originX;
  const placed: PlacedRect[] = [];
  for (let i = 0; i < pages.length; i++) {
    const s = sizes[i];
    placed.push({ x, y: belowY, w: s.w, h: s.h });
    x += s.w + BOARD_GAP;
  }
  return placed;
}

function bottomOf(rects: PlacedRect[], fallback: number): number {
  if (rects.length === 0) return fallback;
  return Math.max(...rects.map((r) => r.y + r.h));
}

export interface BoardLayoutResult {
  assets: PlacedRect[];
  references: PlacedRect[];
  pages: PlacedRect[];
}

/** 根据项目数据计算各层初始位置（仅用于新建 shape） */
export function computeBoardLayout(project: ProjectFile): BoardLayoutResult {
  const assets = (project.assets ?? []).filter((a) => a.status !== "discarded");
  const references = project.references ?? [];

  let y = BOARD_ORIGIN_Y;
  const refRects = layoutReferences(references, BOARD_ORIGIN_X, y);
  if (refRects.length > 0) {
    y = bottomOf(refRects, y) + 48;
  }

  const assetRects = layoutImageAssets(assets, BOARD_ORIGIN_X, y);

  return {
    assets: assetRects,
    references: refRects,
    pages: [],
  };
}
