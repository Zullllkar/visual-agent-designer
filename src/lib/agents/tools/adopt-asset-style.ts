/**
 * 按用户点名的那张图，锁定项目视觉方向并统一其余素材。
 */

import {
  ADOPT_RESTYLE_INSTRUCTION,
  buildAdoptedDesignDirection,
  parseAdoptAssetId,
  pickStyleRestyleTargets,
} from "@/lib/agents/adopt-asset-style";
import { buildDesignContext } from "@/lib/project/design-context";
import type { AgentTool, ToolContext, ToolResult } from "./types";
import { isUsableReferenceImage, ProjectFileSchema } from "./utils";
import { restyleImagesTool } from "./restyle-images";
import type { DirectionConfirmationData } from "./confirm-direction";

export const adoptAssetStyleTool: AgentTool = {
  name: "adopt_asset_style",
  description:
    "把选中素材锁定为项目整体视觉方向，并按它统一其余素材。用户点击「用此风格」或发送 [采用素材风格] 时调用。",
  inputPhase: ["BRIEF", "DIRECTION", "GENERATION", "REVIEW"],
  outputPhase: "REVIEW",
  riskLevel: "moderate",
  timeoutMs: 120_000,
  parameters: {
    type: "object",
    properties: {
      assetId: { type: "string", description: "作为风格基准的素材 id" },
    },
  },

  async execute(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    if (!ctx.project) throw new Error("缺少项目，无法采用素材风格");
    const assetId = parseAdoptAssetId(
      ctx.userMessage,
      typeof args.assetId === "string" ? args.assetId : undefined
    );
    if (!assetId) {
      throw new Error("请先选中一张素材，再采用它的视觉风格");
    }

    const asset = (ctx.project.assets ?? []).find((item) => item.id === assetId);
    if (!asset) throw new Error("找不到要采用风格的素材");
    if (!isUsableReferenceImage(asset.src)) {
      throw new Error("这张素材还没有可用画面，无法作为风格基准");
    }

    const now = new Date().toISOString();
    const designDirection = buildAdoptedDesignDirection({
      existing: ctx.project.designDirection,
      assetPrompt: asset.prompt,
      visualStyle: ctx.project.brief?.visualStyle,
      assetId,
    });
    const designContext = ctx.project.brief
      ? {
          ...buildDesignContext({
            brief: ctx.project.brief,
            designDirection,
            designSystemId: ctx.project.designSystemId,
            now,
          }),
          source: "user" as const,
          imageStyle: designDirection.summary,
        }
      : ctx.project.designContext
        ? {
            ...ctx.project.designContext,
            source: "user" as const,
            imageStyle: designDirection.summary,
            moodKeywords: designDirection.moodKeywords,
            updatedAt: now,
          }
        : undefined;

    let updated = ProjectFileSchema.parse({
      ...ctx.project,
      designDirection,
      designContext,
      updatedAt: now,
    });

    const restyleTargets = pickStyleRestyleTargets(
      updated.assets ?? [],
      assetId
    );
    let restyleSummary = "";
    if (restyleTargets.length > 0 && updated.brief) {
      try {
        const restyleResult = await restyleImagesTool.execute(
          {
            instruction: ADOPT_RESTYLE_INSTRUCTION,
            n: restyleTargets.length,
            referenceAssetId: assetId,
            excludeAssetIds: [assetId],
            confirmed: true,
          },
          { ...ctx, project: updated }
        );
        if (restyleResult.updatedProject) {
          updated = restyleResult.updatedProject;
        }
        restyleSummary = restyleResult.summary;
      } catch (err) {
        restyleSummary = `风格已锁定，统一其余素材时未开始：${(err as Error).message}`;
      }
    }

    const confirmation: DirectionConfirmationData = {
      title: "已按选中画面锁定视觉方向",
      summary: designDirection.summary,
      tone: designDirection.moodKeywords.join("、"),
      imageStyle: designContext?.imageStyle ?? designDirection.summary,
    };
    ctx.agentCtx.scratch.designDirectionSummary = designDirection.summary;
    ctx.agentCtx.scratch.designContext = designContext;
    ctx.agentCtx.scratch.__directionConfirmation = confirmation;
    ctx.onProjectUpdate?.(updated);

    return {
      summary: restyleSummary
        ? `已按选中画面锁定项目风格。${restyleSummary}`
        : "已按选中画面锁定项目风格。",
      data: {
        confirmationRequired: true,
        assetId,
        restyleCount: restyleTargets.length,
      },
      updatedProject: updated,
      fileWrites: ["design/direction.json"],
    };
  },

  async fallback(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    return this.execute(args, ctx);
  },
};
