/**
 * 从素材图抽取设计规格（Vision LLM → JSON；失败则启发式回退）
 * Server-only：勿从 Client Component 直接导入。
 * 客户端请用 `@/lib/design-spec/spec-format`。
 *
 * 设计要点（对齐「单独拿 Vision 拆解」的质量）：
 * 1. 区域优先、schema 精简（不要逼模型同时填 tokens/components）
 * 2. 高清看图（imageDetail=high）+ 更大 max_tokens
 * 3. 先看图再读文案；生成 prompt 仅作弱参考，禁止替代像素观察
 */

import "server-only";

import type { ImageAsset } from "@/lib/project/assets-schema";
import {
  AssetDesignSpecSchema,
  type AssetDesignSpec,
  type DesignSpecRegion,
} from "@/lib/project/design-spec-schema";
import type { ProjectFile } from "@/lib/project/schema";
import type { LlmProvider } from "@/lib/providers/llm/types";
import { isMockLlmText } from "@/lib/providers/llm/utils";
import { extractPaletteFromDataUrl } from "@/lib/handoff/palette-extract";
import { resolveAssetImageDataUrl } from "@/lib/handoff/resolve-asset-src";
import { compressImageDataUrlForVision } from "@/lib/handoff/vision-image";
import { reconcileSpecCopy } from "./copy-reconcile";
import { inferRegionStates } from "./infer-states";
import { buildHeuristicSpec } from "./spec-format";

export {
  buildHeuristicSpec,
  mergeSpecTokensIntoHandoffTokens,
  renderAssetDesignSpecMarkdown,
} from "./spec-format";

/** 单独 Chat 式拆解：只关心 regions，与「让模型拆很多很清楚」一致 */
const DECOMPOSE_SYSTEM = `You are a UI screen decomposer. Look at the attached screenshot carefully and output STRICT JSON only (no markdown fence).

Your ONLY job: list every meaningful region you SEE in the pixels.

Schema:
{
  "summary": string,
  "screenType": "landing"|"dashboard"|"mobile-app"|"desktop-app"|"marketing"|"illustration"|"other",
  "layout": string,
  "artStyle": {
    "finish": string,
    "lighting": string,
    "texture": string,
    "edge": string,
    "accent": string
  },
  "regions": [{
    "id": string,
    "name": string,
    "role": "nav"|"hero"|"sidebar"|"main"|"card"|"form"|"cta"|"footer"|"illustration"|"background"|"avatar"|"icon"|"decoration"|"other",
    "delivery": "media"|"code",
    "bbox": { "x": number, "y": number, "w": number, "h": number },
    "copy"?: string,
    "notes"?: string,
    "materialPrompt"?: string
  }]
}

artStyle = MATERIAL LOOK only (finish/lighting/texture/edge/accent hex). NEVER put page structure words (login, sidebar, header, layout, screen) into artStyle.

OBSERVE PIXELS — do not invent a different layout from text context.

delivery:
- "code": nav, search, tabs, buttons, text, form fields, card frames / labels / metadata chrome
- "media": hero art, 3D/renders, photos, illustrations, backgrounds, avatars, and EACH distinct item thumbnail/icon in a grid

Asset library / inventory / catalog grids:
- One media region per visible thumbnail/icon (tight bbox)
- Grid chrome / titles / search stay code

bbox: REQUIRED, normalized 0–1 (x,y top-left). Tight around the subject.
Tall pages: y grows downward; place boxes where subjects actually are.

materialPrompt (media only): English, isolated subject only — no UI chrome, no text labels, prefer transparent/clean background.

Count guidance:
- Simple screen: 4–10 regions
- Complex / grid screen: 12–40 regions (do NOT stop at 5)
- Prefer oversplitting media over merging unrelated bitmaps`;

export async function extractAssetDesignSpec(input: {
  asset: ImageAsset;
  project: ProjectFile;
  llm: LlmProvider;
}): Promise<AssetDesignSpec> {
  const { asset, project, llm } = input;
  const now = new Date().toISOString();
  const visionWarnings: string[] = [];
  let visionSpec: AssetDesignSpec | null = null;

  const rawImage = asset.src ? await resolveAssetImageDataUrl(asset.src, project.id) : null;
  if (asset.src && !rawImage) {
    visionWarnings.push(
      "无法读取 mockup 图片（/api/assets 或 data URL 解析失败），已回退启发式拆解。",
    );
  }

  if (rawImage && llm.name !== "mock-llm") {
    // 原图直传极易 timeout（实测 120s×3 ≈ 6min）；先压到 ≤1536 边
    const compressed = await compressImageDataUrlForVision(rawImage, {
      maxEdge: 1536,
    });
    const imageDataUrl = compressed.dataUrl;
    const approxBytes = compressed.bytesApprox;
    try {
      const prompt = [
        "Decompose the attached UI screenshot into regions.",
        "Trust what you SEE in the image. Text context below is optional background only.",
        "",
        `Original image size: ${asset.width}x${asset.height}px`,
        compressed.width && compressed.height
          ? `Vision feed size: ${compressed.width}x${compressed.height}px (~${Math.round(approxBytes / 1024)}KB)`
          : `Vision feed ~${Math.round(approxBytes / 1024)}KB`,
        `Product (optional): ${project.brief?.productName ?? project.title}`,
        `Platform (optional): ${project.brief?.platform ?? "unspecified"}`,
        asset.prompt
          ? `Original gen prompt (DO NOT copy layout from this; observe pixels): ${asset.prompt.slice(0, 220)}`
          : "",
        "",
        "Return JSON with summary, screenType, layout, artStyle (material look only), and a detailed regions[].",
      ]
        .filter(Boolean)
        .join("\n");

      const out = await llm.generateText({
        system: DECOMPOSE_SYSTEM,
        prompt,
        schema: { type: "object" },
        images: [imageDataUrl],
        imageDetail: "high",
        temperature: 0.15,
        // 部分兼容网关对过大 max_tokens 直接 400；8192 更稳
        maxTokens: 8192,
      });

      if (isMockLlmText(out.text)) {
        visionWarnings.push("LLM 返回 Mock 占位输出，未真正 Vision 拆解，已回退启发式。");
      } else {
        const rawText = stripJsonFence(out.text);
        if (looksTruncatedJson(rawText)) {
          visionWarnings.push(
            "Vision JSON 疑似被截断（max_tokens 不足或网关截断）。请换更大输出额度的模型或减少 materialPrompt 长度后重试。",
          );
        }
        const raw = JSON.parse(rawText) as Record<string, unknown>;
        const normalized = normalizeSpecPayload(raw, asset.id, {
          width: asset.width,
          height: asset.height,
        });
        const parsed = AssetDesignSpecSchema.safeParse({
          ...normalized,
          version: 1,
          assetId: asset.id,
          source: "vision",
          model: llm.name,
          createdAt: asset.designSpec?.createdAt ?? now,
          updatedAt: now,
          extractionWarnings: [`Vision 已读图 (~${Math.round(approxBytes / 1024)}KB)，detail=high`],
        });
        if (parsed.success) {
          const qualityWarnings = validateVisionSpec(parsed.data);
          visionSpec = {
            ...parsed.data,
            extractionWarnings: [...(parsed.data.extractionWarnings ?? []), ...qualityWarnings],
          };
        } else {
          visionWarnings.push(
            `Vision JSON 校验失败: ${parsed.error.issues
              .slice(0, 3)
              .map((i) => i.message)
              .join("; ")}`,
          );
        }
      }
    } catch (error) {
      visionWarnings.push(`Vision 拆解异常: ${(error as Error).message}`.slice(0, 280));
    }
  } else if (llm.name === "mock-llm") {
    visionWarnings.push("当前 LLM 为 Mock，无法 Vision 拆解。");
  }

  const spec = visionSpec ?? buildHeuristicSpec(asset, project, now, visionWarnings);
  // 颜色不交给 LLM 猜：无论 Vision 还是启发式，都从像素采样补齐色板与区域 swatch
  const withPalette = rawImage ? await enrichSpecWithPixelPalette(spec, rawImage) : spec;
  // 文案以生图前的 copyPlan / prompt 引号文本为准，Vision 读到的字只用来定位
  const reconciled = reconcileSpecCopy(withPalette, {
    copyPlan: asset.copyPlan,
    prompt: asset.prompt,
  });
  if (reconciled.corrected > 0 || reconciled.unplaced.length > 0) {
    reconciled.spec.extractionWarnings = [
      ...(reconciled.spec.extractionWarnings ?? []),
      `文案校正：${reconciled.corrected} 处按 copyPlan / prompt 修正，${reconciled.unplaced.length} 条计划文案图上未出现。`,
    ];
  }
  // 图上只有一种状态；给每个代码区域补 hover / empty / loading / error 等状态
  const withStates = await inferRegionStates({ spec: reconciled.spec, project, llm });
  if (withStates.source !== "none") {
    withStates.spec.extractionWarnings = [
      ...(withStates.spec.extractionWarnings ?? []),
      `状态推断（${withStates.source}）：${withStates.spec.regions.filter((r) => r.states?.length).length} 个代码区域带状态。`,
      ...withStates.warnings,
    ];
  }
  return withStates.spec;
}

/**
 * 像素色板 → tokens.colors（主）+ 每个 region 的 swatch + artStyle.accent。
 * LLM / prompt 给的颜色保留在后面并标注来源，供人工比对。
 */
export async function enrichSpecWithPixelPalette(
  spec: AssetDesignSpec,
  imageDataUrl: string,
): Promise<AssetDesignSpec> {
  const extracted = await extractPaletteFromDataUrl(imageDataUrl, {
    maxColors: 8,
    regions: spec.regions.map((r) => ({ id: r.id, bbox: r.bbox })),
  }).catch(() => null);

  if (!extracted || extracted.palette.length === 0) {
    return {
      ...spec,
      extractionWarnings: [
        ...(spec.extractionWarnings ?? []),
        "像素色板提取失败（图片解码不支持或读取失败），tokens 沿用 Vision / 启发式结果。",
      ],
    };
  }

  const pixelColors = extracted.palette.map((p) => ({
    name: p.name,
    value: p.value,
    usage: p.usage,
    source: "pixels" as const,
    share: p.share,
  }));
  const pixelValues = new Set(pixelColors.map((c) => c.value.toUpperCase()));
  const pixelNames = new Set(pixelColors.map((c) => c.name));
  const legacySource = spec.source === "vision" ? ("vision" as const) : ("prompt" as const);
  const legacyColors = spec.tokens.colors
    .filter((c) => c.value && !pixelValues.has(c.value.toUpperCase()))
    .map((c) => ({
      ...c,
      name: pixelNames.has(c.name) ? `${c.name}-${c.source ?? legacySource}` : c.name,
      source: c.source ?? legacySource,
    }));

  const regions = spec.regions.map((r) => {
    const swatch = extracted.regions[r.id];
    return swatch ? { ...r, swatch } : r;
  });

  const accent = extracted.palette.find((p) => p.name === "accent")?.value;
  const artStyle =
    spec.artStyle && !spec.artStyle.accent && accent
      ? { ...spec.artStyle, accent }
      : (spec.artStyle ??
        (accent ? { finish: "", lighting: "", texture: "", edge: "", accent } : undefined));

  return {
    ...spec,
    regions,
    artStyle,
    tokens: { ...spec.tokens, colors: [...pixelColors, ...legacyColors] },
    extractionWarnings: [
      ...(spec.extractionWarnings ?? []),
      `像素色板已提取：${pixelColors.length} 色（采样 ${extracted.sampleWidth}x${extracted.sampleHeight}），${Object.keys(extracted.regions).length} 个区域带 swatch。`,
    ],
  };
}

function validateVisionSpec(spec: AssetDesignSpec): string[] {
  const warnings: string[] = [];
  const mediaRegions = spec.regions.filter(
    (r) => r.delivery === "media" || inferDeliveryFromRole(r) === "media",
  );
  if (spec.regions.length < 3) {
    warnings.push(
      `Vision 仅返回 ${spec.regions.length} 个区域（偏少）。可点「重新拆解」或手动画框加槽。`,
    );
  }
  const missingBbox = spec.regions.filter((r) => !r.bbox).length;
  if (missingBbox > 0) {
    warnings.push(`${missingBbox} 个区域缺少 bbox，已用默认占位框。`);
  }
  if (mediaRegions.length === 0) {
    warnings.push("Vision 未识别媒体槽，Layout IR 将添加 fallback hero 槽。");
  }
  return warnings;
}

function inferDeliveryFromRole(region: DesignSpecRegion): "media" | "code" {
  if (region.delivery) return region.delivery;
  const mediaRoles = new Set([
    "hero",
    "illustration",
    "background",
    "avatar",
    "icon",
    "decoration",
  ]);
  if (mediaRoles.has(region.role)) return "media";
  return "code";
}

function normalizeSpecPayload(
  raw: Record<string, unknown>,
  assetId: string,
  imageSize: { width: number; height: number },
): Record<string, unknown> {
  const regions = Array.isArray(raw.regions)
    ? raw.regions.map((r, i) => {
        const row = (r ?? {}) as Record<string, unknown>;
        const delivery =
          row.delivery === "media" || row.delivery === "code" ? row.delivery : undefined;
        return {
          id: typeof row.id === "string" ? row.id : `r${i + 1}`,
          name: typeof row.name === "string" ? row.name : `Region ${i + 1}`,
          role: row.role ?? "other",
          delivery,
          bbox: normalizeRegionBBox(row.bbox, imageSize),
          copy: typeof row.copy === "string" ? row.copy : undefined,
          notes: typeof row.notes === "string" ? row.notes : undefined,
          materialPrompt:
            typeof row.materialPrompt === "string"
              ? row.materialPrompt.trim().slice(0, 600)
              : undefined,
        };
      })
    : [];

  return {
    summary: typeof raw.summary === "string" ? raw.summary : "Visual design reference",
    screenType: raw.screenType ?? "other",
    layout: typeof raw.layout === "string" ? raw.layout : "Single visual composition",
    hierarchy: Array.isArray(raw.hierarchy) ? raw.hierarchy : [],
    regions,
    artStyle: normalizeArtStyle(raw.artStyle),
    tokens: raw.tokens ?? { colors: [], typography: [], radii: [], spacingHints: [] },
    components: Array.isArray(raw.components) ? raw.components : [],
    doNot: Array.isArray(raw.doNot) ? raw.doNot : [],
    implementationNotes: Array.isArray(raw.implementationNotes) ? raw.implementationNotes : [],
    assetId,
  };
}

function normalizeArtStyle(raw: unknown):
  | {
      finish: string;
      lighting: string;
      texture: string;
      edge: string;
      accent: string;
    }
  | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Record<string, unknown>;
  const clip = (v: unknown) =>
    typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, 48) : "";
  const artStyle = {
    finish: clip(row.finish),
    lighting: clip(row.lighting),
    texture: clip(row.texture),
    edge: clip(row.edge),
    accent: clip(row.accent),
  };
  if (
    !artStyle.finish &&
    !artStyle.lighting &&
    !artStyle.texture &&
    !artStyle.edge &&
    !artStyle.accent
  ) {
    return undefined;
  }
  return artStyle;
}

/** 归一化 bbox：支持 0–1；若值 >1 则按像素 / 原图尺寸换算 */
export function normalizeRegionBBox(
  bbox: unknown,
  imageSize: { width: number; height: number },
): { x: number; y: number; w: number; h: number } | undefined {
  if (!bbox || typeof bbox !== "object") return undefined;
  const row = bbox as Record<string, unknown>;
  const x = num(row.x);
  const y = num(row.y);
  const w = num(row.w);
  const h = num(row.h);
  if (x == null || y == null || w == null || h == null) return undefined;

  const fullW = Math.max(1, imageSize.width);
  const fullH = Math.max(1, imageSize.height);
  const pixelLike = x > 1 || y > 1 || w > 1 || h > 1;

  const nx = pixelLike ? x / fullW : x;
  const ny = pixelLike ? y / fullH : y;
  const nw = pixelLike ? w / fullW : w;
  const nh = pixelLike ? h / fullH : h;

  return clampBBox({ x: nx, y: ny, w: nw, h: nh });
}

function clampBBox(b: {
  x: number;
  y: number;
  w: number;
  h: number;
}): { x: number; y: number; w: number; h: number } | undefined {
  const x = clamp01(b.x);
  const y = clamp01(b.y);
  const w = clamp01(b.w);
  const h = clamp01(b.h);
  if (w < 0.02 || h < 0.02) return undefined;
  return { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) };
}

function num(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function looksTruncatedJson(s: string): boolean {
  const t = s.trim();
  if (!t.startsWith("{")) return false;
  const open = (t.match(/\{/g) ?? []).length;
  const close = (t.match(/\}/g) ?? []).length;
  return open > close || /,\s*$/.test(t) || /:\s*$/.test(t);
}

function stripJsonFence(s: string): string {
  const trimmed = s.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}
