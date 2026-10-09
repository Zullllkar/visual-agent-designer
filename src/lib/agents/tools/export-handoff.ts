/**
 * export_handoff 工具
 * --------------------------------------------------------------
 * 不直接打包全量素材；打开交付弹窗让用户确认定稿后再下载。
 */

import { buildHandoffPreflight } from "@/lib/handoff/preflight";
import {
  defaultHandoffSelection,
  projectWithHandoffSelection,
} from "@/lib/handoff/select-assets";
import type { AgentTool, ToolContext, ToolResult } from "./types";
import {
  coerceHandoffExportTarget,
  resolveHandoffPackKind,
} from "@/lib/handoff/pack-kind";

export const exportHandoffTool: AgentTool = {
  name: "export_handoff",
  description:
    "打开交付弹窗，让用户勾选定稿素材后再导出 Handoff 包（勿直接全量打包）",
  inputPhase: ["REVIEW", "HANDOFF"],
  outputPhase: "HANDOFF",
  riskLevel: "moderate",
  requiresConfirmation: true,
  parameters: {
    type: "object",
    properties: {
      target: {
        type: "string",
        enum: ["cursor", "claude-code", "codex", "markdown"],
      },
    },
  },

  async execute(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    if (!ctx.project) throw new Error("缺少项目，无法导出 Handoff");
    const requested = (args.target as
      | "cursor"
      | "claude-code"
      | "codex"
      | "markdown") ?? "markdown";
    const pack = resolveHandoffPackKind(ctx.project);
    const target = coerceHandoffExportTarget(pack, requested);

    const selection = defaultHandoffSelection(ctx.project);
    const preflight = buildHandoffPreflight(ctx.project, {
      selectedAssetIds: selection.assetIds,
      selectedReferenceIds: selection.referenceIds,
    });
    const scoped = projectWithHandoffSelection(ctx.project, selection);

    return {
      summary:
        pack === "code-kickoff"
          ? `请在「导出 Handoff」弹窗中确认定稿（默认 ${selection.assetIds.length} 张素材 / ${selection.referenceIds.length} 张参考），再下载 zip。`
          : pack === "art-bible"
            ? `请确认美术包定稿（${selection.assetIds.length} 张），不会导出 Cursor / Claude kickoff。`
            : pack === "media-pack"
              ? `请确认投放包定稿（${selection.assetIds.length} 张），导出图 + 文案表。`
              : `风格探索只能导出草稿包（${selection.assetIds.length} 张），不是施工包。`,
      data: {
        openHandoffDialog: true,
        target,
        selectedAssetIds: selection.assetIds,
        selectedReferenceIds: selection.referenceIds,
        scopedAssetCount: scoped.assets?.length ?? 0,
        preflight: {
          ok: preflight.ok,
          finalAssetCount: preflight.finalAssetCount,
          referenceCount: preflight.referenceCount,
          warningCount: preflight.warningCount,
          blockedCount: preflight.blockedCount,
        },
        autoDownload: false,
      },
    };
  },

  async fallback(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    return this.execute(args, ctx);
  },
};
