/**
 * 像素色板提取（纯算法，无 I/O）
 * --------------------------------------------------------------
 * 输入 RGBA 像素缓冲，输出按覆盖率排序的色板 + 语义命名
 * （background / ink / accent / surface / neutral-N / color-N）。
 * 供 DESIGN.md、tokens.json、Style Lock 和 Layout IR 区域 swatch 使用，
 * 让 coding agent 拿到的颜色来自图片本身而不是默认占位。
 */

export interface PaletteEntry {
  /** #rrggbb */
  value: string;
  /** 0–1，占采样像素比例 */
  share: number;
  /** 语义名；同一色板内唯一 */
  name: string;
  usage: string;
}

export interface RegionSwatch {
  dominant: string;
  accent?: string;
  /** 0–1，dominant 在区域内的占比 */
  dominantShare: number;
}

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA, length = width*height*4 */
  pixels: Uint8Array;
}

interface Cluster {
  r: number;
  g: number;
  b: number;
  count: number;
}

/** 5 bit/通道分箱；32^3 = 32768 箱 */
const BIN_SHIFT = 3;
/** 合并簇的 RGB 欧氏距离阈值 */
const MERGE_DISTANCE = 26;
const MAX_CLUSTERS = 32;

export function quantizeImage(
  image: RgbaImage,
  rect?: { x: number; y: number; w: number; h: number },
): Cluster[] {
  const { width, height, pixels } = image;
  const x0 = rect ? clampInt(Math.floor(rect.x * width), 0, width - 1) : 0;
  const y0 = rect ? clampInt(Math.floor(rect.y * height), 0, height - 1) : 0;
  const x1 = rect ? clampInt(Math.ceil((rect.x + rect.w) * width), x0 + 1, width) : width;
  const y1 = rect ? clampInt(Math.ceil((rect.y + rect.h) * height), y0 + 1, height) : height;

  const bins = new Map<number, Cluster>();
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      const a = pixels[i + 3];
      if (a < 128) continue;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const key = ((r >> BIN_SHIFT) << 10) | ((g >> BIN_SHIFT) << 5) | (b >> BIN_SHIFT);
      const bin = bins.get(key);
      if (bin) {
        bin.r += r;
        bin.g += g;
        bin.b += b;
        bin.count += 1;
      } else {
        bins.set(key, { r, g, b, count: 1 });
      }
    }
  }

  const sorted = [...bins.values()].sort((a, b) => b.count - a.count);
  const clusters: Cluster[] = [];
  for (const bin of sorted) {
    const mr = bin.r / bin.count;
    const mg = bin.g / bin.count;
    const mb = bin.b / bin.count;
    let merged = false;
    for (const c of clusters) {
      const cr = c.r / c.count;
      const cg = c.g / c.count;
      const cb = c.b / c.count;
      if (dist(mr, mg, mb, cr, cg, cb) <= MERGE_DISTANCE) {
        c.r += bin.r;
        c.g += bin.g;
        c.b += bin.b;
        c.count += bin.count;
        merged = true;
        break;
      }
    }
    if (!merged) {
      if (clusters.length >= MAX_CLUSTERS) continue;
      clusters.push({ ...bin });
    }
  }
  return clusters.sort((a, b) => b.count - a.count);
}

/** 整图色板：取前 maxColors 个簇并命名 */
export function buildPalette(image: RgbaImage, maxColors = 8): PaletteEntry[] {
  const clusters = quantizeImage(image);
  const total = clusters.reduce((n, c) => n + c.count, 0);
  if (total === 0) return [];
  const top = clusters.filter((c) => c.count / total >= 0.003).slice(0, Math.max(1, maxColors));
  return nameClusters(top, total);
}

/** 区域 swatch：dominant + 最饱和的次要色 */
export function buildRegionSwatch(
  image: RgbaImage,
  bbox: { x: number; y: number; w: number; h: number },
): RegionSwatch | null {
  const clusters = quantizeImage(image, bbox);
  const total = clusters.reduce((n, c) => n + c.count, 0);
  if (total === 0 || clusters.length === 0) return null;
  const dominant = clusters[0];
  const dominantHex = toHex(dominant);
  let accent: Cluster | undefined;
  let bestScore = 0;
  for (const c of clusters.slice(1)) {
    const share = c.count / total;
    if (share < 0.04) continue;
    const s = saturation(c);
    const score = s * Math.sqrt(share);
    if (s >= 0.25 && score > bestScore) {
      bestScore = score;
      accent = c;
    }
  }
  return {
    dominant: dominantHex,
    accent: accent && toHex(accent) !== dominantHex ? toHex(accent) : undefined,
    dominantShare: round3(dominant.count / total),
  };
}

function nameClusters(clusters: Cluster[], total: number): PaletteEntry[] {
  const out: PaletteEntry[] = [];
  const used = new Set<number>();

  const bg = clusters[0];
  used.add(0);
  out.push(entry(bg, total, "background", "Page / canvas background — largest area in the mockup"));
  const bgL = luminance(bg);

  let inkIdx = -1;
  let inkContrast = 0;
  clusters.forEach((c, i) => {
    if (used.has(i)) return;
    if (saturation(c) > 0.35) return;
    const contrast = Math.abs(luminance(c) - bgL);
    if (contrast > inkContrast) {
      inkContrast = contrast;
      inkIdx = i;
    }
  });
  if (inkIdx >= 0 && inkContrast >= 0.25) {
    used.add(inkIdx);
    out.push(entry(clusters[inkIdx], total, "ink", "Primary text / high-contrast foreground"));
  }

  let accentIdx = -1;
  let accentScore = 0;
  clusters.forEach((c, i) => {
    if (used.has(i)) return;
    const s = saturation(c);
    const l = luminance(c);
    if (s < 0.3 || l < 0.06 || l > 0.96) return;
    const score = s * Math.sqrt(c.count / total);
    if (score > accentScore) {
      accentScore = score;
      accentIdx = i;
    }
  });
  if (accentIdx >= 0) {
    used.add(accentIdx);
    out.push(
      entry(
        clusters[accentIdx],
        total,
        "accent",
        "Brand accent — primary CTA, active states, highlights",
      ),
    );
  }

  let surfaceIdx = -1;
  clusters.forEach((c, i) => {
    if (used.has(i) || surfaceIdx >= 0) return;
    if (saturation(c) > 0.2) return;
    const d = Math.abs(luminance(c) - bgL);
    if (d >= 0.03 && d <= 0.25) surfaceIdx = i;
  });
  if (surfaceIdx >= 0) {
    used.add(surfaceIdx);
    out.push(
      entry(clusters[surfaceIdx], total, "surface", "Cards / panels — one step off the background"),
    );
  }

  let neutralN = 1;
  let colorN = 1;
  clusters.forEach((c, i) => {
    if (used.has(i)) return;
    if (saturation(c) <= 0.2) {
      out.push(entry(c, total, `neutral-${neutralN++}`, "Secondary text, borders, dividers"));
    } else {
      out.push(entry(c, total, `color-${colorN++}`, "Secondary accent / illustration color"));
    }
  });

  return out;
}

function entry(c: Cluster, total: number, name: string, usage: string): PaletteEntry {
  return { value: toHex(c), share: round3(c.count / total), name, usage };
}

export function toHex(c: { r: number; g: number; b: number; count: number }): string {
  const r = Math.round(c.r / c.count);
  const g = Math.round(c.g / c.count);
  const b = Math.round(c.b / c.count);
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`.toUpperCase();
}

function hex2(n: number): string {
  return Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
}

function saturation(c: Cluster): number {
  const r = c.r / c.count / 255;
  const g = c.g / c.count / 255;
  const b = c.b / c.count / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) return 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return 0;
  return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

/** 相对亮度（sRGB 近似，0–1） */
function luminance(c: Cluster): number {
  const lin = (v: number) => {
    const s = v / c.count / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

function dist(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
