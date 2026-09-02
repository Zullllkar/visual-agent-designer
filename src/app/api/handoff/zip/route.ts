/**
 * POST /api/handoff/zip
 * --------------------------------------------------------------
 * 服务端编译 Handoff artifact 并返回 zip 二进制流。
 * Chat export_handoff 与 HandoffDialog 共用。
 *
 * @author：wangjunhua
 */

import { z } from "zod";
import { ProjectFileSchema, type ProjectFile } from "@/lib/project/schema";
import { HandoffAgent } from "@/lib/agents/handoff-agent";
import { zipHandoffArtifact } from "@/lib/handoff/zip";
import type { HandoffTarget } from "@/lib/handoff/types";
import { buildHandoffPreflight } from "@/lib/handoff/preflight";
import {
  defaultSelectedAssetIds,
  defaultSelectedReferenceIds,
  projectWithSelectedAssets,
} from "@/lib/handoff/select-assets";
import { loadMergedProjectFromVad } from "@/lib/vad/storage";

const InputSchema = z.object({
  project: ProjectFileSchema,
  target: z
    .enum(["cursor", "claude-code", "codex", "markdown"])
    .optional()
    .default("markdown"),
  /** 勾选的定稿素材 id；省略则默认 starred（无则全部可选） */
  selectedAssetIds: z.array(z.string()).optional(),
  /** 勾选的参考图 id；省略则默认全部参考 */
  selectedReferenceIds: z.array(z.string()).optional(),
});

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = InputSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_input", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const {
    project: clientProject,
    target,
    selectedAssetIds,
    selectedReferenceIds,
  } = parsed.data;
  // 以磁盘为准补全 materializations / materialized 资产，避免客户端快照缺材料
  const project = await mergeProjectForHandoffExport(clientProject);
  const resolvedAssetIds =
    selectedAssetIds ?? defaultSelectedAssetIds(project);
  const resolvedReferenceIds =
    selectedReferenceIds ?? defaultSelectedReferenceIds(project);
  const exportProject = projectWithSelectedAssets(
    project,
    resolvedAssetIds,
    resolvedReferenceIds
  );
  const preflight = buildHandoffPreflight(project, {
    selectedAssetIds: resolvedAssetIds,
    selectedReferenceIds: resolvedReferenceIds,
  });
  if (!preflight.ok) {
    return Response.json(
      {
        error: "handoff_preflight_failed",
        message:
          resolvedAssetIds.length === 0
            ? "请至少勾选 1 张定稿素材再导出。"
            : "Handoff package is missing required final image assets. Generate or keep at least one usable image before export.",
        preflight,
      },
      { status: 422 }
    );
  }

  const requestOrigin = new URL(req.url).origin;
  const ctx = {
    projectId: exportProject.id,
    scratch: { requestOrigin },
    providers: {
      llm: { name: "handoff-zip-route", generateText: async () => ({ text: "" }) },
      image: {
        name: "handoff-zip-route",
        async generateImage() {
          return { imageUrl: "", model: "none" };
        },
      },
      visionCritic: false,
    },
    skill: null,
    designSystem: null,
  };

  try {
    const result = await HandoffAgent.run(
      { project: exportProject, target: target as HandoffTarget["name"] },
      ctx
    );
    const finalImageCount = result.artifact.files.filter((file) =>
      /^assets\/final\/.+\.(png|jpe?g|webp|gif|svg)$/i.test(file.path)
    ).length;
    if (finalImageCount === 0) {
      return Response.json(
        {
          error: "handoff_no_embedded_assets",
          message:
            "Handoff package has no embedded final image assets. Generate images first or check whether asset URLs are reachable.",
          paths: result.paths,
        },
        { status: 422 }
      );
    }
    const blob = await zipHandoffArtifact(result.artifact);
    const buffer = Buffer.from(await blob.arrayBuffer());

    return new Response(buffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${exportProject.slug || exportProject.id}.${target}.handoff.zip"`,
      },
    });
  } catch (err) {
    return Response.json(
      { error: "handoff_failed", message: (err as Error).message },
      { status: 500 }
    );
  }
}

/** 客户端快照 + 磁盘落盘：材料记录与子素材以磁盘优先补全 */
async function mergeProjectForHandoffExport(
  client: ProjectFile
): Promise<ProjectFile> {
  const disk = await loadMergedProjectFromVad(client.id).catch(() => null);
  if (!disk) return client;

  const assetById = new Map(
    [...(disk.assets ?? []), ...(client.assets ?? [])].map((a) => [a.id, a])
  );
  for (const asset of client.assets ?? []) {
    const existing = assetById.get(asset.id);
    if (!existing) {
      assetById.set(asset.id, asset);
      continue;
    }
    assetById.set(asset.id, {
      ...existing,
      ...asset,
      src: asset.src || existing.src,
      designSpec: asset.designSpec ?? existing.designSpec,
    });
  }

  return {
    ...disk,
    ...client,
    assets: [...assetById.values()],
    materializations: {
      ...(disk.materializations ?? {}),
      ...(client.materializations ?? {}),
    },
    references: client.references ?? disk.references,
  };
}
