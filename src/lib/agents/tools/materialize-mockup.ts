/**
 * materialize_mockup — 锁定满意整图 → 拆解 IR → 按槽生成独立素材（Job 异步）
 */

import { assertRealImageForGeneration } from "@/lib/providers/validate";
import {
  applyMaterializationToProject,
  decomposeApprovedMockup,
} from "@/lib/handoff/decompose-mockup";
import { estimateMaterializeCostUsd } from "@/lib/handoff/materialize-cost";
import { countMediaSlots } from "@/lib/handoff/layout-ir";
import { registerAllJobHandlers } from "@/lib/agents/job/job-handlers";
import { jobScheduler } from "@/lib/agents/job/job-scheduler";
import { agentRuns } from "@/lib/agents/agent-run-service";
import type { AgentTool, ToolContext, ToolResult } from "./types";

export const materializeMockupTool: AgentTool = {
  name: "materialize_mockup",
  description:
    "用户对某张整屏 UI 图满意后：默认只锁定整图并拆解 Layout IR（媒体/代码槽 + prompt），展示给用户确认；仅当 generateMaterials=true 或 skipGeneration=false 时才启动生图 Job",
  inputPhase: ["GENERATION", "REVIEW", "HANDOFF"],
  outputPhase: "REVIEW",
  riskLevel: "moderate",
  requiresConfirmation: true,
  timeoutMs: 300_000,
  parameters: {
    type: "object",
    properties: {
      targetAssetId: {
        type: "string",
        description: "要锁定并拆素材的整图 asset id",
      },
      slotIds: {
        type: "array",
        items: { type: "string" },
        description: "仅生成/重生这些槽位；省略则处理全部媒体槽",
      },
      skipGeneration: {
        type: "boolean",
        description:
          "仅拆解 IR / 风格锁，不生图（默认 true）。用户确认方案后设为 false 或传 generateMaterials=true",
      },
      generateMaterials: {
        type: "boolean",
        description: "用户已确认拆解方案后，显式启动按槽生图 Job",
      },
      forceDecompose: {
        type: "boolean",
        description: "忽略已有 materialization，重新 Vision 拆解",
      },
    },
  },

  async execute(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    if (!ctx.project) throw new Error("缺少项目");
    const assets = (ctx.project.assets ?? []).filter(
      (a) =>
        a.status !== "discarded" &&
        a.status !== "failed" &&
        a.status !== "cancelled" &&
        a.source !== "materialized"
    );
    const targetAssetId = args.targetAssetId as string | undefined;
    const mockup =
      (targetAssetId
        ? assets.find((a) => a.id === targetAssetId)
        : null) ??
      assets.find((a) => a.approval?.status === "approved") ??
      assets.find((a) => a.status === "starred") ??
      assets[assets.length - 1];

    if (!mockup?.src) {
      throw new Error("没有可拆解的整图，请先生成并选定一张满意的 UI 图");
    }

    /** 默认只拆解；须显式 generateMaterials / skipGeneration:false 才生图 */
    const wantGenerate =
      args.generateMaterials === true || args.skipGeneration === false;
    const skipGeneration = !wantGenerate;
    const forceDecompose = args.forceDecompose === true;
    if (!skipGeneration) {
      assertRealImageForGeneration(ctx.providerConfig);
    }

    let project = ctx.project;
    let record = project.materializations?.[mockup.id];

    if (!record || forceDecompose) {
      const decomposed = await decomposeApprovedMockup({
        project,
        asset: mockup,
        llm: ctx.agentCtx.providers.llm,
      });
      project = applyMaterializationToProject(
        project,
        mockup.id,
        decomposed.record,
        decomposed.designSpec
      );
      record = decomposed.record;
    }

    if (skipGeneration) {
      const mediaSlots = countMediaSlots(record.layout);
      const codeSlots = record.layout.nodes.filter(
        (n) => n.rebuildInCode === true
      ).length;
      const cost = estimateMaterializeCostUsd({
        mediaSlotCount: mediaSlots,
        generateSlotCount: mediaSlots,
      });
      const mediaPreview = record.layout.nodes
        .filter((n) => n.rebuildInCode === false)
        .slice(0, 8)
        .map((n) => ({
          id: n.id,
          role: n.role,
          bbox: n.bbox,
          prompt: n.rebuildInCode === false ? n.prompt.slice(0, 160) : "",
        }));
      return {
        summary: `已拆解方案（未生图）：${mediaSlots} 个媒体槽 + ${codeSlots} 个代码区，共 ${record.layout.nodes.length} 区。预估生图约 $${cost.estimatedUsd.toFixed(2)}。请用户在审槽面板确认后，再调用 materialize_mockup(generateMaterials:true)。`,
        data: {
          mockupAssetId: mockup.id,
          layout: record.layout,
          styleLock: record.styleLock,
          mediaSlotCount: mediaSlots,
          codeSlotCount: codeSlots,
          mediaPreview,
          costEstimate: cost,
          phase: "decomposed_awaiting_confirm",
          awaitingUserConfirm: true,
        },
        updatedProject: project,
      };
    }

    const slotIds = Array.isArray(args.slotIds)
      ? (args.slotIds as string[])
      : undefined;

    project = {
      ...project,
      assets: (project.assets ?? []).map((a) =>
        a.id === mockup.id
          ? {
              ...a,
              approval: {
                status: "materializing",
                approvedAt: a.approval?.approvedAt ?? new Date().toISOString(),
                layoutId: mockup.id,
              },
            }
          : a
      ),
    };

    const mediaSlots = countMediaSlots(record.layout);
    const cost = estimateMaterializeCostUsd({
      mediaSlotCount: mediaSlots,
      generateSlotCount: slotIds?.length ?? mediaSlots,
    });

    registerAllJobHandlers();
    const job = jobScheduler.submit({
      type: "materialize_slots",
      payload: {
        projectId: project.id,
        mockupAssetId: mockup.id,
        providerConfig: ctx.providerConfig,
        slotIds,
        forceRegen: Boolean(slotIds?.length),
      },
      runId: ctx.runId,
            turnId: typeof ctx.agentCtx.scratch.turnId === "string" ? ctx.agentCtx.scratch.turnId : undefined,
      toolCallId: ctx.toolCallId,
      projectId: ctx.agentCtx.projectId,
      threadId: ctx.agentCtx.threadId,
      phase: "GENERATION",
    });
    if (ctx.runId) {
      agentRuns.addJobToRun(ctx.runId, job.id);
    }

    return {
      summary: `已启动拆素材任务 ${job.id}：${slotIds?.length ?? mediaSlots} 个媒体槽，预估约 $${cost.estimatedUsd.toFixed(2)}。完成后可审槽并导出 Handoff。`,
      data: {
        mockupAssetId: mockup.id,
        layout: record.layout,
        styleLock: record.styleLock,
        mediaSlotCount: mediaSlots,
        costEstimate: cost,
        phase: "queued",
        jobId: job.id,
        jobType: job.type,
        status: job.status,
      },
      updatedProject: project,
    };
  },

  async fallback(args, ctx) {
    return this.execute({ ...args, skipGeneration: true }, ctx);
  },
};
