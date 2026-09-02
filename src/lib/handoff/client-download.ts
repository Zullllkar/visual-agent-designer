/**
 * Handoff 客户端下载
 * --------------------------------------------------------------
 * Chat / HandoffDialog 共用：请求服务端 zip 并触发浏览器下载。
 *
 * @author：wangjunhua
 */

import type { ProjectFile } from "@/lib/project/schema";
import type { HandoffTarget } from "./types";

export function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadHandoffZip(
  project: ProjectFile,
  target: HandoffTarget["name"] = "markdown",
  options?: {
    selectedAssetIds?: string[];
    selectedReferenceIds?: string[];
  }
): Promise<void> {
  const res = await fetch("/api/handoff/zip", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      project,
      target,
      selectedAssetIds: options?.selectedAssetIds,
      selectedReferenceIds: options?.selectedReferenceIds,
    }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      message?: string;
      error?: string;
    };
    throw new Error(body.message ?? body.error ?? `Handoff zip failed: ${res.status}`);
  }

  const blob = await res.blob();
  triggerBrowserDownload(
    blob,
    `${project.slug || project.id}.${target}.handoff.zip`
  );
}
