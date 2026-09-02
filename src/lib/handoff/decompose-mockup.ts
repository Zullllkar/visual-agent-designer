/**
 * 满意整图 → Vision 拆解 + Style Lock + Layout IR
 */

import "server-only";

import { extractAssetDesignSpec } from "@/lib/design-spec/extract-asset-spec";
import type { ImageAsset } from "@/lib/project/assets-schema";
import type { ProjectFile } from "@/lib/project/schema";
import type { LlmProvider } from "@/lib/providers/llm/types";
import {
  buildLayoutIRFromDesignSpec,
  buildStyleLockFromSpec,
  type LayoutIR,
  type MaterializationRecord,
  type StyleLock,
} from "./layout-ir";

export async function decomposeApprovedMockup(input: {
  project: ProjectFile;
  asset: ImageAsset;
  llm: LlmProvider;
}): Promise<{
  layout: LayoutIR;
  styleLock: StyleLock;
  record: MaterializationRecord;
  designSpec: NonNullable<ImageAsset["designSpec"]>;
}> {
  const { project, asset, llm } = input;
  const designSpec = await extractAssetDesignSpec({ asset, project, llm });
  const styleLock = buildStyleLockFromSpec(designSpec);
  const layout = buildLayoutIRFromDesignSpec({
    asset,
    spec: designSpec,
    styleLock,
  });

  // 若 vision 给了 materialPrompt，覆盖默认 prompt
  for (const region of designSpec.regions) {
    const node = layout.nodes.find((n) => n.id === region.id);
    if (
      node &&
      node.rebuildInCode === false &&
      typeof region.materialPrompt === "string" &&
      region.materialPrompt.trim()
    ) {
      node.prompt = region.materialPrompt.trim();
    }
  }

  const now = new Date().toISOString();
  const record: MaterializationRecord = {
    mockupAssetId: asset.id,
    layout,
    styleLock,
    createdAt: now,
    updatedAt: now,
  };

  return { layout, styleLock, record, designSpec };
}

export function applyMaterializationToProject(
  project: ProjectFile,
  assetId: string,
  record: MaterializationRecord,
  designSpec: NonNullable<ImageAsset["designSpec"]>
): ProjectFile {
  const now = new Date().toISOString();
  const assets = (project.assets ?? []).map((asset) => {
    if (asset.id !== assetId) return asset;
    return {
      ...asset,
      designSpec,
      approval: {
        status: "approved" as const,
        approvedAt: asset.approval?.approvedAt ?? now,
        layoutId: assetId,
      },
    };
  });

  return {
    ...project,
    assets,
    materializations: {
      ...(project.materializations ?? {}),
      [assetId]: record,
    },
    updatedAt: now,
  };
}
