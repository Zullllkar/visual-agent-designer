/**
 * 按视觉目标决定 handoff 包形态。
 * 界面视觉继续走 coding kickoff；其它目标不导出给 Cursor / Claude / Codex。
 */

import { getTargetRecipe, type TargetId } from "@/lib/targets/catalog";
import { parseTargetId, resolveTargetId } from "@/lib/targets/resolve";
import type { HandoffTarget } from "./types";

export type HandoffPackKind = "code-kickoff" | "art-bible" | "media-pack" | "none";

export type HandoffDestination = {
  id: HandoffTarget["name"];
  label: string;
  desc: string;
  entry: string;
  showKickoffCopy: boolean;
};

const CODING_DESTINATIONS: HandoffDestination[] = [
  {
    id: "cursor",
    label: "Cursor",
    desc: "包含 .cursorrules，Cursor 自动加载",
    entry: ".cursorrules",
    showKickoffCopy: true,
  },
  {
    id: "claude-code",
    label: "Claude Code",
    desc: "包含 CLAUDE.md，Claude Code 自动读取",
    entry: "CLAUDE.md",
    showKickoffCopy: true,
  },
  {
    id: "codex",
    label: "Codex / OpenAI Agent",
    desc: "包含 AGENTS.md，Codex 自动读取",
    entry: "AGENTS.md",
    showKickoffCopy: true,
  },
  {
    id: "markdown",
    label: "通用 Markdown",
    desc: "纯 README + SPEC，可贴给任何 LLM",
    entry: "README.md",
    showKickoffCopy: true,
  },
];

export function resolveHandoffPackKind(
  project: { targetId?: unknown } | null | undefined
): HandoffPackKind {
  return getTargetRecipe(resolveTargetId(project)).handoff;
}

export function resolveHandoffPackKindFromTargetId(
  targetId: TargetId | string | undefined
): HandoffPackKind {
  return getTargetRecipe(parseTargetId(targetId)).handoff;
}

export function isCodingHandoffPack(kind: HandoffPackKind): boolean {
  return kind === "code-kickoff";
}

export function listHandoffDestinations(kind: HandoffPackKind): HandoffDestination[] {
  if (kind === "code-kickoff") return CODING_DESTINATIONS;
  if (kind === "art-bible") {
    return [
      {
        id: "markdown",
        label: "美术包",
        desc: "PNG + 每张用途 + 方向卡，不写 React kickoff",
        entry: "ART_BIBLE.md",
        showKickoffCopy: false,
      },
    ];
  }
  if (kind === "media-pack") {
    return [
      {
        id: "markdown",
        label: "投放素材包",
        desc: "定稿图 + 文案表，不导出给 coding agent",
        entry: "COPY.md",
        showKickoffCopy: false,
      },
    ];
  }
  return [
    {
      id: "markdown",
      label: "风格草稿包",
      desc: "探索图 + 三个词，不是施工包",
      entry: "STYLE_NOTES.md",
      showKickoffCopy: false,
    },
  ];
}

export function coerceHandoffExportTarget(
  kind: HandoffPackKind,
  requested: HandoffTarget["name"]
): HandoffTarget["name"] {
  if (kind === "code-kickoff") return requested;
  return "markdown";
}

export function handoffDialogHint(kind: HandoffPackKind): string {
  if (kind === "code-kickoff") {
    return "勾选定稿与参考 → 核对拆解素材对应 → 下载 zip / 复制 kickoff。勾选会记住。";
  }
  if (kind === "art-bible") {
    return "勾选定稿，导出美术包：图 + 用途 + 方向。不会生成 Cursor / Claude kickoff。";
  }
  if (kind === "media-pack") {
    return "勾选定稿，导出投放包：图 + 文案表。不会导出给 AI coding 工具。";
  }
  return "这是风格探索，只能导出草稿包，不是给 coding agent 的施工包。";
}

export function handoffZipFootnote(kind: HandoffPackKind): string {
  if (kind === "code-kickoff") {
    return "zip 含勾选整图、已就绪材料、Layout IR、SPEC / tokens / kickoff。风格探索请取消勾选。";
  }
  if (kind === "art-bible") {
    return "zip 含勾选 PNG、ASSET_USAGE、ART_BIBLE。不含 React kickoff 与拆解材料。";
  }
  if (kind === "media-pack") {
    return "zip 含勾选图与 COPY.md。不含 IMPLEMENTATION / tokens / coding kickoff。";
  }
  return "zip 只含探索图与 STYLE_NOTES，标明草稿，请勿当施工包交给 coding agent。";
}
