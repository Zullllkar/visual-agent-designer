/**
 * POST /api/agents/design-spec
 * 为单张素材抽取设计规格（Vision → JSON，失败则启发式）
 */

import { z } from "zod";
import { extractAssetDesignSpec } from "@/lib/design-spec/extract-asset-spec";
import { ProviderConfigSchema } from "@/lib/providers/config-schema";
import { resolveProviders } from "@/lib/providers/registry";
import { loadMergedProjectFromVad, saveProjectToVad } from "@/lib/vad/storage";

const InputSchema = z.object({
  projectId: z.string().min(1),
  assetId: z.string().min(1),
  providerConfig: ProviderConfigSchema,
  /** 若 true，将规格写回 project.assets[].designSpec */
  persist: z.boolean().optional().default(true),
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

  const { projectId, assetId, providerConfig, persist } = parsed.data;
  const project = await loadMergedProjectFromVad(projectId);
  if (!project) {
    return Response.json({ error: "project_not_found" }, { status: 404 });
  }

  const asset = (project.assets ?? []).find((a) => a.id === assetId);
  if (!asset) {
    return Response.json({ error: "asset_not_found" }, { status: 404 });
  }
  if (!asset.src) {
    return Response.json({ error: "asset_has_no_src" }, { status: 400 });
  }

  const { llm } = resolveProviders(providerConfig);
  const designSpec = await extractAssetDesignSpec({ asset, project, llm });

  let updatedProject = project;
  if (persist) {
    updatedProject = {
      ...project,
      assets: (project.assets ?? []).map((a) =>
        a.id === assetId ? { ...a, designSpec } : a
      ),
      updatedAt: new Date().toISOString(),
    };
    await saveProjectToVad(updatedProject);
  }

  return Response.json({
    ok: true,
    designSpec,
    project: persist ? updatedProject : undefined,
  });
}
