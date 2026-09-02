/**
 * Handoff Sub-Agent
 * --------------------------------------------------------------
 * 引导用户打开交付弹窗确认定稿，避免无脑全量打包。
 */

import { buildHandoffPreflight } from "@/lib/handoff/preflight";
import { defaultHandoffSelection } from "@/lib/handoff/select-assets";
import type { SubAgent } from "./types";

export const handoffSubAgent: SubAgent = {
  name: "handoff",
  description: "打开交付确认，导出视觉素材包给 Cursor / Claude Code / Codex",
  keywords: ["导出", "handoff", "交付", "export", "cursor", "claude code", "codex"],

  async run(input) {
    if (!input.project) throw new Error("缺少项目");

    const target = input.task.includes("cursor")
      ? "cursor"
      : input.task.includes("claude")
        ? "claude-code"
        : input.task.includes("codex")
          ? "codex"
          : "markdown";

    const selection = defaultHandoffSelection(input.project);
    const preflight = buildHandoffPreflight(input.project, {
      selectedAssetIds: selection.assetIds,
      selectedReferenceIds: selection.referenceIds,
    });

    return {
      summary: `请在「导出 Handoff」弹窗确认定稿后再下载（默认 ${selection.assetIds.length} 张素材）。`,
      data: {
        openHandoffDialog: true,
        target,
        selectedAssetIds: selection.assetIds,
        selectedReferenceIds: selection.referenceIds,
        fileCount: 0,
        preflight: {
          ok: preflight.ok,
          finalAssetCount: preflight.finalAssetCount,
          warningCount: preflight.warningCount,
        },
        autoDownload: false,
      },
    };
  },
};
