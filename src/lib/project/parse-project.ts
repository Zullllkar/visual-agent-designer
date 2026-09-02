import { ProjectFileSchema, type ProjectFile } from "@/lib/project/schema";
import type { ImageAsset } from "@/lib/project/assets-schema";

/**
 * Zod 4 walking a tldraw canvasSnapshot (or a multi-MB data URI in asset.src)
 * can throw "Maximum call stack size exceeded". Asset persist must parse the
 * project without those blobs.
 */
export function parseProjectFileLight(
  project: Omit<ProjectFile, "assets" | "updatedAt" | "designContext"> & {
    assets?: ImageAsset[];
    updatedAt?: string;
    designContext?: ProjectFile["designContext"];
    pages?: ProjectFile["pages"];
  }
): ProjectFile {
  const { canvasSnapshot, ...rest } = project as ProjectFile;
  const parsed = ProjectFileSchema.parse({
    ...rest,
    pages: rest.pages ?? [],
  });
  return canvasSnapshot ? { ...parsed, canvasSnapshot } : parsed;
}
