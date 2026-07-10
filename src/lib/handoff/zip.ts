"use client";

import JSZip from "jszip";
import type { HandoffArtifact } from "./types";

/** 把 HandoffArtifact 打包成可下载的 zip Blob。 */
export async function zipHandoffArtifact(
  artifact: HandoffArtifact
): Promise<Blob> {
  const zip = new JSZip();
  for (const f of artifact.files) {
    zip.file(f.path, f.content);
  }
  return await zip.generateAsync({ type: "blob" });
}
