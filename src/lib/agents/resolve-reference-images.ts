import "server-only";

import { resolveAssetImageDataUrl } from "@/lib/handoff/resolve-asset-src";

/** 把 /api/assets 或 http 参考图收成 data URL，供 Gemini / OpenAI 兼容接口使用。 */
export async function resolveReferenceImagesForModel(
  srcs: string[] | undefined,
  projectId?: string
): Promise<string[]> {
  if (!srcs?.length) return [];
  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const src of srcs) {
    const dataUrl = await resolveAssetImageDataUrl(src, projectId);
    if (!dataUrl || dataUrl.startsWith("data:image/svg+xml")) continue;
    if (seen.has(dataUrl)) continue;
    seen.add(dataUrl);
    resolved.push(dataUrl);
  }
  return resolved;
}
