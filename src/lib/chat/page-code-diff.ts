/**
 * 页面结构 → Chat code_diff 事件
 * --------------------------------------------------------------
 * @author：wangjunhua
 */

import { nanoid } from "nanoid";
import type { CodeDiffEventData } from "@/lib/agents/chat-schema";
import type { CanvasPage } from "@/lib/canvas/schema";
import type { ImageAsset } from "@/lib/project/assets-schema";
import { guessLanguage, truncateForDiff } from "./code-diff";

export function pageLayoutCodeDiff(
  page: CanvasPage,
  toolCallId?: string
): CodeDiffEventData {
  return {
    path: `design/pages/${page.id}.canvas.json`,
    language: guessLanguage(`design/pages/${page.id}.canvas.json`),
    newText: truncateForDiff(
      JSON.stringify(
        {
          name: page.name,
          nodes: page.nodes.length,
          size: `${page.width}×${page.height}`,
        },
        null,
        2
      )
    ),
    summary: `新建页面结构：${page.name}`,
    toolCallId,
    diffId: nanoid(6),
  };
}

export function assetCodeDiff(
  asset: ImageAsset,
  toolCallId?: string
): CodeDiffEventData {
  return {
    path: `design/assets/${asset.id}.png`,
    language: "json",
    newText: truncateForDiff(
      JSON.stringify(
        {
          id: asset.id,
          model: asset.model,
          prompt: asset.prompt?.slice(0, 240),
          size: `${asset.width}×${asset.height}`,
        },
        null,
        2
      )
    ),
    summary: `生成位图：${asset.id}`,
    toolCallId,
    diffId: nanoid(6),
  };
}

export function pageRepairCodeDiff(
  before: CanvasPage,
  after: CanvasPage,
  toolCallId?: string
): CodeDiffEventData {
  return {
    path: `design/pages/${after.id}.canvas.json`,
    language: guessLanguage(`design/pages/${after.id}.canvas.json`),
    oldText: truncateForDiff(JSON.stringify(before, null, 2)),
    newText: truncateForDiff(JSON.stringify(after, null, 2)),
    summary: `修复页面：${after.name}`,
    toolCallId,
    diffId: nanoid(6),
  };
}

export function pageEditCodeDiff(
  before: CanvasPage,
  after: CanvasPage,
  toolCallId?: string
): CodeDiffEventData {
  return {
    path: `design/pages/${after.id}.canvas.json`,
    language: guessLanguage(`design/pages/${after.id}.canvas.json`),
    oldText: truncateForDiff(JSON.stringify(before, null, 2)),
    newText: truncateForDiff(JSON.stringify(after, null, 2)),
    summary: `编辑页面：${after.name}`,
    toolCallId,
    diffId: nanoid(6),
  };
}
