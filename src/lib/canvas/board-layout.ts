/**
 * 画布智能排版
 * --------------------------------------------------------------
 * 按 parentAssetId 血缘聚成「家族簇」：父图在左、派生素材在右；
 * 多家族分行排布，避免无脑塞进中间 3 列网格。
 *
 * @author：wangjunhua
 */

import type { ProjectFile } from "@/lib/project/schema";
import type { ImageAsset, ReferenceAsset } from "@/lib/project/assets-schema";
import type { CanvasPage } from "@/lib/canvas/schema";
import {
  isCanvasVisibleAsset,
  isCanvasVisibleReference,
} from "@/lib/project/asset-visibility";

/** 无血缘孤图网格列数 */
export const BOARD_ASSET_COLS = 3;
export const BOARD_GAP = 32;
export const BOARD_ORIGIN_X = 0;
export const BOARD_ORIGIN_Y = 0;

/** 家族之间水平间距（含底板外沿） */
export const FAMILY_GAP_X = 80;
/** 家族行之间垂直间距 */
export const FAMILY_GAP_Y = 72;
/** 家族底板相对素材包围盒的内边距 */
export const FAMILY_BOARD_PAD_X = 18;
export const FAMILY_BOARD_PAD_TOP = 48;
export const FAMILY_BOARD_PAD_BOTTOM = 16;
/** 父图与子素材间距 */
export const PARENT_CHILD_GAP = 24;
/** 子素材网格间距 */
export const CHILD_GAP = 14;
/** 一行家族最大宽度（超出则换行） */
export const FAMILY_ROW_MAX_W = 1680;

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

const IMAGE_ASSET_DISPLAY_SCALE = 0.25;
const IMAGE_ASSET_MIN_LONG_EDGE = 140;
const IMAGE_ASSET_MAX_LONG_EDGE = 420;
const CHILD_MAX_LONG_EDGE = 280;

const ROLE_ORDER: Record<string, number> = {
  background: 0,
  hero: 1,
  illustration: 2,
  "product-shot": 3,
  icon: 4,
  avatar: 5,
  decoration: 6,
};

/** 生图在画布上的展示尺寸（与 image-asset-shape 一致） */
export function displaySizeForImageAsset(
  width: number,
  height: number,
  maxLongEdge = IMAGE_ASSET_MAX_LONG_EDGE
): DisplaySize {
  const safeW = Math.max(1, width);
  const safeH = Math.max(1, height);
  const longEdge = Math.max(safeW, safeH);
  const targetLongEdge = Math.min(
    maxLongEdge,
    Math.max(IMAGE_ASSET_MIN_LONG_EDGE, longEdge * IMAGE_ASSET_DISPLAY_SCALE)
  );
  const scale = targetLongEdge / longEdge;
  return {
    w: Math.round(safeW * scale),
    h: Math.round(safeH * scale),
  };
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

/** 生图主网格（无血缘孤图用） */
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

function rightOf(rects: PlacedRect[], fallback: number): number {
  if (rects.length === 0) return fallback;
  return Math.max(...rects.map((r) => r.x + r.w));
}

export function boundsFromRects(rects: PlacedRect[]): PlacedRect | null {
  if (rects.length === 0) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return {
    x,
    y,
    w: rightOf(rects, x) - x,
    h: bottomOf(rects, y) - y,
  };
}

/** 家族簇外的底板矩形（含标题条空间） */
export function familyBoardRect(memberRects: PlacedRect[]): PlacedRect | null {
  const inner = boundsFromRects(memberRects);
  if (!inner) return null;
  return {
    x: inner.x - FAMILY_BOARD_PAD_X,
    y: inner.y - FAMILY_BOARD_PAD_TOP,
    w: inner.w + FAMILY_BOARD_PAD_X * 2,
    h: inner.h + FAMILY_BOARD_PAD_TOP + FAMILY_BOARD_PAD_BOTTOM,
  };
}

/** 当前包围盒明显大于紧凑排版时，视为被撑开的空底板 */
export function isFamilyLayoutLoose(
  current: PlacedRect,
  compact: PlacedRect,
  ratio = 1.55
): boolean {
  const compactArea = Math.max(1, compact.w * compact.h);
  return current.w * current.h > compactArea * ratio;
}

function sortChildren(a: ImageAsset, b: ImageAsset): number {
  const sourceRank = (s?: string) =>
    s === "materialized" ? 0 : s === "edited" ? 1 : 2;
  const sr = sourceRank(a.source) - sourceRank(b.source);
  if (sr !== 0) return sr;
  const rr =
    (ROLE_ORDER[a.role ?? ""] ?? 50) - (ROLE_ORDER[b.role ?? ""] ?? 50);
  if (rr !== 0) return rr;
  return a.createdAt.localeCompare(b.createdAt);
}

export interface AssetFamily {
  root: ImageAsset;
  /** BFS 后代（不含 root） */
  descendants: ImageAsset[];
}

/** 按 parentAssetId 拆成家族（父可见才挂靠，否则升为根） */
export function buildAssetFamilies(assets: ImageAsset[]): AssetFamily[] {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const childrenOf = new Map<string, ImageAsset[]>();

  for (const asset of assets) {
    const pid = asset.parentAssetId;
    if (pid && byId.has(pid)) {
      const list = childrenOf.get(pid) ?? [];
      list.push(asset);
      childrenOf.set(pid, list);
    }
  }

  const roots = assets.filter(
    (a) => !a.parentAssetId || !byId.has(a.parentAssetId)
  );

  return roots.map((root) => {
    const descendants: ImageAsset[] = [];
    const queue = [...(childrenOf.get(root.id) ?? [])].sort(sortChildren);
    while (queue.length) {
      const node = queue.shift()!;
      descendants.push(node);
      const kids = (childrenOf.get(node.id) ?? []).slice().sort(sortChildren);
      queue.push(...kids);
    }
    return { root, descendants };
  });
}

export function layoutOneFamily(
  family: AssetFamily,
  originX: number,
  originY: number
): { byId: Map<string, PlacedRect>; bounds: PlacedRect } {
  const rootSize = displaySizeForImageAsset(
    family.root.width,
    family.root.height
  );
  const rootRect: PlacedRect = {
    x: originX,
    y: originY,
    w: rootSize.w,
    h: rootSize.h,
  };
  const byId = new Map<string, PlacedRect>([[family.root.id, rootRect]]);

  if (family.descendants.length === 0) {
    return {
      byId,
      bounds: { ...rootRect },
    };
  }

  const childSizes = family.descendants.map((c) =>
    displaySizeForImageAsset(c.width, c.height, CHILD_MAX_LONG_EDGE)
  );
  const childCols = family.descendants.length >= 5 ? 2 : 1;
  const childOriginX = originX + rootSize.w + PARENT_CHILD_GAP;
  const childRects = layoutGrid(
    childSizes,
    childCols,
    childOriginX,
    originY,
    CHILD_GAP
  );

  const childrenBlockH =
    childRects.length > 0
      ? Math.max(...childRects.map((r) => r.y + r.h)) - originY
      : 0;
  if (childrenBlockH > 0 && childrenBlockH < rootSize.h) {
    const dy = Math.round((rootSize.h - childrenBlockH) / 2);
    for (const r of childRects) r.y += dy;
  }

  family.descendants.forEach((child, i) => {
    byId.set(child.id, childRects[i]!);
  });

  const all = [rootRect, ...childRects];
  return {
    byId,
    bounds: {
      x: originX,
      y: originY,
      w: rightOf(all, originX) - originX,
      h: bottomOf(all, originY) - originY,
    },
  };
}

/**
 * 智能排布可见素材：
 * - 有派生子的家族：父左子右成簇，簇按行流动
 * - 无孩子的孤根：收成紧凑网格，放在家族区下方
 */
export function layoutAssetsByLineage(
  assets: ImageAsset[],
  originX = BOARD_ORIGIN_X,
  originY = BOARD_ORIGIN_Y
): Map<string, PlacedRect> {
  const result = new Map<string, PlacedRect>();
  if (assets.length === 0) return result;

  const families = buildAssetFamilies(assets);
  const clusters = families.filter((f) => f.descendants.length > 0);
  const singles = families.filter((f) => f.descendants.length === 0);

  let cursorX = originX;
  let cursorY = originY;
  let rowMaxH = 0;

  for (const family of clusters) {
    const { byId, bounds } = layoutOneFamily(family, 0, 0);
    if (
      cursorX > originX &&
      cursorX - originX + bounds.w > FAMILY_ROW_MAX_W
    ) {
      cursorX = originX;
      cursorY += rowMaxH + FAMILY_GAP_Y;
      rowMaxH = 0;
    }
    for (const [id, rect] of byId) {
      result.set(id, {
        x: rect.x + cursorX,
        y: rect.y + cursorY,
        w: rect.w,
        h: rect.h,
      });
    }
    cursorX += bounds.w + FAMILY_GAP_X;
    rowMaxH = Math.max(rowMaxH, bounds.h);
  }

  if (singles.length > 0) {
    let singleY = originY;
    if (clusters.length > 0) {
      singleY = cursorY + rowMaxH + FAMILY_GAP_Y;
    }
    const loneAssets = singles.map((f) => f.root);
    const rects = layoutImageAssets(loneAssets, originX, singleY);
    loneAssets.forEach((asset, i) => {
      result.set(asset.id, rects[i]!);
    });
  }

  return result;
}

export interface BoardLayoutResult {
  /** 与可见 assets 同序的矩形（兼容旧调用） */
  assets: PlacedRect[];
  /** 按 assetId 索引，推荐使用 */
  assetById: Record<string, PlacedRect>;
  references: PlacedRect[];
  pages: PlacedRect[];
}

/** 根据项目数据计算各层位置 */
export function computeBoardLayout(project: ProjectFile): BoardLayoutResult {
  const assets = (project.assets ?? []).filter(isCanvasVisibleAsset);
  const references = (project.references ?? []).filter(isCanvasVisibleReference);

  let y = BOARD_ORIGIN_Y;
  const refRects = layoutReferences(references, BOARD_ORIGIN_X, y);
  if (refRects.length > 0) {
    y = bottomOf(refRects, y) + 48;
  }

  const byIdMap = layoutAssetsByLineage(assets, BOARD_ORIGIN_X, y);
  const assetById: Record<string, PlacedRect> = {};
  for (const [id, rect] of byIdMap) assetById[id] = rect;

  // 保持与 assets 数组同序，供旧 index 路径兜底
  const assetRects = assets.map(
    (a) =>
      assetById[a.id] ?? {
        x: BOARD_ORIGIN_X,
        y,
        w: 160,
        h: 160,
      }
  );

  return {
    assets: assetRects,
    assetById,
    references: refRects,
    pages: [],
  };
}
