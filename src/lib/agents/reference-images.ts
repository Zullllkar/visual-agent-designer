/**
 * 项目参考图收集与 prompt 注入
 * --------------------------------------------------------------
 * Composer 粘贴/拖入的 references，以及消息前缀【参考图】/【引用素材】，
 * 在生图时真正传给 Image Provider（或写入风格提示）。
 *
 * @author：wangjunhua
 */

import type { ProjectFile } from "@/lib/project/schema";
import type { ImageAsset, ReferenceAsset } from "@/lib/project/assets-schema";
import { isUsableReferenceImage } from "@/lib/agents/tools/utils";
import { displayAssetTitle } from "@/lib/project/asset-title";

export const MAX_REFERENCE_IMAGES = 3;
const FROM_ASSET_PREFIX = "from-asset-";

export interface CollectedReferenceImages {
  ids: string[];
  labels: string[];
  srcs: string[];
  /** 画布连线用：消息点名的父素材 */
  parentAssetId?: string;
  /** true = 用户点名了参考，不要再混入项目里其它参考图 */
  exclusive: boolean;
}

type PickedRef = { id: string; label: string; src: string };

/** 从 project.references 与 project.assets 收集可用参考图；preferIds 优先。 */
export function collectProjectReferenceImages(
  project: ProjectFile | null | undefined,
  options?: { preferIds?: string[]; max?: number }
): CollectedReferenceImages {
  const max = Math.max(1, Math.min(options?.max ?? MAX_REFERENCE_IMAGES, 4));
  const refs = project?.references ?? [];
  const assets = project?.assets ?? [];
  const preferIds = options?.preferIds ?? [];

  const byRefId = new Map(refs.map((ref) => [ref.id, ref]));
  const byAssetId = new Map(assets.map((asset) => [asset.id, asset]));
  const ordered: PickedRef[] = [];
  const seen = new Set<string>();

  const push = (item: PickedRef | null) => {
    if (!item || seen.has(item.src) || seen.has(item.id)) return;
    if (!isUsableReferenceImage(item.src)) return;
    ordered.push(item);
    seen.add(item.id);
    seen.add(item.src);
  };

  for (const id of preferIds) {
    if (ordered.length >= max) break;
    push(pickReferenceById(id, byRefId, byAssetId));
  }

  const exclusive = preferIds.length > 0 && ordered.length > 0;
  if (!exclusive) {
    const restRefs = refs
      .filter((ref) => !seen.has(ref.id) && isUsableReferenceImage(ref.src))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    for (const ref of restRefs) {
      if (ordered.length >= max) break;
      push(toPickedRef(ref));
    }
  }

  const picked = ordered.slice(0, max);
  return {
    ids: picked.map((item) => item.id),
    labels: picked.map((item) => item.label),
    srcs: picked.map((item) => item.src),
    parentAssetId: resolveCitedParentAssetId(project, preferIds),
    exclusive,
  };
}

/** 父图派生节点一律用连线上的父图当参考，不用子图自己、也不回退到最新生成图。 */
export function resolveCitedVisualAsset(
  project: ProjectFile | null | undefined,
  assetId: string | undefined
): ImageAsset | undefined {
  if (!assetId) return undefined;
  const byId = new Map((project?.assets ?? []).map((asset) => [asset.id, asset]));
  const startId = assetId.startsWith(FROM_ASSET_PREFIX)
    ? assetId.slice(FROM_ASSET_PREFIX.length)
    : assetId;
  return resolveLinkedVisualAsset(byId.get(startId), byId);
}

export function resolveCitedParentAssetId(
  project: ProjectFile | null | undefined,
  preferIds: string[]
): string | undefined {
  for (const raw of preferIds) {
    const visual = resolveCitedVisualAsset(project, raw);
    if (visual) return visual.id;
  }
  return undefined;
}

function resolveLinkedVisualAsset(
  start: ImageAsset | undefined,
  byAssetId: Map<string, ImageAsset>
): ImageAsset | undefined {
  if (!start) return undefined;
  if (start.parentAssetId) {
    const parent = byAssetId.get(start.parentAssetId);
    if (parent && isUsableReferenceImage(parent.src)) return parent;
  }
  const seen = new Set<string>();
  let current: ImageAsset | undefined = start;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (isUsableReferenceImage(current.src)) return current;
    current = current.parentAssetId
      ? byAssetId.get(current.parentAssetId)
      : undefined;
  }
  return undefined;
}

function pickReferenceById(
  id: string,
  byRefId: Map<string, ReferenceAsset>,
  byAssetId: Map<string, ImageAsset>
): PickedRef | null {
  const assetId = id.startsWith(FROM_ASSET_PREFIX)
    ? id.slice(FROM_ASSET_PREFIX.length)
    : id;
  const visual = resolveLinkedVisualAsset(
    byAssetId.get(id) ?? byAssetId.get(assetId),
    byAssetId
  );
  if (visual) {
    return {
      id: visual.id,
      label: displayAssetTitle(visual).slice(0, 40),
      src: visual.src,
    };
  }

  const ref = byRefId.get(id);
  if (ref && isUsableReferenceImage(ref.src)) return toPickedRef(ref);
  return null;
}

function toPickedRef(ref: ReferenceAsset): PickedRef {
  return { id: ref.id, label: ref.label, src: ref.src };
}

/** Provider 不吃图时，把参考意图写进 prompt。 */
export function appendReferenceStyleHint(
  prompt: string,
  labels: string[]
): string {
  if (labels.length === 0) return prompt;
  const list = labels.map((label) => `"${label}"`).join(", ");
  const hint = `Match the visual style, color palette, lighting, and composition of the attached reference image(s): ${list}.`;
  if (prompt.includes("attached reference image")) return prompt;
  return `${prompt.replace(/\s+$/, "")}. ${hint}`;
}

const CITED_STYLE_LOCK =
  "The attached reference image is the only visual style source. Match its palette, materials, lighting, typography, and UI chrome. Do not copy composition from the attachment unless the user asked for a variant. Ignore project Design context, brand kit, and other recent canvas screens if they differ from this attachment.";

/** 用户点名了画布素材 / 参考图时，提示词以该图为风格真相，而不是项目里积累的旧风格。 */
export function groundPromptToCitedReferences(
  prompt: string,
  input: {
    cited: boolean;
    labels: string[];
    userIntent?: string;
  }
): string {
  if (!input.cited) {
    return appendReferenceStyleHint(prompt, input.labels);
  }
  if (prompt.includes("only visual style source")) return prompt;
  const intent = input.userIntent?.replace(/\s+/g, " ").trim().slice(0, 220);
  return [
    CITED_STYLE_LOCK,
    intent ? `User request: ${intent}.` : null,
    prompt.replace(/\s+$/, ""),
  ]
    .filter(Boolean)
    .join(" ");
}

export function stripCitationPrefix(text: string): string {
  return text
    .replace(/【(?:引用素材|参考图|引用页面|引用元素)[^】]*】/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatReferenceSummary(
  collected: CollectedReferenceImages
): string | null {
  if (collected.ids.length === 0) return null;
  return collected.labels
    .map((label, index) => `${label}#${collected.ids[index]}`)
    .join(", ");
}
