/**
 * POST /api/agents/materialize
 * 锁定满意整图 → 拆解 Layout IR →（可选）按槽生成独立素材
 * 也支持：单槽强制重做、标记为代码、调 bbox、异步 Job
 */

import { z } from "zod";
import {
  applyMaterializationToProject,
  decomposeApprovedMockup,
} from "@/lib/handoff/decompose-mockup";
import {
  estimateMaterializeCostUsd,
  generateMaterialsForLayout,
} from "@/lib/handoff/generate-materials";
import { countMediaSlots, countReadyMaterials } from "@/lib/handoff/layout-ir";
import {
  applyAddCodeSlot,
  applyAddMediaSlot,
  applyMarkSlotsAsCode,
  applyMarkSlotsAsMedia,
  applyRemoveSlots,
  applySlotBBoxes,
  applyUpdateSlotPrompt,
  applyUpdateSlotRole,
  applyUpdateSlotGenMode,
} from "@/lib/handoff/slot-ops";
import { registerAllJobHandlers } from "@/lib/agents/job/job-handlers";
import { jobScheduler } from "@/lib/agents/job/job-scheduler";
import { threadIdForProject } from "@/lib/agents/checkpoint";
import { ProviderConfigSchema } from "@/lib/providers/config-schema";
import { resolveProviders } from "@/lib/providers/registry";
import { assertRealImageForGeneration } from "@/lib/providers/validate";
import { loadMergedProjectFromVad, saveProjectToVad } from "@/lib/vad/storage";

const BBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

const InputSchema = z.object({
  projectId: z.string().min(1),
  assetId: z.string().min(1),
  providerConfig: ProviderConfigSchema.optional(),
  /** 仅拆解，不生图（默认 true：须用户确认后再生成） */
  skipGeneration: z.boolean().optional().default(true),
  slotIds: z.array(z.string()).optional(),
  /** 强制重生指定/全部媒体槽 */
  forceRegen: z.boolean().optional().default(false),
  /** 将这些媒体槽改为代码实现（不生图） */
  markCodeSlotIds: z.array(z.string()).optional(),
  /** 调整槽位 bbox（会清掉材料绑定） */
  bboxUpdates: z
    .array(z.object({ slotId: z.string(), bbox: BBoxSchema }))
    .optional(),
  /**
   * 生图走 JobScheduler（默认 true）。
   * 测试或需要同步结果时可传 false。
   */
  async: z.boolean().optional().default(true),
  /** 忽略已有 materialization，重新 Vision 拆解 */
  forceDecompose: z.boolean().optional().default(false),
  /** 人工：新增媒体槽 */
  addMediaSlot: z
    .object({
      bbox: BBoxSchema,
      name: z.string().optional(),
      role: z
        .enum([
          "hero",
          "illustration",
          "background",
          "avatar",
          "icon",
          "decoration",
          "other",
        ])
        .optional(),
      prompt: z.string().optional(),
    })
    .optional(),
  /** 人工：新增代码槽 */
  addCodeSlot: z
    .object({
      bbox: BBoxSchema,
      name: z.string().optional(),
      role: z
        .enum([
          "nav",
          "cta",
          "form",
          "footer",
          "card",
          "sidebar",
          "main",
          "other",
        ])
        .optional(),
      copy: z.string().optional(),
      suggestedComponent: z.string().optional(),
    })
    .optional(),
  /** 人工：删除槽 */
  removeSlotIds: z.array(z.string()).optional(),
  /** 人工：改写媒体槽 prompt */
  promptUpdate: z
    .object({ slotId: z.string(), prompt: z.string().min(1) })
    .optional(),
  /** 人工：改写槽位 role */
  roleUpdate: z
    .object({ slotId: z.string(), role: z.string().min(1) })
    .optional(),
  /** 人工：改写媒体槽 genMode / outputSpec */
  genModeUpdate: z
    .object({
      slotId: z.string(),
      genMode: z.enum(["slice", "refine", "regenerate"]),
      outputSpec: z
        .object({
          alpha: z.boolean().optional(),
          tileable: z.boolean().optional(),
          bleed: z.number().min(0).max(0.2).optional(),
        })
        .optional(),
    })
    .optional(),
  /** 人工：代码槽 → 媒体槽 */
  markMediaSlotIds: z.array(z.string()).optional(),
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
    projectId,
    assetId,
    providerConfig,
    skipGeneration,
    slotIds,
    forceRegen,
    markCodeSlotIds,
    bboxUpdates,
    async: useAsync,
    forceDecompose,
    addMediaSlot,
    addCodeSlot,
    removeSlotIds,
    promptUpdate,
    roleUpdate,
    genModeUpdate,
    markMediaSlotIds,
  } = parsed.data;
  const project = await loadMergedProjectFromVad(projectId);
  if (!project) {
    return Response.json({ error: "project_not_found" }, { status: 404 });
  }

  const asset = (project.assets ?? []).find((a) => a.id === assetId);
  if (!asset?.src) {
    return Response.json({ error: "asset_not_found" }, { status: 404 });
  }
  if (asset.source === "materialized") {
    return Response.json(
      { error: "cannot_materialize_material_asset" },
      { status: 400 }
    );
  }

  try {
    let next = project;
    let record = next.materializations?.[assetId];

    let justDecomposed = false;
    if (!record || forceDecompose) {
      if (!providerConfig) {
        return Response.json(
          { error: "provider_config_required_for_decompose" },
          { status: 400 }
        );
      }
      const providers = resolveProviders(providerConfig);
      if (providers.llm.name === "mock-llm") {
        return Response.json(
          {
            error: "vision_llm_required",
            message:
              "当前 LLM 为 Mock，无法 Vision 拆解。请在 Provider 设置中配置支持看图的模型（GPT-4o / Claude / Gemini 等）。",
          },
          { status: 400 }
        );
      }
      const decomposed = await decomposeApprovedMockup({
        project: next,
        asset,
        llm: providers.llm,
      });
      next = applyMaterializationToProject(
        next,
        assetId,
        decomposed.record,
        decomposed.designSpec
      );
      record = decomposed.record;
      justDecomposed = true;
      await saveProjectToVad(next);
    }

    if (bboxUpdates?.length) {
      const boxed = applySlotBBoxes(next, assetId, bboxUpdates);
      next = boxed.project;
      record = boxed.record;
      await saveProjectToVad(next);
      if (
        skipGeneration &&
        !markCodeSlotIds?.length &&
        !addMediaSlot &&
        !addCodeSlot &&
        !removeSlotIds?.length &&
        !promptUpdate &&
        !roleUpdate &&
        !markMediaSlotIds?.length
      ) {
        return Response.json({
          ok: true,
          phase: "bbox_updated",
          changedSlotIds: boxed.changedSlotIds,
          layout: record.layout,
          project: next,
        });
      }
    }

    if (addMediaSlot) {
      const added = applyAddMediaSlot(next, assetId, addMediaSlot);
      await saveProjectToVad(added.project);
      return Response.json({
        ok: true,
        phase: "slot_added",
        slotId: added.slotId,
        layout: added.record.layout,
        project: added.project,
      });
    }

    if (addCodeSlot) {
      const added = applyAddCodeSlot(next, assetId, addCodeSlot);
      await saveProjectToVad(added.project);
      return Response.json({
        ok: true,
        phase: "code_slot_added",
        slotId: added.slotId,
        layout: added.record.layout,
        project: added.project,
      });
    }

    if (removeSlotIds?.length) {
      const removed = applyRemoveSlots(next, assetId, removeSlotIds);
      await saveProjectToVad(removed.project);
      return Response.json({
        ok: true,
        phase: "slots_removed",
        layout: removed.record.layout,
        project: removed.project,
      });
    }

    if (promptUpdate) {
      const updated = applyUpdateSlotPrompt(
        next,
        assetId,
        promptUpdate.slotId,
        promptUpdate.prompt
      );
      await saveProjectToVad(updated.project);
      return Response.json({
        ok: true,
        phase: "prompt_updated",
        layout: updated.record.layout,
        project: updated.project,
      });
    }

    if (roleUpdate) {
      const updated = applyUpdateSlotRole(
        next,
        assetId,
        roleUpdate.slotId,
        roleUpdate.role
      );
      await saveProjectToVad(updated.project);
      return Response.json({
        ok: true,
        phase: "role_updated",
        layout: updated.record.layout,
        project: updated.project,
      });
    }

    if (genModeUpdate) {
      const updated = applyUpdateSlotGenMode(
        next,
        assetId,
        genModeUpdate.slotId,
        {
          genMode: genModeUpdate.genMode,
          outputSpec: genModeUpdate.outputSpec,
        }
      );
      await saveProjectToVad(updated.project);
      return Response.json({
        ok: true,
        phase: "gen_mode_updated",
        layout: updated.record.layout,
        project: updated.project,
      });
    }

    if (markMediaSlotIds?.length) {
      const marked = applyMarkSlotsAsMedia(next, assetId, markMediaSlotIds);
      await saveProjectToVad(marked.project);
      return Response.json({
        ok: true,
        phase: "marked_media",
        layout: marked.record.layout,
        mediaSlotCount: countMediaSlots(marked.record.layout),
        readyCount: countReadyMaterials(marked.record.layout),
        project: marked.project,
      });
    }

    if (markCodeSlotIds?.length) {
      const marked = applyMarkSlotsAsCode(next, assetId, markCodeSlotIds);
      await saveProjectToVad(marked.project);
      return Response.json({
        ok: true,
        phase: "marked_code",
        layout: marked.record.layout,
        styleLock: marked.record.styleLock,
        mediaSlotCount: countMediaSlots(marked.record.layout),
        readyCount: countReadyMaterials(marked.record.layout),
        project: marked.project,
      });
    }

    if (skipGeneration) {
      const mediaSlotCount = countMediaSlots(record.layout);
      const cost = estimateMaterializeCostUsd({
        mediaSlotCount,
        needsDecompose: false,
        generateSlotCount: mediaSlotCount,
      });
      await saveProjectToVad(next);
      const visionOk = record.layout.meta?.source === "vision";
      const visionError =
        record.layout.meta?.warnings?.find((w) =>
          /Vision|vision|timeout|Mock|无法读取|启发式/i.test(w)
        ) ??
        (!visionOk
          ? "Vision 未成功，已回退启发式拆解。请查看 warnings。"
          : undefined);
      return Response.json({
        ok: true,
        phase: "decomposed",
        layout: record.layout,
        styleLock: record.styleLock,
        mediaSlotCount,
        costEstimate: cost,
        project: next,
        visionOk,
        visionError: visionOk ? undefined : visionError,
        justDecomposed,
        llmName: providerConfig
          ? resolveProviders(providerConfig).llm.name
          : undefined,
      });
    }

    if (!providerConfig) {
      return Response.json(
        { error: "provider_config_required_for_generation" },
        { status: 400 }
      );
    }
    assertRealImageForGeneration(providerConfig);

    const regenSlotIds =
      slotIds ??
      (bboxUpdates?.length
        ? bboxUpdates.map((u) => u.slotId)
        : undefined);

    if (useAsync) {
      registerAllJobHandlers();
      await saveProjectToVad(next);
      const job = jobScheduler.submit({
        type: "materialize_slots",
        payload: {
          projectId,
          mockupAssetId: assetId,
          providerConfig,
          slotIds: regenSlotIds,
          forceRegen: forceRegen || Boolean(regenSlotIds?.length),
        },
        projectId,
        threadId: threadIdForProject(projectId),
        phase: "GENERATION",
      });
      const mediaSlotCount = countMediaSlots(record.layout);
      const cost = estimateMaterializeCostUsd({
        mediaSlotCount,
        generateSlotCount: regenSlotIds?.length ?? mediaSlotCount,
      });
      return Response.json({
        ok: true,
        phase: "queued",
        layout: record.layout,
        styleLock: record.styleLock,
        mediaSlotCount,
        costEstimate: cost,
        project: next,
        job: {
          jobId: job.id,
          jobType: job.type,
          status: job.status,
          progress: job.progress,
          progressDetail: job.progressDetail,
        },
      });
    }

    const providers = resolveProviders(providerConfig);
    const mockup = (next.assets ?? []).find((a) => a.id === assetId) ?? asset;
    const result = await generateMaterialsForLayout({
      project: next,
      mockup,
      record,
      image: providers.image,
      slotIds: regenSlotIds,
      forceRegen: forceRegen || Boolean(regenSlotIds?.length),
    });
    await saveProjectToVad(result.project);

    return Response.json({
      ok: true,
      phase: "materials_ready",
      layout: result.record.layout,
      styleLock: result.record.styleLock,
      generatedCount: result.generatedCount,
      failedCount: result.failedCount,
      readyCount: countReadyMaterials(result.record.layout),
      mediaSlotCount: countMediaSlots(result.record.layout),
      estimatedCostUsd: result.estimatedCostUsd,
      actualCostUsd: result.actualCostUsd,
      project: result.project,
    });
  } catch (error) {
    return Response.json(
      {
        error: "materialize_failed",
        message: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
